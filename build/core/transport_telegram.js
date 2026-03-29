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
function sendReply(botToken, chatId, messages) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const messageArray = Array.isArray(messages) ? messages : [messages];
    for (const msg of messageArray) {
        if (!msg || msg.trim().length === 0)
            continue;
        let payload = {
            chat_id: chatId,
            text: msg,
            parse_mode: 'Markdown',
        };
        let options = {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true,
        };
        let response = UrlFetchApp.fetch(url, options);
        let statusCode = response.getResponseCode();
        if (statusCode !== 200) {
            const errorBody = response.getContentText();
            Logger.log(`[TRANSPORT] Failed Markdown send: HTTP ${statusCode} — ${errorBody}`);
            // If Telegram throws a 400 (usually "can't parse entities"), strip Markdown and retry instantly
            if (statusCode === 400) {
                Logger.log(`[TRANSPORT] Retrying as plain text...`);
                delete payload.parse_mode;
                options.payload = JSON.stringify(payload);
                response = UrlFetchApp.fetch(url, options);
                statusCode = response.getResponseCode();
                if (statusCode === 200) {
                    Logger.log(`[TRANSPORT] Message sent successfully via plain text fallback.`);
                    continue; // Skip the error throw and move to the next message
                }
            }
            throw new Error(`Telegram API HTTP ${statusCode}: ${response.getContentText()}`);
        }
        else {
            Logger.log(`[TRANSPORT] Message sent via bot token.`);
        }
    }
}
