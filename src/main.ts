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

function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
    try {
        const update: TelegramUpdate = JSON.parse(e.postData.contents);

        if (!update.message?.text) {
            return ContentService.createTextOutput("OK");
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

        // Telegram needs a simple HTTP 200 OK plain text acknowledgment. 
        // Returning JSON without a "method" field makes Telegram think the response is malformed, so it retries.
        return ContentService.createTextOutput("OK");

    } catch (err) {
        Logger.log(`[MAIN] Fatal dispatcher error: ${err}`);
        // Send the actual error to admin so it's visible on Telegram
        try {
            const adminChat = getAdminChatId();
            sendReply(getMasterBotToken(), adminChat, [`🚨 SAM4 Fatal Error:\n${String(err)}`]);
        } catch (_) { /* last resort — ignore if even this fails */ }
        
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
