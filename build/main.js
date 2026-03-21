/**
 * main.ts — Pure dispatcher for the SAM4 multi-bot system.
 *
 * Routes incoming Telegram webhooks to the appropriate SAM algorithm
 * based on the bot token (provided in the URL query params).
 */
// ─── Webhook Dispatcher ─────────────────────────────────────
function doPost(e) {
    try {
        // --- 1. Catch Malformed Webhooks ---
        if (!e || !e.postData || !e.postData.contents) {
            return ContentService.createTextOutput("OK");
        }
        const update = JSON.parse(e.postData.contents);
        const updateId = String(update.update_id);
        // --- 2. Safely Extract Chat ID ---
        let chatId = 0;
        if (update.message?.chat?.id) {
            chatId = update.message.chat.id;
        }
        // --- 3. Webhook Deduplication (Crucial Fix) ---
        // MUST return bare ContentService. Google Apps Script POST requests
        // return raw HTTP 200 OKs ONLY for unformatted ContentService text.
        // HtmlService and MimeType.JSON forcibly trigger 302 redirects which Telegram drops.
        const cache = CacheService.getScriptCache();
        if (cache.get(`sam_update_${updateId}`)) {
            Logger.log(`[MAIN] Skipping duplicate update_id: ${updateId}`);
            return ContentService.createTextOutput("OK");
        }
        // Cache this update ID for 6 hours
        cache.put(`sam_update_${updateId}`, 'true', 21600);
        // --- 4. Skip Non-Text Messages Safely ---
        if (!update.message?.text) {
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
        }
        else if (urlToken === getGemBotToken() || urlBot === 'gem') {
            botToken = getGemBotToken();
            algoId = 'gemalgo';
        }
        else if (urlToken === getBugBotToken() || urlBot === 'bug') {
            botToken = getBugBotToken();
            algoId = 'bugalgo';
        }
        else if (urlToken === getFailBotToken() || urlBot === 'fail') {
            botToken = getFailBotToken();
            algoId = 'failalgo';
        }
        else if (urlBot === 'task') {
            botToken = getTaskBotToken();
            algoId = 'taskalgo';
        }
        else {
            botToken = getMasterBotToken();
            algoId = 'masteralgo';
        }
        Logger.log(`[MAIN] Dispatching ${userName} to ${algoId}`);
        // --- 6. Enqueue ALGO ---
        const uid = typeof generateUid === 'function' ? generateUid() : String(new Date().getTime());
        enqueueTask({
            uid: uid,
            botToken: botToken,
            algoId: algoId,
            chatId: chatId,
            text: text,
            userName: userName
        });
        // --- 7. Direct Webhook Reply ---
        // Flawlessly close the Telegram webhook loop natively.
        return ContentService.createTextOutput("OK");
    }
    catch (err) {
        Logger.log(`[MAIN] Fatal dispatcher error: ${err}`);
        try {
            const adminChat = getAdminChatId();
            sendReply(getMasterBotToken(), adminChat, [`🚨 SAM4 Fatal Error:\n${String(err)}`]);
        }
        catch (_) { /* ignore */ }
        return ContentService.createTextOutput("OK");
    }
}
// ─── Manual Tests ───────────────────────────────────────────
function testMasterAlgo() {
    const uid = generateUid();
    const result = runAlgo('masteralgo', uid, 'What is 42 * 10?');
    Logger.log(JSON.stringify(result, null, 2));
}
function testGemAlgo() {
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
function clearWebhookQueue() {
    const token = getMasterBotToken();
    const url = `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`;
    try {
        const response = UrlFetchApp.fetch(url, { method: 'post' });
        Logger.log(`[WEBHOOK] Successfully dropped queue: ${response.getContentText()}`);
        // Note: You will need to re-set your webhook with your Web App URL after running this.
        Logger.log(`[WEBHOOK] Now go to your browser and re-set your webhook by visiting:\n` +
            `https://api.telegram.org/bot${token}/setWebhook?url=<YOUR_NEW_DEPLOYMENT_URL>?bot=master`);
    }
    catch (e) {
        Logger.log(`[WEBHOOK] Failed to clear queue: ${e}`);
    }
}
