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

// ─── Types ──────────────────────────────────────────────────

interface AgentState {
    uid: string;
    agentId: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    data: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}

// ─── Sheet Access ───────────────────────────────────────────

/**
 * Gets or creates the state sheet.
 */
function getStateSheet_(): GoogleAppsScript.Spreadsheet.Sheet {
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
function createState(uid: string, agentId: string, initialData: Record<string, any> = {}): AgentState {
    const sheet = getStateSheet_();
    const now = new Date().toISOString();

    const state: AgentState = {
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
function readState(uid: string): AgentState | null {
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
function updateState(
    uid: string,
    updates: {
        status?: AgentState['status'];
        data?: Record<string, any>;
    }
): AgentState | null {
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
function generateUid(): string {
    return Utilities.getUuid();
}

/**
 * Persists the final conversation metrics and token cost to the Audit Logs tab.
 */
function logConversation(uid: string, algoId: string, input: string, thinking: string, output: string, tokens: number) {
    try {
        const ss = SpreadsheetApp.openById(getStateSpreadsheetId());
        let sheet = ss.getSheetByName('Logs');
        if (!sheet) {
            sheet = ss.insertSheet('Logs');
            sheet.appendRow(['timestamp', 'uid', 'caller_id', 'agent_id', 'input', 'thinking', 'output', 'tokens']);
            sheet.setFrozenRows(1);
        }
        
        sheet.appendRow([
            new Date().toISOString(),
            uid,
            'TELEGRAM',
            algoId,
            input || '',
            thinking || '',
            output || '',
            tokens || 0
        ]);
        Logger.log(`[STATE_MANAGER] Audit Log successfully persisted for uid=${uid}`);
    } catch (e) {
        Logger.log(`[STATE_MANAGER] Failed to append to Logs tab: ${e}`);
    }
}
