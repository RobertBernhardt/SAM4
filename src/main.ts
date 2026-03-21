/**
 * main.ts — Pure dispatcher for the SAM4 multi-bot system.
 *
 * Routes incoming Telegram webhooks to the appropriate SAM algorithm
 * based on the bot token (provided in the URL query params).
 */

// ─── Telegram Types ─────────────────────────────────────────

interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        from: { id: number; first_name: string; username?: string };
        chat: { id: number; type: string };
        date: number;
        text?: string;
    };
}

// ─── Telemetry ────────────────────────────────────────────────

function telemetryLog_(updateId: string, status: string, info: string): void {
    try {
        const ss = typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.openById(getStateSpreadsheetId()) : null;
        if (!ss) return;
        
        let sheet = ss.getSheetByName('WebhookLogs');
        if (!sheet) {
            sheet = ss.insertSheet('WebhookLogs');
            sheet.appendRow(['Timestamp', 'Update ID', 'Status', 'Info']);
            sheet.setFrozenRows(1);
        }
        
        // Truncate long strings for neatness
        const cleanInfo = info.length > 500 ? info.substring(0, 500) + "..." : info;
        sheet.appendRow([new Date().toISOString(), updateId, status, cleanInfo]);
    } catch (_) { /* Fail silently to not crash the webhook */ }
}

// ─── Webhook Dispatcher ─────────────────────────────────────

function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
    try {
        // --- 1. Catch Malformed Webhooks ---
        if (!e || !e.postData || !e.postData.contents) {
            telemetryLog_('UNKNOWN', 'MALFORMED_PING', 'Telegram sent empty or non-JSON POST data.');
            return ContentService.createTextOutput("OK");
        }

        const update: TelegramUpdate = JSON.parse(e.postData.contents);
        const updateId = String(update.update_id);
        
        // --- 2. Safely Extract Chat ID ---
        let chatId = 0;
        if (update.message?.chat?.id) {
            chatId = update.message.chat.id;
        }

        // --- 3. Webhook Deduplication (Crucial Fix) ---
        const cache = CacheService.getScriptCache();
        if (cache.get(`sam_update_${updateId}`)) {
            telemetryLog_(updateId, 'DUPLICATE_SKIPPED', 'Returned OK. If Telegram loops after this row, they rejected the Google response.');
            Logger.log(`[MAIN] Skipping duplicate update_id: ${updateId}`);
            return ContentService.createTextOutput("OK");
        }
        
        // Cache this update ID for 6 hours
        cache.put(`sam_update_${updateId}`, 'true', 21600);

        // --- 4. Skip Non-Text Messages Safely ---
        if (!update.message?.text) {
            telemetryLog_(updateId, 'IGNORED', `Ignored non-text message payload.`);
            return ContentService.createTextOutput("OK");
        }

        const text = update.message.text;
        const userName = update.message.from?.first_name || 'User';

        // --- 5. Routing ---
        const urlToken = e.parameter.token;
        const urlBot = e.parameter.bot;

        let botToken = '';
        let algoId = '';

        if (urlToken === getMasterBotToken() || urlBot === 'master') {
            botToken = getMasterBotToken();
            algoId = 'masteralgo';
        } else if (urlToken === getGemBotToken() || urlBot === 'gem') {
            botToken = getGemBotToken();
            algoId = 'gemalgo';
        } else if (urlToken === getBugBotToken() || urlBot === 'bug') {
            botToken = getBugBotToken();
            algoId = 'bugalgo';
        } else if (urlToken === getFailBotToken() || urlBot === 'fail') {
            botToken = getFailBotToken();
            algoId = 'failalgo';
        } else if (urlBot === 'task') {
            botToken = getTaskBotToken();
            algoId = 'taskalgo';
        } else {
            botToken = getMasterBotToken();
            algoId = 'masteralgo';
        }

        Logger.log(`[MAIN] Dispatching ${userName} to ${algoId}`);

        // --- 6. Execute ALGO Synchronously ---
        const uid = typeof generateUid === 'function' ? generateUid() : String(new Date().getTime());
        
        telemetryLog_(updateId, 'EXECUTING_SYNC', `Routed to ${algoId} for User ${userName}: "${text}"`);
        
        // Let Google Apps script take its sweet time (up to 6 minutes) 
        // because Cloudflare intercepts and instantly shields Telegram!
        const results = runAlgo(algoId, uid, text);
        sendReply(botToken, chatId, results);

        // --- 7. Ghost Reply ---
        // We explicitly tell Google to finish. Cloudflare will catch whatever 
        // 302 garbage Google throws and safely drop it.
        telemetryLog_(updateId, 'SUCCESS', 'Script completely finished the synchronous run.');
        return ContentService.createTextOutput("OK");

    } catch (err) {
        telemetryLog_('ERROR', 'FATAL_CRASH', String(err));
        Logger.log(`[MAIN] Fatal dispatcher error: ${err}`);
        try {
            const adminChat = getAdminChatId();
            sendReply(getMasterBotToken(), adminChat, [`🚨 SAM4 Fatal Error:\n${String(err)}`]);
        } catch (_) { /* ignore */ }
        return ContentService.createTextOutput("OK");
    }
}

// ─── Manual Tests ───────────────────────────────────────────

function testMasterAlgo(): void {
    const uid = generateUid();
    const result = runAlgo('masteralgo', uid, 'What is 42 * 10?');
    Logger.log(JSON.stringify(result, null, 2));
}

function testGemAlgo(): void {
    const uid = generateUid();
    const result = runAlgo('gemalgo', uid, 'Find some frontend design gems');
    Logger.log(JSON.stringify(result, null, 2));
}

// ─── Webhook Diagnostic Tool ───────────────────────────────

/**
 * Run this function from the Apps Script editor to get EXACTLY 
 * why Telegram thinks the webhook failed and why it's retrying.
 */
function debugWebhookStatus(): void {
    const token = getMasterBotToken();
    const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
    
    try {
        const response = UrlFetchApp.fetch(url, { method: 'get' });
        const data = JSON.parse(response.getContentText());
        Logger.log(`\n========== TELEGRAM WEBHOOK INTERNAL STATUS ==========\n`);
        Logger.log(JSON.stringify(data.result, null, 2));
        
        if (data?.result?.last_error_message) {
            Logger.log(`\n🚨 TELEGRAM'S EXACT COMPLAINT: ${data.result.last_error_message}`);
            Logger.log(`🚨 TIME OF ERROR: ${new Date(data.result.last_error_date * 1000).toLocaleString()}`);
        } else {
            Logger.log(`\n✅ Telegram reports NO webhook delivery errors on this URL!`);
        }
        Logger.log(`\n======================================================\n`);
    } catch (e) {
        Logger.log(`[DEBUG] Failed to fetch webhook info from Telegram: ${e}`);
    }
}

// ─── Utility to Clear Telegram Webhook Queue ───────────────

/**
 * Run this function from the Apps Script editor (select "clearWebhookQueue" in the dropdown and hit Run).
 * It will delete the active webhook for the master bot AND drop all stuck pending updates (like the New York loop),
 * then you can reset your webhook URL.
 */
function clearWebhookQueue(): void {
    const token = getMasterBotToken();
    const url = `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`;
    
    try {
        const response = UrlFetchApp.fetch(url, { method: 'post' });
        Logger.log(`[WEBHOOK] Successfully dropped queue: ${response.getContentText()}`);
        
        // Note: You will need to re-set your webhook with your Web App URL after running this.
        Logger.log(`[WEBHOOK] Now go to your browser and re-set your webhook by visiting:\n` +
                   `https://api.telegram.org/bot${token}/setWebhook?url=<YOUR_NEW_DEPLOYMENT_URL>?bot=master`);
    } catch (e) {
        Logger.log(`[WEBHOOK] Failed to clear queue: ${e}`);
    }
}
