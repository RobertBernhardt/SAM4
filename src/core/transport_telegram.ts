/**
 * transport_telegram.ts — Telegram transport layer.
 *
 * Provides a single function to send messages back to the user
 * using the bot token identified during webhook routing.
 */

/**
 * Sends one or many messages to a Telegram chat using a specific bot token.
 *
 * @param botToken The secret Telegram token for the sending bot.
 * @param chatId The destination Telegram chat ID.
 * @param messages A single string or an array of strings to send as separate messages.
 */
function sendReply(botToken: string, chatId: number, messages: string | string[]): void {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const messageArray = Array.isArray(messages) ? messages : [messages];

    for (const msg of messageArray) {
        if (!msg || msg.trim().length === 0) continue;

        const payload = {
            chat_id: chatId,
            text: msg,
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
            Logger.log(`[TRANSPORT] Failed to send message: HTTP ${statusCode} — ${response.getContentText()}`);
        } else {
            Logger.log(`[TRANSPORT] Message sent via bot token.`);
        }
    }
}
