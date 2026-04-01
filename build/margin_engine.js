/**
 * margin_engine.ts — Background triggers and logic for SAM4 Margin.
 */
/**
 * 6h Purge Trigger.
 * Kills the bottom 1% of active tasks by marginal hourly value.
 */
function marginal_6h_purge() {
    try {
        const sheet = getMarginSheet_(MARGIN_TASKS_SHEET);
        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const idIdx = headers.indexOf('task_id');
        const nameIdx = headers.indexOf('name');
        const marginalIdx = headers.indexOf('marginal_hourly_value');
        const stateIdx = headers.indexOf('state');
        const activeTasks = [];
        for (let i = 1; i < data.length; i++) {
            if (data[i][stateIdx] === 'active') {
                activeTasks.push({
                    rowIdx: i,
                    id: data[i][idIdx],
                    name: data[i][nameIdx],
                    marginal: Number(data[i][marginalIdx]) || 0
                });
            }
        }
        if (activeTasks.length === 0)
            return;
        // Sort by marginal value ascending
        activeTasks.sort((a, b) => a.marginal - b.marginal);
        // Calculate 1% limit (at least 1)
        const purgeCount = Math.max(1, Math.ceil(activeTasks.length * 0.01));
        const purged = activeTasks.slice(0, purgeCount);
        const purgedNames = [];
        for (const task of purged) {
            sheet.getRange(task.rowIdx + 1, stateIdx + 1).setValue('killed');
            purgedNames.push(task.name);
        }
        // Send Telegram notification
        const msg = `*purge complete*\n\nthe following tasks have been eliminated due to their pathetic marginal value:\n- ${purgedNames.join('\n- ')}\n\nanother victory for entropy.`;
        sendReply(getMarginBotToken(), getAdminChatId(), [msg]);
    }
    catch (e) {
        Logger.log(`[MARGIN_ENGINE] Purge failed: ${e}`);
    }
}
/**
 * Midnight Evaluation Trigger.
 * Aggregates daily performance and updates taskevaluation.
 */
function marginal_midnight_eval() {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];
        // 1. Sum logs from yesterday
        const logSheet = getMarginSheet_(MARGIN_LOGS_SHEET);
        const logData = logSheet.getDataRange().getValues();
        let valueChain = 0;
        for (let i = 1; i < logData.length; i++) {
            const ts = new Date(logData[i][2]);
            if (ts >= yesterday && ts < today) {
                valueChain += Number(logData[i][4]) || 0;
            }
        }
        // 2. Sum extras from yesterday
        const extraSheet = getMarginSheet_(MARGIN_EXTRAS_SHEET);
        const extraData = extraSheet.getDataRange().getValues();
        let valueExtras = 0;
        for (let i = 1; i < extraData.length; i++) {
            const ts = new Date(extraData[i][0]);
            if (ts >= yesterday && ts < today) {
                valueExtras += Number(extraData[i][2]) || 0;
            }
        }
        const totalValue = valueChain + valueExtras;
        // 3. Update evaluation sheet
        const evalSheet = getMarginSheet_(MARGIN_EVAL_SHEET);
        const evalData = evalSheet.getDataRange().getValues();
        // Calculate rolling average (last 10 days)
        let totalLast10 = totalValue;
        let countLast10 = 1;
        for (let i = Math.max(1, evalData.length - 9); i < evalData.length; i++) {
            totalLast10 += Number(evalData[i][3]) || 0;
            countLast10++;
        }
        const rollingAvg = totalLast10 / countLast10;
        const performanceVsAvg = totalValue - rollingAvg;
        // Rank days (placeholder logic, real rank would need sorting all days)
        // For now, let's just append the row and then calculate rank in the sheet?
        // No, user wants it done in GAS.
        const allTotals = evalData.slice(1).map(r => Number(r[3])).concat(totalValue);
        allTotals.sort((a, b) => b - a);
        const rank = allTotals.indexOf(totalValue) + 1;
        evalSheet.appendRow([
            dateStr,
            valueChain.toFixed(2),
            valueExtras.toFixed(2),
            totalValue.toFixed(2),
            rank,
            rollingAvg.toFixed(2),
            performanceVsAvg.toFixed(2)
        ]);
        // 4. Daily summary Telegram message
        const msg = `*daily performance report: ${dateStr}*\n\n` +
            `chain value: ${valueChain.toFixed(2)} €\n` +
            `extra value: ${valueExtras.toFixed(2)} €\n` +
            `total value: ${totalValue.toFixed(2)} €\n\n` +
            `rank: ${rank} of ${allTotals.length} days\n` +
            `rolling average: ${rollingAvg.toFixed(2)} €\n` +
            `performance vs avg: ${performanceVsAvg.toFixed(2)} €\n\n` +
            `don't get too excited. it's all just numbers in a void.`;
        sendReply(getMarginBotToken(), getAdminChatId(), [msg]);
    }
    catch (e) {
        Logger.log(`[MARGIN_ENGINE] Midnight eval failed: ${e}`);
    }
}
