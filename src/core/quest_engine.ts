/**
 * quest_engine.ts — Weighted Round-Robin Quest Scheduler for SAM4.
 *
 * Quests Tab Columns (SAM Sheet):
 *   A: quest_id        — Unique string identifier.
 *   B: description     — What the quest is about.
 *   C: status          — ACTIVE | PAUSED | FINISHED.
 *   D: weight          — 1–100 priority. Higher = triggered more often.
 *   E: current_score   — Accumulates weight each tick. Highest gets picked.
 *   F: parent_id       — If this is a subquest, the ID of its mother quest.
 *
 * QuestLogs Tab Columns (State Sheet):
 *   A: timestamp
 *   B: quest_id
 *   C: run_number      — Incrementing per quest.
 *   D: agent_actions   — Optional trace of what the agent did.
 *   E: report_doc_url  — Google Doc URL containing the full execution report.
 *   F: creator_feedback — Filled in later via /update.
 *
 * Outbox Tab Columns (State Sheet):
 *   D: status          — PENDING | DELIVERED.
 *   E: bot             — quest | subquest | agent
 *   F: metadata        — JSON string (e.g. proposal details)
 */

// ─── Sheet Accessors ────────────────────────────────────────

function getQuestsSheet_(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.openById(getSamSheetId());
    let sheet = ss.getSheetByName(QUESTS_SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(QUESTS_SHEET_NAME);
        sheet.appendRow(['quest_id', 'description', 'status', 'weight', 'current_score', 'parent_id']);
        sheet.setFrozenRows(1);
    }
    return sheet;
}

function getQuestLogsSheet_(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.openById(getStateSpreadsheetId());
    let sheet = ss.getSheetByName(QUEST_LOGS_SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(QUEST_LOGS_SHEET_NAME);
        sheet.appendRow(['timestamp', 'quest_id', 'run_number', 'agent_actions', 'report_doc_url', 'creator_feedback']);
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
    status: string;
    weight: number;
    currentScore: number;
    parentId: string;
}

function selectNextQuest_(): QuestRow | null {
    const sheet = getQuestsSheet_();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return null;

    const quests: QuestRow[] = [];

    for (let i = 1; i < data.length; i++) {
        const status = String(data[i][2]).trim().toUpperCase(); // Col C
        if (status !== 'ACTIVE') continue;

        quests.push({
            rowIndex: i + 1,
            questId: String(data[i][0]).trim(),
            description: String(data[i][1]).trim(),
            status: status,
            weight: Math.max(1, Math.min(100, Number(data[i][3]) || 1)), // Col D
            currentScore: Number(data[i][4]) || 0, // Col E
            parentId: String(data[i][5] || '').trim(), // Col F
        });
    }

    if (quests.length === 0) return null;

    // Determine which quests are awaiting Creator feedback
    const logSheet = getQuestLogsSheet_();
    const logData = logSheet.getDataRange().getValues();

    const latestFeedback: Record<string, string> = {};
    const latestRunNum: Record<string, number> = {};
    const latestDocUrl: Record<string, string> = {};
    const latestActions: Record<string, string> = {};

    for (let i = 1; i < logData.length; i++) {
        const qid = String(logData[i][1]).trim();
        const runNum = Number(logData[i][2]) || 0;
        if (!latestRunNum[qid] || runNum > latestRunNum[qid]) {
            latestRunNum[qid] = runNum;
            latestActions[qid] = String(logData[i][3] || '').trim(); // Col D
            latestDocUrl[qid] = String(logData[i][4] || '').trim();  // Col E
            latestFeedback[qid] = String(logData[i][5] || '').trim(); // Col F
        }
    }

    const awaitingFeedback = new Set<string>();
    for (const q of quests) {
        if (latestRunNum[q.questId]) {
            const hasFeedback = latestFeedback[q.questId] !== '';
            const isCrash = latestActions[q.questId].startsWith('[CRASHED]');
            const isTimeout = latestActions[q.questId].startsWith('[TIMEOUT]');
            const isExecuting = latestActions[q.questId].startsWith('[EXECUTING]') && latestDocUrl[q.questId] === ''; 
            
            // If there's a doc URL (meaning report generated) but NO feedback, it's awaiting feedback
            if (latestDocUrl[q.questId] !== '' && !hasFeedback) {
                awaitingFeedback.add(q.questId);
            }
            // If it's crashed or timeout, we don't automatically trigger it again unless feedback is provided
            if ((isCrash || isTimeout) && !hasFeedback) {
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
            sheet.getRange(q.rowIndex, 5).setValue(q.currentScore); // Col E
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
        sheet.getRange(q.rowIndex, 5).setValue(q.currentScore); // Col E
    }
    SpreadsheetApp.flush();

    Logger.log(`[QUEST_ENGINE] Selected quest: ${winner.questId} (${awaitingFeedback.size} awaiting feedback)`);
    return winner;
}

function detectAndMarkTimeouts_(): void {
    const sheet = getQuestLogsSheet_();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;

    for (let i = 1; i < data.length; i++) {
        const actions = String(data[i][3] || '').trim(); // Col D
        const docUrl = String(data[i][4] || '').trim();  // Col E

        if (actions.startsWith('[EXECUTING]') && !docUrl) {
            sheet.getRange(i + 1, 4).setValue('[TIMEOUT] GAS limit reached before this run completed.'); // Col D
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

    // Check if THIS SPECIFIC BOT already has something pending or delivered
    let hasBotPending = false;
    let hasBotDelivered = false;

    for (let i = 1; i < data.length; i++) {
        const rowStatus = String(data[i][3]).trim();
        const rowBot = String(data[i][4] || 'quest').trim();
        if (rowBot === bot) {
            if (rowStatus === 'PENDING') hasBotPending = true;
            if (rowStatus === 'DELIVERED') hasBotDelivered = true;
        }
    }

    if (!hasBotPending && !hasBotDelivered) {
        // Safe to send THIS bot's message immediately
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
        Logger.log(`[OUTBOX] Queued: ${questId} (bot=${bot} - awaiting reply)`);
    }
}

/**
 * Actually sends a message to the right bot. For subquest proposals,
 * also sets LATEST_SUBQUEST from the metadata so the NL parser knows the context.
 */
function deliverMessage_(message: string, bot: string, metadata?: string): void {
    const greeting = "lord troll,\n\n";
    // Do NOT lowercase everything! It breaks Doc IDs (case-sensitive) and Markdown links.
    // Trust the system prompts for lowercase output.
    let finalMsg = message.trim();
    if (!finalMsg.toLowerCase().startsWith("lord troll")) {
        finalMsg = greeting + finalMsg;
    }

    // Surgical lowercase fixes if needed, but avoid breaking links [text](link)
    // For now, let's just do the requested "I" and "AI" fixes on the whole block
    finalMsg = finalMsg.replace(/\b(i)\b/g, 'I').replace(/\b(ai)\b/gi, 'AI');

    if (bot === 'subquest') {
        if (metadata) {
            PropertiesService.getScriptProperties().setProperty('LATEST_SUBQUEST', metadata);
        }
        sendReply(getSubquestBotToken(), getAdminChatId(), [finalMsg]);
    } else if (bot === 'agent') {
        sendReply(getAgentBotToken(), getAdminChatId(), [finalMsg]);
    } else {
        sendReply(getQuestBotToken(), getAdminChatId(), [finalMsg]);
    }
}

function deliverNextOutboxMessage_(optionalBotFilter?: string): boolean {
    const sheet = getOutboxSheet_();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        if (String(data[i][3]).trim() === 'PENDING') {
            const message = String(data[i][2]);
            const bot = String(data[i][4] || 'quest').trim();
            
            if (optionalBotFilter && bot !== optionalBotFilter) continue;
            
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

function processQuests(): void {
    detectAndMarkTimeouts_();

    const quest = selectNextQuest_();
    if (!quest) return;

    const runNumber = getNextRunNumber_(quest.questId);

    // Pre-write log row (timeout safety net)
    const logSheet = getQuestLogsSheet_();
    logSheet.appendRow([
        new Date().toISOString(),
        quest.questId,
        runNumber,
        `[EXECUTING] Quest "${quest.questId}" Run #${runNumber} started...`,
        '', '' // report doc url, feedback
    ]);
    SpreadsheetApp.flush();

    const uid = `quest_${quest.questId}_run${runNumber}_${new Date().getTime()}`;

    // Prompt for questalgo
    let questPrompt = `You are executing Quest "${quest.questId}".\n\nQUEST DESCRIPTION:\n${quest.description}\n\n`;
    if (quest.parentId) {
        questPrompt += `Note: You are a SUBQUEST spawned by "${quest.parentId}". Your completion is a requirement for the main quest to proceed.\n\n`;
    }
    questPrompt += `You are the primary executor. You have direct access to tools. Solve this quest completely.\nWhen you are done, return a final message summarizing what you did.`;

    let crashError = '';
    try {
        runAlgo('questalgo', uid, questPrompt);
    } catch (err) {
        crashError = String(err);
    }

    // Step 2: LogAlgo -> read the AgentState history and build a report
    const state = typeof readState === 'function' ? readState(uid) : null;
    let agentTranscript = '';
    
    if (crashError) {
        agentTranscript = `[CRASHED] Fatal error: ${crashError}`;
        const data = logSheet.getDataRange().getValues();
        logSheet.getRange(data.length, 4).setValue(agentTranscript.substring(0, 5000));
    } else if (state && state.data && state.data.history) {
        agentTranscript = JSON.stringify(state.data.history, null, 2);
    }

    const logPrompt = `Review this quest execution for Quest "${quest.questId}".\nDescription: ${quest.description}\n\nExecution Transcript (JSON):\n${agentTranscript}`;
    
    let reportText = '';
    try {
        const logResults = runAlgo('logalgo', `${uid}_log`, logPrompt);
        reportText = logResults.join('\n');
    } catch (e) {
        reportText = `Failed to generate report: ${e}\n\nTranscript Snippet:\n${agentTranscript.substring(0, 1000)}`;
    }

    // Create execution report doc
    let reportDocUrl = '';
    if (typeof createQuestExecutionReport_ === 'function') {
        reportDocUrl = createQuestExecutionReport_(quest.questId, runNumber, reportText);
    }

    // Step 3: UserInfoAlgo -> summarize and prep Telegram message
    const userInfoPrompt = `Markdown Report:\n---\n${reportText}`;
    
    let telegramMessage = '';
    try {
        const userInfoResults = runAlgo('userinfoalgo', `${uid}_userinfo`, userInfoPrompt);
        const bulletPoints = userInfoResults.join('\n');
        
        const displayQuestId = quest.questId.replace(/_/g, ' ');
        const displayDescription = quest.description;

        telegramMessage = [
            `📋 *quest: ${displayQuestId}* (run #${runNumber})`,
            `_objective: ${displayDescription}_`,
            ``,
            bulletPoints,
            ``,
            `📄 [full report](${reportDocUrl})`,
        ].join('\n');
    } catch (e) {
        telegramMessage = `📋 *quest: ${quest.questId.replace(/_/g, ' ')}* (run #${runNumber})\n\nreport generation succeeded, but summarization failed. check it here.\n\n📄 [full report](${reportDocUrl})`;
    }

    // Find the exact row to update
    const finalData = logSheet.getDataRange().getValues();
    let targetRow = finalData.length; 
    for(let i = finalData.length - 1; i > 0; i--){
        if(String(finalData[i][1]).trim() === quest.questId && Number(finalData[i][2]) === runNumber){
            targetRow = i + 1;
            break;
        }
    }
    
    logSheet.getRange(targetRow, 4).setValue(crashError ? agentTranscript.substring(0, 5000) : '[COMPLETED]');
    logSheet.getRange(targetRow, 5).setValue(reportDocUrl);
    SpreadsheetApp.flush();

    queueOutboxMessage_(quest.questId, telegramMessage, 'quest');
}

// ─── Subquest Proposal (Called via SCRIPT Tool) ─────────────

function suggestSubquest(parentId: string, suggestedId: string, weight: number, description: string): string {
    const proposalMetadata = JSON.stringify({ parentId, suggestedId, weight, description });

    const displayParentId = parentId.replace(/_/g, ' ');
    const displayId = suggestedId.replace(/_/g, ' ');

    const message = [
        `🧩 *subquest proposed* (requirement for ${displayParentId})`,
        `id: \`${displayId}\``,
        `suggested weight: ${weight}`,
        ``,
        `desc: ${description}`,
        ``,
        `_reply naturally to approve or reject_`
    ].join('\n');

    try {
        queueOutboxMessage_(suggestedId, message, 'subquest', proposalMetadata);
        return `subquest "${displayId}" proposed to lord troll.`;
    } catch (err) {
        return `failed to queue subquest: ${err}`;
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

function parseNLQuestUpdate(userText: string, updateId: string): { statusMsg: string, triggerNext: boolean } {
    const questId = getLatestDeliveredQuestId_();
    if (!questId) return { statusMsg: '❌ No pending quest reports.', triggerNext: false };

    const uid = `nl_quest_${updateId}_${new Date().getTime()}`;
    const contextMessage = `Creator's reply:\n${userText}`;

    try {
        const results = runAlgo('quest_update_algo', uid, contextMessage);
        const rawText = results.join('\n');
        const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
        const data = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        
        return handleQuestUpdate(questId, data.action || 'REPEAT', data.feedback || userText);
    } catch (e) {
        return { statusMsg: `❌ Failed to parse quest update: ${e}`, triggerNext: false };
    }
}

function parseNLSubquestApproval(userText: string, updateId: string): { statusMsg: string, triggerNext: boolean } {
    const props = PropertiesService.getScriptProperties();
    const rawData = props.getProperty('LATEST_SUBQUEST');
    if (!rawData) return { statusMsg: '❌ No pending subquest proposal.', triggerNext: false };

    const pending = JSON.parse(rawData);
    const uid = `nl_subquest_${updateId}_${new Date().getTime()}`;

    if (pending.suggested_quest_id) {
        // This is a follow-up quest
        try {
            const results = runAlgo('subquest_approval_algo', uid, `Proposal: ${pending.description}\nCreator reply: ${userText}`);
            const data = JSON.parse(results.join('\n').match(/\{[\s\S]*?\}/)![0]);
            if (data.action === 'REJECT') {
                props.deleteProperty('LATEST_SUBQUEST');
                return { statusMsg: `❌ Follow-up Quest REJECTED.`, triggerNext: true };
            }
            const msg = createNewQuest_(pending.suggested_quest_id, data.description || pending.description, data.weight || pending.weight);
            props.deleteProperty('LATEST_SUBQUEST');
            return { statusMsg: msg, triggerNext: true };
        } catch(e) { return { statusMsg: `❌ Error: ${e}`, triggerNext: false }; }
    }

    const contextMessage = `Pending Subquest:\nDesc: ${pending.description}\nCreator reply:\n${userText}`;

    try {
        const results = runAlgo('subquest_approval_algo', uid, contextMessage);
        const rawText = results.join('\n');
        const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
        const data = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);

        let resultMsg: string;
        if (data.action === 'REJECT') {
            props.deleteProperty('LATEST_SUBQUEST');
            resultMsg = `❌ Subquest "${pending.suggestedId}" REJECTED.`;
        } else {
            resultMsg = handleSubquestApproval(
                pending.parentId, pending.suggestedId,
                Number(data.weight) || pending.weight,
                data.description || pending.description
            );
            props.deleteProperty('LATEST_SUBQUEST');
        }

        return { statusMsg: resultMsg, triggerNext: true };
    } catch (e) {
        return { statusMsg: `❌ Failed to parse subquest decision: ${e}`, triggerNext: false };
    }
}

function parseNLAgentApproval(userText: string, updateId: string): { statusMsg: string, triggerNext: boolean } {
    const agentId = getLatestDeliveredQuestId_();
    if (!agentId) return { statusMsg: '❌ No pending agent lessons.', triggerNext: false };

    const sheet = getOutboxSheet_();
    const data = sheet.getDataRange().getValues();
    let pendingLesson = '';
    for (let i = data.length - 1; i > 0; i--) {
        if (String(data[i][3]).trim() === 'DELIVERED' && String(data[i][1]).trim() === agentId) {
            const meta = String(data[i][5]);
            if (meta) {
                try {
                    const parsed = JSON.parse(meta);
                    pendingLesson = parsed.lesson || '';
                } catch(e) {}
            }
            break;
        }
    }

    if (!pendingLesson) return { statusMsg: '❌ Could not retrieve pending lesson data.', triggerNext: false };

    const uid = `nl_agent_${updateId}_${new Date().getTime()}`;
    const contextMessage = `Lesson Tip for ${agentId}:\n${pendingLesson}\n\nCreator reply:\n${userText}`;

    try {
        const results = runAlgo('agent_approval_algo', uid, contextMessage);
        const rawText = results.join('\n');
        const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);

        if (parsed.action === 'REJECT') {
            return { statusMsg: `❌ Tip for ${agentId} REJECTED.`, triggerNext: true };
        } else {
            const finalLesson = parsed.updated_lesson || pendingLesson;
            if (typeof ensureExperienceDoc_ === 'function') {
                const docUrl = ensureExperienceDoc_(agentId);
                if (docUrl) {
                    const docId = typeof extractDocId_ === 'function' ? extractDocId_(docUrl) : null;
                    if (docId) {
                        const doc = DocumentApp.openById(docId);
                        const body = doc.getBody();
                        
                        let countNum = 1;
                        if (typeof getSamSheetId === 'function') {
                            const manifestSheet = SpreadsheetApp.openById(getSamSheetId()).getSheetByName('AgentManifest');
                            if (manifestSheet) {
                                const mData = manifestSheet.getDataRange().getValues();
                                for (let j = 1; j < mData.length; j++) {
                                    if (String(mData[j][0]).trim() === agentId) {
                                        countNum = (Number(mData[j][6]) || 0) + 1; // Col G
                                        manifestSheet.getRange(j + 1, 7).setValue(countNum);
                                        break;
                                    }
                                }
                            }
                        }

                        body.appendParagraph(`#${countNum}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
                        body.appendParagraph(finalLesson);
                        doc.saveAndClose();
                        return { statusMsg: `✅ Tip #${countNum} saved to ${agentId}'s experience!`, triggerNext: true };
                    }
                }
            }
            return { statusMsg: `✅ Tip parsed but could not write to doc.`, triggerNext: true };
        }
    } catch (e) {
        return { statusMsg: `❌ Failed to parse tip decision: ${e}`, triggerNext: false };
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

    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === questId) {
            return `❌ Quest "${questId}" already exists.`;
        }
    }

    sheet.appendRow([
        questId,
        description,
        'ACTIVE',    // status (Col C)
        weight,      // weight (Col D)
        1,           // current_score (Col E)
        '',          // parent_id (main quest, no parent) (Col F)
    ]);

    SpreadsheetApp.flush();
    return [
        `✅ quest created!`,
        `id: \`${questId.replace(/_/g, ' ')}\``,
        `weight: ${weight}`,
        `desc: ${description}`
    ].join('\n');
}

// ─── Telegram Webhook Handlers ──────────────────────────────

function handleQuestUpdate(questId: string, action: string, feedback: string): { statusMsg: string, triggerNext: boolean } {
    markLatestDeliveredAsReplied_();

    let statusMsg = '';
    const logSheet = getQuestLogsSheet_();
    const logData = logSheet.getDataRange().getValues();
    let latestLogRow = -1;
    let latestRunNum = 0;
    let latestDocUrl = '';

    for (let i = 1; i < logData.length; i++) {
        if (String(logData[i][1]).trim() === questId) {
            const runNum = Number(logData[i][2]) || 0;
            if (runNum > latestRunNum) {
                latestRunNum = runNum;
                latestLogRow = i + 1;
                latestDocUrl = String(logData[i][4]).trim();
            }
        }
    }

    if (latestLogRow > 0) {
        logSheet.getRange(latestLogRow, 6).setValue(feedback); // Col F
    }

    const questSheet = getQuestsSheet_();
    const questData = questSheet.getDataRange().getValues();
    let questDesc = '';
    let parentId = '';

    for (let i = 1; i < questData.length; i++) {
        if (String(questData[i][0]).trim() === questId) {
            const row = i + 1;
            questDesc = String(questData[i][1]).trim();
            parentId = String(questData[i][5]).trim(); // Col F

            if (action === 'ACCEPT') {
                questSheet.getRange(row, 3).setValue('FINISHED'); // Col C
                statusMsg = `🏆 Quest "${questId}" FINISHED!`;
                
                // Unpause parent
                if (parentId) {
                    for (let j = 1; j < questData.length; j++) {
                        if (String(questData[j][0]).trim() === parentId) {
                            questSheet.getRange(j + 1, 3).setValue('ACTIVE');
                            break;
                        }
                    }
                    statusMsg += `\n🔄 Parent quest "${parentId}" resumed to ACTIVE.`;
                }

                try {
                    const fuResult = runAlgo('follow_up_algo', `fu_${new Date().getTime()}`, `Quest: ${questId}\nDescription: ${questDesc}`);
                    const fuJson = JSON.parse(fuResult.join('').match(/\{[\s\S]*?\}/)![0]);
                    
                    const displayQuestId = questId.replace(/_/g, ' ');
                    const msg = [
                        `🌟 *follow-up quest suggested*`,
                        `parent: ${displayQuestId}`,
                        `parent desc: ${questDesc}`,
                        ``,
                        `id: \`${fuJson.suggested_quest_id.replace(/_/g, ' ')}\``,
                        `weight: ${fuJson.weight}`,
                        `desc: ${fuJson.description}`,
                        `\n_reply naturally to create or reject_`
                    ].join('\n');
                    queueOutboxMessage_(fuJson.suggested_quest_id, msg, 'subquest', JSON.stringify(fuJson));
                } catch(e) {}
            } 
            else if (action === 'REPEAT') {
                questSheet.getRange(row, 5).setValue(1); // Set current_score to 1
                statusMsg = `✅ Quest "${questId}" returned to ACTIVE. Score reset.`;
            }
            else if (action === 'SUCKS') {
                statusMsg = `❌ Quest "${questId}" flagged as unsatisfactory. Generating solutions...`;
                
                let reportContent = '';
                if (latestDocUrl && typeof readDocContent === 'function') {
                    reportContent = readDocContent(latestDocUrl);
                }

                try {
                    const sqPrompt = `Quest: ${questId}\nDescription: ${questDesc}\n\nExecution Report:\n${reportContent.substring(0, 3000)}`;
                    const sqResult = runAlgo('subquest_proposal_algo', `sq_${new Date().getTime()}`, sqPrompt);
                    const sqJson = JSON.parse(sqResult.join('').match(/\{[\s\S]*?\}/)![0]);
                    
                    const displayQuestId = questId.replace(/_/g, ' ');
                    const msg = [
                        `🧩 *subquest proposed* (requirement for ${displayQuestId})`,
                        `parent desc: ${questDesc}`,
                        ``,
                        `id: \`${sqJson.suggested_id.replace(/_/g, ' ')}\``,
                        `weight: ${sqJson.weight || 50}`,
                        `desc: ${sqJson.description}`,
                        `\n_reply naturally to approve or reject_`
                    ].join('\n');
                    queueOutboxMessage_(sqJson.suggested_id, msg, 'subquest', JSON.stringify({
                        parentId: questId, suggestedId: sqJson.suggested_id, weight: sqJson.weight || 50, description: sqJson.description
                    }));
                } catch(e) {}

                try {
                    const agentPrompt = `Quest: ${questId}\nExec Report:\n${reportContent.substring(0, 3000)}\nUser Feedback: ${feedback}`;
                    const agentResult = runAlgo('agentalgo', `agent_${new Date().getTime()}`, agentPrompt);
                    const agentJson = JSON.parse(agentResult.join('').match(/\{[\s\S]*?\}/)![0]);
                    
                    if (agentJson.lessons && agentJson.lessons.length > 0) {
                        for (const lesson of agentJson.lessons) {
                            const msg = [
                                `💡 *Agent Tip Proposed*`,
                                `Agent: \`${lesson.agent_id}\``,
                                `Tip: ${lesson.lesson}`,
                                `\n_Reply to accept, reject, or modify._`
                            ].join('\n');
                            queueOutboxMessage_(lesson.agent_id, msg, 'agent', JSON.stringify(lesson));
                        }
                    }
                } catch(e) {}
            }
            break;
        }
    }

    SpreadsheetApp.flush();
    return { statusMsg, triggerNext: true };
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

    sheet.appendRow([
        subId,
        descToUse,
        'ACTIVE',    // status
        weight,      // weight
        1,           // current_score
        parentId,    // parent_id
    ]);

    // Pause parent
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === parentId) {
            sheet.getRange(i + 1, 3).setValue('PAUSED');
        }
    }

    SpreadsheetApp.flush();
    const displaySubId = subId.replace(/_/g, ' ');
    const displayParentId = parentId.replace(/_/g, ' ');
    return `✅ subquest created!\nid: ${displaySubId}\nparent: ${displayParentId}\nweight: ${weight}\n(parent "${displayParentId}" paused)`;
}

// ─── Active Quests TaskBot Listing ──────────────────────────

function sendActiveQuestsList_(): void {
    const sheet = getQuestsSheet_();
    const data = sheet.getDataRange().getValues();
    
    // Extract active quests
    const activeQuests: {id: string, weight: number, score: number, desc: string}[] = [];
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][2]).trim().toUpperCase() === 'ACTIVE') {
            activeQuests.push({
                id: String(data[i][0]).trim(),
                desc: String(data[i][1]).trim(),
                weight: Number(data[i][3]) || 0,
                score: Number(data[i][4]) || 0
            });
        }
    }

    if (activeQuests.length === 0) {
        if (typeof getTaskBotToken === 'function' && typeof getAdminChatId === 'function') {
            sendReply(getTaskBotToken(), getAdminChatId(), ["*No active quests currently.*"]);
        }
        return;
    }

    // Sort by current_score descending
    activeQuests.sort((a, b) => b.score - a.score);
    
    // Top 12
    const topQuests = activeQuests.slice(0, 12);
    
    const lines = ["📋 *Top Active Quests*"];
    lines.push("");
    
    for (let i = 0; i < topQuests.length; i++) {
        const q = topQuests[i];
        const safeId = q.id.replace(/_/g, '\\_').replace(/\*/g, '\\*');
        lines.push(`${i + 1}\\. *${safeId}*`);
        lines.push(`_${q.desc}_`);
        lines.push("");
    }
    
    if (activeQuests.length > 12) {
        lines.push(`... and ${activeQuests.length - 12} more.`);
    }

    if (typeof getTaskBotToken === 'function' && typeof getAdminChatId === 'function') {
        try {
            sendReply(getTaskBotToken(), getAdminChatId(), [lines.join('\n')]);
        } catch(e) {
            Logger.log(`[QUEST_ENGINE] Failed to send active quests: ${e}`);
        }
    }
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
        
        // 3. Quest refs
        if (typeof getQuestReferencesPayload === 'function') {
            try {
                const refs = getQuestReferencesPayload(quest.questId);
                Logger.log(`✓ Quest refs payload available`);
            } catch(e) {}
        }
    } else {
        Logger.log('⚠ No quest selected (all awaiting feedback or none active)');
    }

    // 4. Agent config
    try {
        const cfg = getAlgoConfig('questalgo');
        Logger.log(`✓ questalgo config loaded: model=${cfg.model}`);
    } catch (e) {
        Logger.log(`✗ questalgo NOT FOUND in AgentManifest! Add it before running quests. Error: ${e}`);
    }

    Logger.log('=== SMOKE TEST COMPLETE ===');
}
