/**
 * state_manager.ts — Stateless persistence layer using Google Sheets.
 *
 * Core principle: NEVER wait for humans. Save state, kill execution.
 * When execution resumes (via webhook, trigger, etc.), rehydrate
 * the state from the sheet using the UID.
 *
 * Sheet layout (STATE_SHEET_NAME):
 *   A: uid
 *   B: agent_id (which algo owns this state)
 *   C: status (pending | running | completed | error)
 *   D: state_json (serialised agent state)
 *   E: created_at (ISO timestamp)
 *   F: updated_at (ISO timestamp)
 */
// ─── Sheet Access ───────────────────────────────────────────
/**
 * Gets or creates the state sheet.
 */
function getStateSheet_() {
    const ss = SpreadsheetApp.openById(getStateSpreadsheetId());
    let sheet = ss.getSheetByName(STATE_SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(STATE_SHEET_NAME);
        // Set up headers
        sheet.getRange('A1:F1').setValues([[
                'uid', 'agent_id', 'status', 'state_json', 'created_at', 'updated_at'
            ]]);
        sheet.setFrozenRows(1);
        Logger.log(`[STATE_MANAGER] Created sheet: ${STATE_SHEET_NAME}`);
    }
    return sheet;
}
// ─── CRUD Operations ────────────────────────────────────────
/**
 * Creates a new agent state entry. Returns the full AgentState.
 */
function createState(uid, agentId, initialData = {}) {
    const sheet = getStateSheet_();
    const now = new Date().toISOString();
    const state = {
        uid,
        agentId,
        status: 'pending',
        data: initialData,
        createdAt: now,
        updatedAt: now,
    };
    sheet.appendRow([
        state.uid,
        state.agentId,
        state.status,
        JSON.stringify(state.data),
        state.createdAt,
        state.updatedAt,
    ]);
    Logger.log(`[STATE_MANAGER] Created state for uid=${uid}, agent=${agentId}`);
    return state;
}
/**
 * Reads the agent state for a given UID. Returns null if not found.
 */
function readState(uid) {
    const sheet = getStateSheet_();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === uid) {
            return {
                uid: data[i][0],
                agentId: data[i][1],
                status: data[i][2],
                data: JSON.parse(data[i][3] || '{}'),
                createdAt: data[i][4],
                updatedAt: data[i][5],
            };
        }
    }
    Logger.log(`[STATE_MANAGER] No state found for uid=${uid}`);
    return null;
}
/**
 * Updates the state for a given UID. Merges `updates` into existing data.
 */
function updateState(uid, updates) {
    const sheet = getStateSheet_();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === uid) {
            const row = i + 1; // Sheets are 1-indexed
            const now = new Date().toISOString();
            if (updates.status) {
                sheet.getRange(row, 3).setValue(updates.status);
            }
            if (updates.data) {
                const existingData = JSON.parse(data[i][3] || '{}');
                const merged = { ...existingData, ...updates.data };
                sheet.getRange(row, 4).setValue(JSON.stringify(merged));
            }
            sheet.getRange(row, 6).setValue(now);
            Logger.log(`[STATE_MANAGER] Updated state for uid=${uid}`);
            return readState(uid);
        }
    }
    Logger.log(`[STATE_MANAGER] Cannot update — no state found for uid=${uid}`);
    return null;
}
/**
 * Generates a unique ID for a new task/conversation.
 * Uses Utilities.getUuid() which is available in GAS.
 */
function generateUid() {
    return Utilities.getUuid();
}
/**
 * Parses a date value from Google Sheets into a YYYY-MM-DD string.
 */
function parseSheetDate_(rawDate) {
    if (!rawDate)
        return '';
    if (rawDate instanceof Date) {
        const offsetMs = rawDate.getTimezoneOffset() * 60000;
        const localDate = new Date(rawDate.getTime() - offsetMs);
        return localDate.toISOString().split('T')[0];
    }
    return String(rawDate).split('T')[0];
}
/**
 * Gets or creates the Budget sheet.
 */
function getBudgetSheet_() {
    const ss = SpreadsheetApp.openById(getStateSpreadsheetId());
    let sheet = ss.getSheetByName('Budget');
    if (!sheet) {
        sheet = ss.insertSheet('Budget');
        sheet.getRange('A1:C1').setValues([['date', 'total_tokens', 'AI model']]);
        sheet.setFrozenRows(1);
    }
    return sheet;
}
/**
 * Checks if a specific model has exceeded its 1 million token limit for today.
 */
function isModelOverBudget(model) {
    if (!model)
        return false;
    try {
        const sheet = getBudgetSheet_();
        const data = sheet.getDataRange().getValues();
        const today = new Date().toISOString().split('T')[0];
        for (let i = 1; i < data.length; i++) {
            const rowDateStr = parseSheetDate_(data[i][0]);
            const rowTokens = Number(data[i][1]) || 0;
            const rowModel = String(data[i][2]);
            if (rowDateStr === today && rowModel === model) {
                if (rowTokens > 1000000) {
                    return true;
                }
            }
        }
    }
    catch (e) {
        Logger.log(`[STATE_MANAGER] Failed to check budget: ${e}`);
    }
    return false;
}
/**
 * Updates the Budget tab for the given model and tokens today.
 */
function updateBudget(model, tokens) {
    if (!tokens || tokens <= 0 || !model)
        return;
    try {
        const sheet = getBudgetSheet_();
        const data = sheet.getDataRange().getValues();
        const today = new Date().toISOString().split('T')[0];
        let found = false;
        // Start from 1 to skip header
        for (let i = 1; i < data.length; i++) {
            const rowDateStr = parseSheetDate_(data[i][0]);
            const rowModel = String(data[i][2]);
            if (rowDateStr === today && rowModel === model) {
                const currentTokens = Number(data[i][1]) || 0;
                sheet.getRange(i + 1, 2).setValue(currentTokens + tokens);
                found = true;
                break;
            }
        }
        if (!found) {
            sheet.appendRow([today, tokens, model]);
        }
        Logger.log(`[STATE_MANAGER] Budget updated for model=${model}, +${tokens} tokens.`);
    }
    catch (e) {
        Logger.log(`[STATE_MANAGER] Failed to update Budget tab: ${e}`);
    }
}
/**
 * Persists the final conversation metrics and token cost to the Audit Logs tab.
 */
function logConversation(uid, algoId, input, thinking, output, tokens, modelUsed) {
    try {
        const ss = SpreadsheetApp.openById(getStateSpreadsheetId());
        let sheet = ss.getSheetByName('Logs');
        if (!sheet) {
            sheet = ss.insertSheet('Logs');
            sheet.appendRow(['timestamp', 'uid', 'caller_id', 'agent_id', 'input', 'thinking', 'output', 'tokens', 'model used']);
            sheet.setFrozenRows(1);
        }
        else {
            // Ensure header exists for 'model used'
            const headers = sheet.getRange('A1:I1').getValues()[0];
            if (headers[8] !== 'model used') {
                sheet.getRange('I1').setValue('model used');
            }
        }
        sheet.appendRow([
            new Date().toISOString(),
            uid,
            'TELEGRAM',
            algoId,
            input || '',
            thinking || '',
            output || '',
            tokens || 0,
            modelUsed || ''
        ]);
        Logger.log(`[STATE_MANAGER] Audit Log successfully persisted for uid=${uid}`);
        // Update Budget
        if (modelUsed && tokens > 0) {
            updateBudget(modelUsed, tokens);
        }
    }
    catch (e) {
        Logger.log(`[STATE_MANAGER] Failed to append to Logs/Budget tab: ${e}`);
    }
}
