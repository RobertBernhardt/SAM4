/**
 * quest_engine.ts — Weighted Round-Robin Quest Scheduler for SAM4.
 *
 * Quests Tab Columns (SAM Sheet):
 *   A: quest_id        — Unique string identifier.
 *   B: description     — What the quest is about.
 *   C: progress        — 0–100, set by the creator via Telegram feedback.
 *   D: status          — ACTIVE | PAUSED | FINISHED.
 *   E: weight          — 1–100 priority. Higher = triggered more often.
 *   F: current_score   — Accumulates weight each tick. Highest gets picked.
 *   G: last_feedback   — The creator's latest Telegram feedback text.
 *   H: parent_id       — If this is a subquest, the ID of its mother quest.
 *   I: state_doc_url   — Google Doc URL for this quest's living memory.
 *
 * QuestLogs Tab Columns (State Sheet):
 *   A: timestamp
 *   B: quest_id
 *   C: run_number      — Incrementing per quest.
 *   D: agent_actions   — What the agent did this run.
 *   E: lessons_learned — What the agent learned.
 *   F: creator_feedback — Filled in later via /update.
 *   G: progress_after  — Filled in later via /update.
 *
 * Outbox Tab Columns (State Sheet):
 *   D: status          — PENDING | DELIVERED.
 *   E: bot             — quest | subquest
 *   F: metadata        — JSON string (e.g. subquest proposal details)
 */

// ─── Sheet Accessors ────────────────────────────────────────

function getQuestsSheet_(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.openById(getSamSheetId());
    let sheet = ss.getSheetByName(QUESTS_SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(QUESTS_SHEET_NAME);
        sheet.appendRow(['quest_id', 'description', 'progress', 'status', 'weight', 'current_score', 'last_feedback', 'parent_id', 'state_doc_url']);
        sheet.setFrozenRows(1);
    }
    return sheet;
}

function getQuestLogsSheet_(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.openById(getStateSpreadsheetId());
    let sheet = ss.getSheetByName(QUEST_LOGS_SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(QUEST_LOGS_SHEET_NAME);
        sheet.appendRow(['timestamp', 'quest_id', 'run_number', 'agent_actions', 'lessons_learned', 'creator_feedback', 'progress_after']);
        sheet.setFrozenRows(1);
    }
    return sheet;
}

function getOutboxSheet_(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.openById(getStateSpreadsheetId());
    let sheet = ss.getSheetByName(OUTBOX_SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(OUTBOX_SHEET_NAME);
        sheet.appendRow(['timestamp', 'quest_id', 'message', 'status', 'bot', 'metadata']);
        sheet.setFrozenRows(1);
    }
    return sheet;
}

// ─── Quest Selector (Weighted Round-Robin) ──────────────────

interface QuestRow {
    rowIndex: number;
    questId: string;
    description: string;
    progress: number;
    status: string;
    weight: number;
    currentScore: number;
    lastFeedback: string;
    parentId: string;
    stateDocUrl: string;
}

function selectNextQuest_(): QuestRow | null {
    const sheet = getQuestsSheet_();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return null;

    const quests: QuestRow[] = [];

    for (let i = 1; i < data.length; i++) {
        const status = String(data[i][3]).trim().toUpperCase();
        if (status !== 'ACTIVE') continue;

        quests.push({
            rowIndex: i + 1,
            questId: String(data[i][0]).trim(),
            description: String(data[i][1]).trim(),
            progress: Number(data[i][2]) || 0,
            status: status,
            weight: Math.max(1, Math.min(100, Number(data[i][4]) || 1)),
            currentScore: Number(data[i][5]) || 0,
            lastFeedback: String(data[i][6] || '').trim(),
            parentId: String(data[i][7] || '').trim(),
            stateDocUrl: String(data[i][8] || '').trim(),
        });
    }

    if (quests.length === 0) return null;

    // Determine which quests are awaiting Creator feedback
    const logSheet = getQuestLogsSheet_();
    const logData = logSheet.getDataRange().getValues();

    const latestFeedback: Record<string, string> = {};
    const latestRunNum: Record<string, number> = {};
    const latestLessons: Record<string, string> = {};
    const latestActions: Record<string, string> = {};

    for (let i = 1; i < logData.length; i++) {
        const qid = String(logData[i][1]).trim();
        const runNum = Number(logData[i][2]) || 0;
        if (!latestRunNum[qid] || runNum > latestRunNum[qid]) {
            latestRunNum[qid] = runNum;
            latestActions[qid] = String(logData[i][3] || '').trim();
            latestLessons[qid] = String(logData[i][4] || '').trim();
            latestFeedback[qid] = String(logData[i][5] || '').trim();
        }
    }

    const awaitingFeedback = new Set<string>();
    for (const q of quests) {
        if (latestRunNum[q.questId]) {
            const hasFeedback = latestFeedback[q.questId] !== '';
            const isCrash = latestActions[q.questId].startsWith('[CRASHED]') || latestLessons[q.questId].startsWith('[ERROR]');
            const isTimeout = latestLessons[q.questId].startsWith('[TIMEOUT]');
            const isExecuting = latestActions[q.questId].startsWith('[EXECUTING]') && latestLessons[q.questId] === ''; 
            
            if (!hasFeedback && !isCrash && !isTimeout && !isExecuting) {
                awaitingFeedback.add(q.questId);
            }
        }
    }

    // Increment all active scores by their weight
    for (const q of quests) {
        q.currentScore += q.weight;
    }

    // Filter out awaiting quests
    const eligible = quests.filter(q => !awaitingFeedback.has(q.questId));

    if (eligible.length === 0) {
        for (const q of quests) {
            sheet.getRange(q.rowIndex, 6).setValue(q.currentScore);
        }
        SpreadsheetApp.flush();
        Logger.log('[QUEST_ENGINE] All active quests are awaiting Creator feedback. Skipping.');
        return null;
    }

    // Find the winner (highest score, alphabetical tiebreak)
    eligible.sort((a, b) => {
        if (b.currentScore !== a.currentScore) return b.currentScore - a.currentScore;
        return a.questId.localeCompare(b.questId);
    });

    const winner = eligible[0];
    winner.currentScore = 1;

    // Write ALL updated scores back
    for (const q of quests) {
        sheet.getRange(q.rowIndex, 6).setValue(q.currentScore);
    }
    SpreadsheetApp.flush();

    Logger.log(`[QUEST_ENGINE] Selected quest: ${winner.questId} (${awaitingFeedback.size} awaiting feedback)`);
    return winner;
}

// ─── Quest Log Loader (Context Scoping) ─────────────────────

function formatLogEntry_(row: any[]): string {
    const runNum = row[2];
    const actions = String(row[3] || '').trim();
    const lessons = String(row[4] || '').trim();
    const feedback = String(row[5] || '').trim();
    const progressAfter = row[6];

    let entry = `--- Run #${runNum} (${row[0]}) ---\n`;
    if (actions) entry += `Actions: ${actions}\n`;
    if (lessons) entry += `Lessons: ${lessons}\n`;
    if (feedback) entry += `Creator Feedback: ${feedback}\n`;
    if (progressAfter !== '' && progressAfter !== undefined) entry += `Progress After: ${progressAfter}%\n`;
    return entry;
}

/**
 * Loads all previous QuestLogs for a specific quest_id.
 * If this quest is a parent and has ACTIVE subquests, it also loads their history.
 */
function loadQuestHistory_(questId: string): string {
    const logSheet = getQuestLogsSheet_();
    const logData = logSheet.getDataRange().getValues();

    const questSheet = getQuestsSheet_();
    const questData = questSheet.getDataRange().getValues();

    // Find active subquests for this quest
    const activeSubquests = new Set<string>();
    for (let i = 1; i < questData.length; i++) {
        const qid = String(questData[i][0]).trim();
        const status = String(questData[i][3]).trim().toUpperCase();
        const parentId = String(questData[i][7] || '').trim();

        if (parentId === questId && status === 'ACTIVE') {
            activeSubquests.add(qid);
        }
    }

    const logs: string[] = [];

    logs.push('=== YOUR RUN HISTORY ===');
    let hasOwnLogs = false;
    for (let i = 1; i < logData.length; i++) {
        if (String(logData[i][1]).trim() === questId) {
            logs.push(formatLogEntry_(logData[i]));
            hasOwnLogs = true;
        }
    }
    if (!hasOwnLogs) logs.push('(No previous runs for this quest.)');

    if (activeSubquests.size > 0) {
        logs.push('\n=== ACTIVE SUBQUESTS ===');
        logs.push('These are active subquests you spawned. You can track their progress here.');

        for (const subId of activeSubquests) {
            logs.push(`\n[ Subquest: ${subId} ]`);
            let hasSubLogs = false;
            for (let i = 1; i < logData.length; i++) {
                if (String(logData[i][1]).trim() === subId) {
                    logs.push(formatLogEntry_(logData[i]));
                    hasSubLogs = true;
                }
            }
            if (!hasSubLogs) logs.push('(No runs yet for this subquest.)');
        }
    }

    return logs.join('\n');
}

function getNextRunNumber_(questId: string): number {
    const sheet = getQuestLogsSheet_();
    const data = sheet.getDataRange().getValues();
    let maxRun = 0;

    for (let i = 1; i < data.length; i++) {
        if (String(data[i][1]).trim() === questId) {
            const runNum = Number(data[i][2]) || 0;
            if (runNum > maxRun) maxRun = runNum;
        }
    }

    return maxRun + 1;
}

// ─── Timeout Detection ──────────────────────────────────────

function detectAndMarkTimeouts_(): void {
    const sheet = getQuestLogsSheet_();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;

    for (let i = 1; i < data.length; i++) {
        const actions = String(data[i][3] || '').trim();
        const lessons = String(data[i][4] || '').trim();

        if (actions && !lessons) {
            sheet.getRange(i + 1, 5).setValue('[TIMEOUT] GAS execution limit reached before this run could complete.');
            Logger.log(`[QUEST_ENGINE] Marked timeout for quest ${data[i][1]}, run #${data[i][2]}`);
        }
    }
}

// ─── Outbox: Unified Event-Driven Message Queue ─────────────
//
// Columns: timestamp | quest_id | message | status | bot | metadata
// bot = 'quest' or 'subquest'
// metadata = JSON string (e.g. subquest proposal details)
// Both QuestBot and SubquestBot share one queue. One message outstanding at a time.

function queueOutboxMessage_(questId: string, message: string, bot: string, metadata?: string): void {
    const sheet = getOutboxSheet_();
    const data = sheet.getDataRange().getValues();

    // Ensure header has all 6 columns
    if (data.length > 0 && (!data[0][4] || String(data[0][4]).trim() !== 'bot')) {
        sheet.getRange('E1').setValue('bot');
        sheet.getRange('F1').setValue('metadata');
    }

    let hasPending = false;
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][3]).trim() === 'PENDING') {
            hasPending = true;
            break;
        }
    }

    // Also check if there's already a DELIVERED message awaiting reply
    let hasDeliveredAwaiting = false;
    for (let i = data.length - 1; i > 0; i--) {
        if (String(data[i][3]).trim() === 'DELIVERED') {
            hasDeliveredAwaiting = true;
            break;
        }
    }

    if (!hasPending && !hasDeliveredAwaiting) {
        // Nothing pending and no outstanding delivery — try to send immediately
        try {
            deliverMessage_(message, bot, metadata);
            sheet.appendRow([new Date().toISOString(), questId, message, 'DELIVERED', bot, metadata || '']);
            Logger.log(`[OUTBOX] Sent immediately: ${questId} via ${bot}`);
        } catch (err) {
            sheet.appendRow([new Date().toISOString(), questId, message, `ERROR: ${err.message}`, bot, metadata || '']);
            Logger.log(`[OUTBOX] Failed immediate send: ${err.message}`);
        }
    } else {
        sheet.appendRow([new Date().toISOString(), questId, message, 'PENDING', bot, metadata || '']);
        Logger.log(`[OUTBOX] Queued: ${questId} (bot=${bot})`);
    }
}

/**
 * Actually sends a message to the right bot. For subquest proposals,
 * also sets LATEST_SUBQUEST from the metadata so the NL parser knows the context.
 */
function deliverMessage_(message: string, bot: string, metadata?: string): void {
    if (bot === 'subquest') {
        // Set proposal context for the NL parser
        if (metadata) {
            PropertiesService.getScriptProperties().setProperty('LATEST_SUBQUEST', metadata);
        }
        sendReply(getSubquestBotToken(), getAdminChatId(), [message]);
    } else {
        sendReply(getQuestBotToken(), getAdminChatId(), [message]);
    }
}

function deliverNextOutboxMessage_(): boolean {
    const sheet = getOutboxSheet_();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        if (String(data[i][3]).trim() === 'PENDING') {
            const message = String(data[i][2]);
            const bot = String(data[i][4] || 'quest').trim();
            const metadata = String(data[i][5] || '').trim();

            try {
                deliverMessage_(message, bot, metadata);
                sheet.getRange(i + 1, 4).setValue('DELIVERED');
                Logger.log(`[OUTBOX] Delivered next: ${data[i][1]} via ${bot}`);
            } catch (err) {
                sheet.getRange(i + 1, 4).setValue(`ERROR: ${err.message}`);
                Logger.log(`[OUTBOX] Failed deliver next: ${err.message}`);
            }
            
            SpreadsheetApp.flush();
            return true;
        }
    }
    return false;
}

function cleanupOutbox_(): void {
    const sheet = getOutboxSheet_();
    const data = sheet.getDataRange().getValues();
    const sevenDaysAgo = new Date().getTime() - (7 * 24 * 60 * 60 * 1000);
    for (let i = data.length - 1; i > 0; i--) {
        if (String(data[i][3]).trim() === 'DELIVERED') {
            const rowTimestamp = new Date(data[i][0]).getTime();
            if (rowTimestamp < sevenDaysAgo) {
                sheet.deleteRow(i + 1);
            }
        }
    }
}

// ─── Core Quest Execution ───────────────────────────────────

function processQuests(): void {
    detectAndMarkTimeouts_();

    const quest = selectNextQuest_();
    if (!quest) return;

    // Auto-create state doc if missing
    const stateDocUrl = ensureQuestStateDoc_(quest.questId, quest.description);
    const stateDocContent = stateDocUrl ? readDocContent(stateDocUrl) : '';

    // Load quest-specific references
    const questRefs = typeof getQuestReferencesPayload === 'function'
        ? getQuestReferencesPayload(quest.questId)
        : { textRefs: '', imageRefs: [] };

    const history = loadQuestHistory_(quest.questId);
    const runNumber = getNextRunNumber_(quest.questId);

    // Pre-write log row (timeout safety net)
    const logSheet = getQuestLogsSheet_();
    logSheet.appendRow([
        new Date().toISOString(),
        quest.questId,
        runNumber,
        `[EXECUTING] Quest "${quest.questId}" Run #${runNumber} started...`,
        '', '', ''
    ]);
    SpreadsheetApp.flush();

    const logData = logSheet.getDataRange().getValues();
    const logRowIndex = logData.length;

    const subtypeNotice = quest.parentId ? `\nNote: You are a SUBQUEST spawned by "${quest.parentId}".` : '';

    const questPrompt = [
        `You are executing Quest "${quest.questId}".${subtypeNotice}`,
        ``,
        `QUEST DESCRIPTION:`,
        quest.description,
        ``,
        `CURRENT PROGRESS: ${quest.progress}%`,
        ``,
        quest.lastFeedback ? `LATEST CREATOR FEEDBACK:\n${quest.lastFeedback}` : '(No feedback from Creator yet.)',
        ``,
        history,
        ``,
        stateDocContent ? `=== QUEST STATE DOCUMENT ===\n${stateDocContent}\n` : '',
        questRefs.textRefs ? `=== QUEST REFERENCES ===\n${questRefs.textRefs}\n` : '',
        `CRITICAL INSTRUCTION - STRICT EXECUTION SEQUENCE:`,
        `You MUST execute your turn precisely in the following order. Do not skip steps.`,
        `1. PLANNING: Analyze the quest description, progress, history, and state doc. Formulate a plan for this specific Run #${runNumber}.`,
        `2. DELEGATE TO MASTERALGO (Required): Invoke the 'masteralgo' tool exactly ONCE with a specific prompt to execute the main part of your plan.`,
        `3. UPDATE STATE DOC (Required): Use the 'append_quest_doc' tool to save the detailed results of the masteralgo execution to the state doc. Never skip this.`,
        `4. LOG ISSUES (Optional): If you encountered systematic bugs or missing tools, use the 'log_issue' tool.`,
        `5. SUGGEST SUBQUESTS (Optional): If the task is too large and requires delegation, use the 'suggest_subquest' tool.`,
        `6. UPDATE LEARNING FILE (Required): Use the 'append_experience' tool to log what worked, what failed, and new insights gained during this run. Never skip this.`,
        `7. FINAL REPORT (Required): Once all tool calls have successfully completed, conclude your turn by producing a final text response EXACTLY in the following format:`,
        ``,
        `ACTIONS TAKEN:`,
        `[Detailed list of what you planned, what you delegated to masteralgo, and what state was updated]`,
        ``,
        `LESSONS LEARNED:`,
        `[Summary of insights added to your learning file via append_experience]`,
        ``,
        `REPORT TO CREATOR:`,
        `[Concise summary of progress, current roadblocks, and suggestions for next steps. This is the Telegram message sending to Creator]`,
    ].join('\n');

    const uid = `quest_${quest.questId}_run${runNumber}_${new Date().getTime()}`;

    try {
        // Execute through questalgo — not masteralgo
        const results = runAlgo('questalgo', uid, questPrompt);
        const output = results.join('\n');

        const actionsMatch = output.match(/ACTIONS TAKEN:\s*([\s\S]*?)(?=LESSONS LEARNED:|$)/i);
        const lessonsMatch = output.match(/LESSONS LEARNED:\s*([\s\S]*?)(?=REPORT TO CREATOR:|$)/i);
        const reportMatch = output.match(/REPORT TO CREATOR:\s*([\s\S]*?)$/i);

        const actions = actionsMatch ? actionsMatch[1].trim() : output.substring(0, 500);
        const lessons = lessonsMatch ? lessonsMatch[1].trim() : '(No structured lessons returned)';
        const report = reportMatch ? reportMatch[1].trim() : output.substring(0, 500);

        logSheet.getRange(logRowIndex, 4).setValue(actions.substring(0, 5000));
        logSheet.getRange(logRowIndex, 5).setValue(lessons.substring(0, 5000));

        const docLink = stateDocUrl ? `\n📄 State doc: ${stateDocUrl}` : '';

        // Escape asterisks and underscores in the report and ID to prevent Telegram Markdown parsing errors
        // (if the LLM output contains a single underscore like 'log_issue', it breaks the parser)
        const safeReport = report.replace(/_/g, '\\_').replace(/\*/g, '\\*');
        const safeQuestId = quest.questId.replace(/_/g, '\\_').replace(/\*/g, '\\*');

        const telegramReport = [
            `📋 *Quest: ${safeQuestId}* (Run #${runNumber})`,
            `Progress: ${quest.progress}%`,
            ``,
            safeReport,
            docLink,
            ``,
            `_Reply naturally with your feedback and progress._`,
        ].join('\n');

        queueOutboxMessage_(quest.questId, telegramReport, 'quest');
    } catch (err) {
        logSheet.getRange(logRowIndex, 4).setValue(`[CRASHED] ${String(err).substring(0, 2000)}`);
        logSheet.getRange(logRowIndex, 5).setValue(`[ERROR] Run crashed: ${String(err).substring(0, 2000)}`);

        // Crash reports bypass the Outbox
        sendReply(getQuestBotToken(), getAdminChatId(), [
            `🚨 Quest "${quest.questId}" FAILED:\n${String(err)}`
        ]);
    }
}

// ─── Subquest Proposal (Called via SCRIPT Tool) ─────────────

function suggestSubquest(parentId: string, suggestedId: string, weight: number, description: string): string {
    // Queue proposal through the Outbox — NO direct send, NO immediate ScriptProperty write.
    // LATEST_SUBQUEST is set only when the message is actually delivered.
    const proposalMetadata = JSON.stringify({ parentId, suggestedId, weight, description });

    const safeParentId = parentId.replace(/_/g, '\\_').replace(/\*/g, '\\*');
    const safeDescription = description.replace(/_/g, '\\_').replace(/\*/g, '\\*');

    const message = [
        `🧩 *Subquest Proposal* (from ${safeParentId})`,
        `ID: \`${suggestedId}\``,
        `Suggested Weight: ${weight}`,
        ``,
        `Description: ${safeDescription}`,
        ``,
        `_Reply naturally to approve or reject (e.g., "approve, focus on Berlin")_`
    ].join('\n');

    try {
        queueOutboxMessage_(suggestedId, message, 'subquest', proposalMetadata);
        return `Subquest "${suggestedId}" proposed to Creator. Queued for delivery.`;
    } catch (err) {
        return `Failed to queue subquest proposal: ${err}`;
    }
}

// ─── Natural Language (NL) Parsers ──────────────────────────

function markLatestDeliveredAsReplied_(): void {
    const sheet = getOutboxSheet_();
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) {
        if (String(data[i][3]).trim() === 'DELIVERED') {
            sheet.getRange(i + 1, 4).setValue('REPLIED');
            // Do not break here! If there are old stuck DELIVERED messages, mark them all REPLIED to unstick the queue.
        }
    }
}

function getLatestDeliveredQuestId_(): string | null {
    const sheet = getOutboxSheet_();
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) {
        if (String(data[i][3]).trim() === 'DELIVERED') {
            return String(data[i][1]).trim();
        }
    }
    return null;
}

function parseNLQuestUpdate(userText: string, updateId: string): string {
    const questId = getLatestDeliveredQuestId_();
    if (!questId) return '❌ No pending quest reports found in the Outbox.';

    const questSheet = getQuestsSheet_();
    const qData = questSheet.getDataRange().getValues();
    let currentProgress = 0;
    for (let i = 1; i < qData.length; i++) {
        if (String(qData[i][0]).trim() === questId) {
            currentProgress = Number(qData[i][2]) || 0;
            break;
        }
    }

    const contextMessage = [
        `Quest ID: ${questId}`,
        `Current Progress: ${currentProgress}%`,
        ``,
        `Creator's reply:`,
        userText,
    ].join('\n');

    const uid = `nl_quest_${updateId}_${new Date().getTime()}`;

    try {
        const results = runAlgo('quest_update_algo', uid, contextMessage);
        const rawText = results.join('\n');
        const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
        const data = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        const prog = Number(data.progress) || currentProgress;
        const fb = String(data.feedback) || userText;
        return handleQuestUpdate(questId, prog, fb);
    } catch (e) {
        return `❌ Failed to parse quest update: ${e}`;
    }
}

function parseNLSubquestApproval(userText: string, updateId: string): string {
    const props = PropertiesService.getScriptProperties();
    const rawData = props.getProperty('LATEST_SUBQUEST');
    if (!rawData) return '❌ No pending subquest proposal found.';

    const pending = JSON.parse(rawData);

    const contextMessage = [
        `Pending Subquest Proposal:`,
        `- Parent Quest: ${pending.parentId}`,
        `- Suggested ID: ${pending.suggestedId}`,
        `- Suggested Weight: ${pending.weight}`,
        `- Description: ${pending.description}`,
        ``,
        `Creator's reply:`,
        userText,
    ].join('\n');

    const uid = `nl_subquest_${updateId}_${new Date().getTime()}`;

    try {
        const results = runAlgo('subquest_approval_algo', uid, contextMessage);
        const rawText = results.join('\n');
        const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
        const data = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);

        let resultMsg: string;
        if (data.action === 'REJECT') {
            props.deleteProperty('LATEST_SUBQUEST');
            resultMsg = `❌ Subquest "${pending.suggestedId}" was REJECTED.`;
        } else {
            const result = handleSubquestApproval(
                pending.parentId, pending.suggestedId,
                Number(data.weight) || pending.weight,
                data.description || pending.description
            );
            props.deleteProperty('LATEST_SUBQUEST');
            resultMsg = result;
        }

        // Deliver the next queued message (could be quest report or another subquest proposal)
        const hasNext = deliverNextOutboxMessage_();
        const queueNote = hasNext ? '\n📬 Next message delivered.' : '';
        return resultMsg + queueNote;
    } catch (e) {
        return `❌ Failed to parse subquest decision: ${e}`;
    }
}

// ─── NewQuest Bot (Creator-initiated quest creation) ────────

/**
 * Routes the Creator's natural language message to the new_quest_parser agent.
 * Extracts quest_id, description, and weight, then creates the quest.
 */
function parseNLNewQuest(userText: string, updateId: string): string {
    const contextMessage = [
        `The Creator wants to create a new quest.`,
        ``,
        `Creator's message:`,
        userText,
    ].join('\n');

    const uid = `nl_newquest_${updateId}_${new Date().getTime()}`;

    try {
        const results = runAlgo('new_quest_algo', uid, contextMessage);
        const rawText = results.join('\n');
        const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
        const data = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);

        const questId = String(data.quest_id || '').trim();
        const description = String(data.description || '').trim();
        const weight = Number(data.weight) || 10;

        if (!questId || !description) {
            return `❌ Could not extract quest details.\nParsed: ${rawText}\n\nTry something like: "Find plumbers in Berlin, weight 30"`;
        }

        return createNewQuest_(questId, description, weight);
    } catch (e) {
        return `❌ Failed to parse new quest: ${e}`;
    }
}

function createNewQuest_(questId: string, description: string, weight: number): string {
    const sheet = getQuestsSheet_();
    const data = sheet.getDataRange().getValues();

    // Check for duplicate
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === questId) {
            return `❌ Quest "${questId}" already exists.`;
        }
    }

    // Auto-create state doc
    const stateDocUrl = createQuestStateDoc_(questId, description);

    sheet.appendRow([
        questId,
        description,
        0,           // progress
        'ACTIVE',    // status
        weight,      // weight
        1,           // current_score
        '',          // last_feedback
        '',          // parent_id (main quest, no parent)
        stateDocUrl  // state_doc_url
    ]);

    SpreadsheetApp.flush();
    return [
        `✅ Quest Created!`,
        `ID: \`${questId}\``,
        `Weight: ${weight}`,
        `Description: ${description}`,
        `📄 State doc: ${stateDocUrl}`,
    ].join('\n');
}

// ─── Telegram Webhook Handlers ──────────────────────────────

function handleQuestUpdate(questId: string, newProgress: number, feedback: string): string {
    markLatestDeliveredAsReplied_();
    
    const logSheet = getQuestLogsSheet_();
    const logData = logSheet.getDataRange().getValues();
    let latestLogRow = -1;
    let latestRunNum = 0;

    for (let i = 1; i < logData.length; i++) {
        if (String(logData[i][1]).trim() === questId) {
            const runNum = Number(logData[i][2]) || 0;
            if (runNum > latestRunNum) {
                latestRunNum = runNum;
                latestLogRow = i + 1;
            }
        }
    }

    if (latestLogRow > 0) {
        logSheet.getRange(latestLogRow, 6).setValue(feedback);
        logSheet.getRange(latestLogRow, 7).setValue(newProgress);
    }

    const questSheet = getQuestsSheet_();
    const questData = questSheet.getDataRange().getValues();

    for (let i = 1; i < questData.length; i++) {
        if (String(questData[i][0]).trim() === questId) {
            const row = i + 1;
            questSheet.getRange(row, 3).setValue(newProgress);
            questSheet.getRange(row, 7).setValue(feedback);

            if (newProgress >= 100) {
                questSheet.getRange(row, 4).setValue('FINISHED');
            }
            break;
        }
    }

    SpreadsheetApp.flush();
    const hasNext = deliverNextOutboxMessage_();

    const statusMsg = newProgress >= 100 ? '🏆 Quest FINISHED!' : `✅ Updated to ${newProgress}%.`;
    const queueNote = hasNext ? '\n📬 Next report delivered.' : '\n📭 No more queued reports.';
    return `${statusMsg}\nQuest: ${questId}\nFeedback: "${feedback}"${queueNote}`;
}

function handleSubquestApproval(parentId: string, subId: string, weight: number, newDesc: string | null): string {
    markLatestDeliveredAsReplied_();

    const sheet = getQuestsSheet_();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === subId) {
            return `❌ Subquest "${subId}" already exists.`;
        }
    }

    const descToUse = newDesc || '(No description provided during approval)';

    // Auto-create state doc for the new subquest
    const stateDocUrl = createQuestStateDoc_(subId, descToUse);

    sheet.appendRow([
        subId,
        descToUse,
        0,           // progress
        'ACTIVE',    // status
        weight,      // weight
        1,           // current_score
        '',          // last_feedback
        parentId,    // parent_id
        stateDocUrl  // state_doc_url
    ]);

    SpreadsheetApp.flush();
    return `✅ Subquest Created!\nID: ${subId}\nParent: ${parentId}\nWeight: ${weight}\n📄 State doc: ${stateDocUrl}`;
}

// ─── Nightly Telemetry Updater ──────────────────────────────

function updateTelemetry(): void {
    try {
        cleanupOutbox_();
        const stateSs = SpreadsheetApp.openById(getStateSpreadsheetId());
        const logsSheet = stateSs.getSheetByName('Logs');
        if (!logsSheet) return;

        const logsData = logsSheet.getDataRange().getValues();

        // Count direct agent invocations (agent_id column)
        const agentCounts: Record<string, number> = {};
        // Count tool invocations from thinking traces
        const toolCounts: Record<string, number> = {};

        for (let i = 1; i < logsData.length; i++) {
            const agentId = String(logsData[i][3] || '').trim();
            if (agentId) agentCounts[agentId] = (agentCounts[agentId] || 0) + 1;

            const thinking = String(logsData[i][5] || '');
            const toolMatches = thinking.match(/\[Call \d+ \(([^)]+)\)\]/g);
            if (toolMatches) {
                for (const match of toolMatches) {
                    const toolName = match.replace(/\[Call \d+ \(/, '').replace(/\)\]/, '');
                    toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
                }
            }
        }

        const samSs = SpreadsheetApp.openById(getSamSheetId());

        // Update AgentManifest: Col H = direct invocations, Col J = total (direct + as tool)
        const manifestSheet = samSs.getSheetByName('AgentManifest');
        if (manifestSheet) {
            const manifestData = manifestSheet.getDataRange().getValues();
            // Ensure headers
            if (String(manifestData[0][7] || '') !== 'lifetime_usage') manifestSheet.getRange(1, 8).setValue('lifetime_usage');
            if (String(manifestData[0][9] || '') !== 'total_invocations') manifestSheet.getRange(1, 10).setValue('total_invocations');

            for (let i = 1; i < manifestData.length; i++) {
                const aid = String(manifestData[i][0]).trim();
                const directCount = agentCounts[aid] || 0;
                const toolCount = toolCounts[aid] || 0;
                manifestSheet.getRange(i + 1, 8).setValue(directCount);        // Col H
                manifestSheet.getRange(i + 1, 10).setValue(directCount + toolCount); // Col J
            }
        }

        // Update ToolRegistry: Col F = tool invocations
        const toolSheet = samSs.getSheetByName('ToolRegistry');
        if (toolSheet) {
            const toolData = toolSheet.getDataRange().getValues();
            if (String(toolData[0][5] || '') !== 'lifetime_usage') toolSheet.getRange(1, 6).setValue('lifetime_usage');

            for (let i = 1; i < toolData.length; i++) {
                const tid = String(toolData[i][0]).trim();
                toolSheet.getRange(i + 1, 6).setValue(toolCounts[tid] || 0);
            }
        }

        Logger.log('[TELEMETRY] Update complete.');
    } catch (e) {
        Logger.log(`[TELEMETRY] Failed: ${e}`);
    }
}

// ─── Experience Review (Weighted Round-Robin) ───────────────

function triggerExperienceReview(): void {
    const ss = SpreadsheetApp.openById(getSamSheetId());
    const sheet = ss.getSheetByName('AgentManifest');
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();

    // Collect agents that have experience docs
    const agents: { agentId: string; usage: number }[] = [];
    for (let i = 1; i < data.length; i++) {
        const agentId = String(data[i][0]).trim();
        const docUrl = String(data[i][8] || '').trim(); // Col I
        const rawUsage = Number(data[i][7]) || 1; // Col H = lifetime_usage
        const usage = Math.max(1, Math.floor(Math.log2(rawUsage)) + 1); // logarithmic weight

        if (agentId && docUrl) {
            agents.push({ agentId, usage });
        }
    }

    if (agents.length === 0) return;

    // Load scores from ScriptProperties
    const props = PropertiesService.getScriptProperties();
    const scoresRaw = props.getProperty('EXP_REVIEW_SCORES') || '{}';
    const scores: Record<string, number> = JSON.parse(scoresRaw);

    // Increment scores by usage weight
    for (const agent of agents) {
        scores[agent.agentId] = (scores[agent.agentId] || 0) + agent.usage;
    }

    // Pick the highest scorer
    let winner = agents[0].agentId;
    let highScore = scores[agents[0].agentId] || 0;
    for (const agent of agents) {
        const s = scores[agent.agentId] || 0;
        if (s > highScore) {
            highScore = s;
            winner = agent.agentId;
        }
    }

    // Reset winner
    scores[winner] = 1;
    props.setProperty('EXP_REVIEW_SCORES', JSON.stringify(scores));

    // Load the doc and run the reviewer agent
    const cfg = getAlgoConfig(winner);
    if (!cfg.experienceDocUrl) return;

    const docContent = readDocContent(cfg.experienceDocUrl);
    if (!docContent || docContent.length < 100) return; // Not worth reviewing yet

    const uid = `exp_review_${winner}_${new Date().getTime()}`;
    const prompt = [
        `You are reviewing the experience log for agent "${winner}".`,
        ``,
        `Current experience document content:`,
        `---`,
        docContent,
        `---`,
        ``,
        `Your task:`,
        `1. Remove outdated or redundant lessons`,
        `2. Merge duplicate insights into concise entries`,
        `3. Keep only actionable, specific advice`,
        `4. Maintain chronological order for recent entries`,
        `5. Output the COMPLETE cleaned document content, ready to replace the original`,
    ].join('\n');

    try {
        const results = runAlgo('experience_algo', uid, prompt);
        const cleaned = results.join('\n');
        if (cleaned.length > 50) {
            overwriteDocContent(cfg.experienceDocUrl, cleaned);
            Logger.log(`[EXP_REVIEW] Reviewed and updated experience doc for ${winner}`);
        }
    } catch (e) {
        Logger.log(`[EXP_REVIEW] Failed for ${winner}: ${e}`);
    }
}

// ─── Test Function ──────────────────────────────────────────

/**
 * Manual test function — run this in the GAS editor to verify the quest engine works.
 * It does NOT execute a real quest; it just validates all components load correctly.
 */
function testQuestEngine(): void {
    Logger.log('=== QUEST ENGINE SMOKE TEST ===');

    // 1. Sheet access
    const qSheet = getQuestsSheet_();
    Logger.log(`✓ Quests sheet: ${qSheet.getLastRow() - 1} quest(s)`);

    const logSheet = getQuestLogsSheet_();
    Logger.log(`✓ QuestLogs sheet: ${logSheet.getLastRow() - 1} log(s)`);

    const outboxSheet = getOutboxSheet_();
    Logger.log(`✓ Outbox sheet: ${outboxSheet.getLastRow() - 1} message(s)`);

    // 2. Quest selection
    const quest = selectNextQuest_();
    if (quest) {
        Logger.log(`✓ Selected quest: ${quest.questId} (weight=${quest.weight}, score=${quest.currentScore})`);

        // 3. State doc
        const docUrl = ensureQuestStateDoc_(quest.questId, quest.description);
        Logger.log(`✓ State doc: ${docUrl}`);

        // 4. History
        const history = loadQuestHistory_(quest.questId);
        Logger.log(`✓ History loaded: ${history.length} chars`);

        // 5. Quest refs
        const refs = getQuestReferencesPayload(quest.questId);
        Logger.log(`✓ Quest refs: ${refs.textRefs.length} chars text, ${refs.imageRefs.length} images`);
    } else {
        Logger.log('⚠ No quest selected (all awaiting feedback or none active)');
    }

    // 6. Agent config
    try {
        const cfg = getAlgoConfig('questalgo');
        Logger.log(`✓ questalgo config loaded: model=${cfg.model}`);
    } catch (e) {
        Logger.log(`✗ questalgo NOT FOUND in AgentManifest! Add it before running quests. Error: ${e}`);
    }

    // 7. Issue notifications
    const ss = SpreadsheetApp.openById(getSamSheetId());
    const issueSheet = ss.getSheetByName('Issues');
    if (issueSheet) {
        const iData = issueSheet.getDataRange().getValues();
        const newCount = iData.filter((r, i) => i > 0 && String(r[5]).trim() === 'NEW').length;
        Logger.log(`✓ Issues sheet: ${newCount} NEW issue(s)`);
    } else {
        Logger.log('⚠ Issues sheet not found (will be auto-created on first log_issue call)');
    }

    Logger.log('=== SMOKE TEST COMPLETE ===');
}
