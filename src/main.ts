/**
 * main.ts — Entry point for the SAM4 agent system.
 *
 * Exposes `doPost(e)` as a Telegram webhook handler.
 * Flow:
 *  1. Parse the incoming Telegram update.
 *  2. Generate a UID for the task.
 *  3. Pass the user message to Analgo.
 *  4. Send the response back to Telegram.
 *  5. Return 200 OK to Telegram.
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

// ─── Webhook Handler ────────────────────────────────────────

/**
 * doPost is the GAS web app entry point triggered by Telegram webhooks.
 * It must return a TextOutput to acknowledge receipt.
 */
function doPost(
    e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
    try {
        const update: TelegramUpdate = JSON.parse(e.postData.contents);

        // Only handle text messages
        if (!update.message?.text) {
            return ContentService.createTextOutput(
                JSON.stringify({ ok: true, skipped: 'no text message' })
            ).setMimeType(ContentService.MimeType.JSON);
        }

        const chatId = update.message.chat.id;
        const userText = update.message.text;
        const userName = update.message.from.first_name || 'User';

        Logger.log(`[MAIN] Incoming from ${userName} (chat ${chatId}): ${userText}`);

        // Generate unique task ID
        const uid = generateUid();
        Logger.log(`[MAIN] UID: ${uid}`);

        // Run the analysis algorithm
        const result = runAnalgo(uid, userText);

        // Send the response back to Telegram
        sendTelegramMessage_(chatId, result);

        return ContentService.createTextOutput(
            JSON.stringify({ ok: true, uid })
        ).setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        Logger.log(`[MAIN] Fatal error: ${error}`);

        return ContentService.createTextOutput(
            JSON.stringify({ ok: false, error: String(error) })
        ).setMimeType(ContentService.MimeType.JSON);
    }
}

// ─── Telegram API ───────────────────────────────────────────

/**
 * Sends a message to a Telegram chat. Uses the Telegram Bot API.
 */
function sendTelegramMessage_(chatId: number, text: string): void {
    const token = getTelegramBotToken();
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
    };

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode !== 200) {
        Logger.log(`[TELEGRAM] Failed to send message: HTTP ${statusCode} — ${response.getContentText()}`);
    }
}

// ─── Manual Test ────────────────────────────────────────────

/**
 * A convenience function to test Analgo manually from the
 * GAS editor without needing a Telegram webhook.
 */
function testAnalgo(): void {
    const uid = generateUid();
    const testInput = 'What is 42 multiplied by 13, and then break down the steps to build a simple API?';

    Logger.log(`[TEST] UID: ${uid}`);
    Logger.log(`[TEST] Input: ${testInput}`);

    const result = runAnalgo(uid, testInput);

    Logger.log(`[TEST] Result:\n${result}`);
}
