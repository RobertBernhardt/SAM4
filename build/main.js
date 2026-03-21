/**
 * main.ts — Pure dispatcher for the SAM4 multi-bot system.
 *
 * Routes incoming Telegram webhooks to the appropriate SAM algorithm
 * based on the bot token (provided in the URL query params).
 */
// ─── Webhook Dispatcher ─────────────────────────────────────
function doPost(e) {
    try {
        const update = JSON.parse(e.postData.contents);
        if (!update.message?.text) {
            return ContentService.createTextOutput(JSON.stringify({ ok: true, skipped: 'no text' }))
                .setMimeType(ContentService.MimeType.JSON);
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
            // Default to masteralgo if undefined
            botToken = getMasterBotToken();
            algoId = 'masteralgo';
        }
        Logger.log(`[MAIN] Dispatching ${userName} to ${algoId}`);
        const uid = generateUid();
        const results = runAlgo(algoId, uid, text);
        sendReply(botToken, chatId, results);
        return ContentService.createTextOutput(JSON.stringify({ ok: true }))
            .setMimeType(ContentService.MimeType.JSON);
    }
    catch (err) {
        Logger.log(`[MAIN] Fatal dispatcher error: ${err}`);
        // Send the actual error to admin so it's visible on Telegram
        try {
            const adminChat = getAdminChatId();
            sendReply(getMasterBotToken(), adminChat, [`🚨 SAM4 Fatal Error:\n${String(err)}`]);
        }
        catch (_) { /* last resort — ignore if even this fails */ }
        return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
            .setMimeType(ContentService.MimeType.JSON);
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
