/**
 * queue.ts — Background Queue System to detach Telegram webhook from runAlgo()
 *
 * Persists tasks in a Google Sheet so they survive regardless of
 * Telegram limits or GAS 30s-60s webhook termination timeouts.
 */

interface EnqueuePayload {
    uid: string;
    botToken: string;
    algoId: string;
    chatId: number;
    text: string;
    userName: string;
}

function getOrCreateQueueSheet_(): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.openById(getStateSpreadsheetId());
    let sheet = ss.getSheetByName(QUEUE_SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(QUEUE_SHEET_NAME);
        sheet.appendRow(['UID', 'Timestamp', 'Status', 'BotToken', 'AlgoId', 'ChatId', 'Text', 'UserName']);
        sheet.setFrozenRows(1);
    }
    return sheet;
}

/**
 * Pushes a new task to the bottom of the Sheet.
 */
function enqueueTask(payload: EnqueuePayload): void {
    const sheet = getOrCreateQueueSheet_();
    sheet.appendRow([
        payload.uid,
        new Date().toISOString(),
        'PENDING',
        payload.botToken,
        payload.algoId,
        String(payload.chatId),
        payload.text,
        payload.userName
    ]);
}

/**
 * Main cron function. You MUST attach this function to a
 * Time-Driven 1-Minute trigger in the GAS Apps Script Dashboard.
 */
function processQueue(): void {
    const sheet = getOrCreateQueueSheet_();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return; // Only headers or completely empty

    const startTime = new Date().getTime();
    // 4.5 minutes is the safe margin before the 6-minute absolute GAS kill switch
    const MAX_EXECUTION_MS = 4.5 * 60 * 1000; 

    // Go chronologically
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const status = row[2];

        // Skip anything not strictly PENDING
        if (status !== 'PENDING') continue;

        // Ensure we haven't breached the script execution timeout
        if (new Date().getTime() - startTime > MAX_EXECUTION_MS) {
            Logger.log(`[QUEUE] Approaching GAS timeout limits. Halting batch. Remaining will run on next tick.`);
            break;
        }

        const uid = String(row[0]);
        const botToken = String(row[3]);
        const algoId = String(row[4]);
        const chatId = Number(row[5]);
        const text = String(row[6]);
        const userName = String(row[7]);

        // Lock row safely
        sheet.getRange(i + 1, 3).setValue('PROCESSING');
        SpreadsheetApp.flush(); // Commit write before running algo to prevent race conditions

        Logger.log(`[QUEUE] Executing detached task ${uid} for ${algoId}`);

        try {
            // Heavy Lifter
            const results = runAlgo(algoId, uid, text);
            
            // Transport Layer
            sendReply(botToken, chatId, results);
            
            // Complete
            sheet.getRange(i + 1, 3).setValue('DONE');
        } catch (err) {
            Logger.log(`[QUEUE] Task failed: ${err}`);
            sheet.getRange(i + 1, 3).setValue('FAILED');
            
            try {
                const adminChat = getAdminChatId();
                sendReply(getMasterBotToken(), adminChat, [`🚨 SAM4 QUEUE Error for ${algoId}:\n${String(err)}`]);
            } catch (_) {}
        }
    }

    // After processing, sweep up to keep sheet performance O(1)
    cleanupQueue_(sheet);
}

/**
 * Sweeps the queue to physically remove rows containing 'DONE' or 'FAILED'
 * Iterates backwards to prevent bounds shifting after deletions.
 */
function cleanupQueue_(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
    const data = sheet.getDataRange().getValues();
    
    for (let i = data.length - 1; i > 0; i--) {
        const rowStatus = data[i][2];
        if (rowStatus === 'DONE' || rowStatus === 'FAILED') {
            sheet.deleteRow(i + 1);
        }
    }
}
