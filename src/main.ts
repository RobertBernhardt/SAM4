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

// ─── Webhook Dispatcher ─────────────────────────────────────

function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.HTML.HtmlOutput {
    try {
        const update: TelegramUpdate = JSON.parse(e.postData.contents);

        // --- Webhook Deduplication ---
        // If we map the updateId, return empty JSON so Telegram parses it as a no-action 200 HTTP OK.
        const updateId = String(update.update_id);
        const cache = CacheService.getScriptCache();
        if (cache.get(`sam_update_${updateId}`)) {
            Logger.log(`[MAIN] Skipping duplicate update_id: ${updateId}`);
            return HtmlService.createHtmlOutput('OK');
        }
        // Cache this update ID for 6 hours
        cache.put(`sam_update_${updateId}`, 'true', 21600);
        // ------------------------------

        if (!update.message?.text) {
            return HtmlService.createHtmlOutput('OK');
        }

        const chatId = update.message.chat.id;
        const text = update.message.text;
        const userName = update.message.from.first_name || 'User';

        // Extract bot identifier from webhook URL query parameters
        // E.g., ?bot=master or ?token=12345
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
            // Default to masteralgo if undefined
            botToken = getMasterBotToken();
            algoId = 'masteralgo';
        }

        Logger.log(`[MAIN] Dispatching ${userName} to ${algoId}`);

        const uid = generateUid();
        const results = runAlgo(algoId, uid, text);

        sendReply(botToken, chatId, results);

        // -------------------------------------------------------------
        // IMPORTANT: We use HtmlService instead of ContentService!
        // ContentService triggers an HTTP 302 Redirect before returning OK,
        // which Telegram aggressively treats as a failed Webhook and queues forever.
        // HtmlService returns a raw HTTP 200 OK directly.
        // -------------------------------------------------------------
        return HtmlService.createHtmlOutput('OK');

    } catch (err) {
        Logger.log(`[MAIN] Fatal dispatcher error: ${err}`);
        // Send the actual error to admin so it's visible on Telegram
        try {
            const adminChat = getAdminChatId();
            sendReply(getMasterBotToken(), adminChat, [`🚨 SAM4 Fatal Error:\n${String(err)}`]);
        } catch (_) { /* last resort — ignore if even this fails */ }
        
        return HtmlService.createHtmlOutput('OK');
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
