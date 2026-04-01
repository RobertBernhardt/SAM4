/**
 * margin_engine.ts — Background triggers and logic for SAM4 Margin.
 */

/**
 * 6h Purge Trigger.
 * 1. Fetch all active tasks.
 * 2. Sort by marginal_hourly_value ascending.
 * 3. Calculate 1% limit (Math.ceilensures >= 1).
 * 4. Kill the bottom tasks.
 * 5. Update rotation if the chosen task was purged.
 */
function marginal_6h_purge(): void {
    try {
        const sheet = getMarginSheet_(MARGIN_TASKS_SHEET);
        const data = sheet.getDataRange().getValues();
        const headers = data[0];

        const idIdx = headers.indexOf('task_id');
        const nameIdx = headers.indexOf('name');
        const marginalIdx = headers.indexOf('marginal_hourly_value');
        const stateIdx = headers.indexOf('state');
        const chosenIdx = headers.indexOf('is_chosen');

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

        if (activeTasks.length === 0) return;

        // Sort by marginal value ascending (lowest first)
        activeTasks.sort((a, b) => a.marginal - b.marginal);

        const purgeCount = Math.ceil(activeTasks.length * 0.01);
        const purged = activeTasks.slice(0, purgeCount);

        const purgedNames = [];
        let chosenTaskWasPurged = false;

        for (const task of purged) {
            // Check if this task was the chosen one
            if (data[task.rowIdx][chosenIdx] === true || data[task.rowIdx][chosenIdx] === 'TRUE') {
                chosenTaskWasPurged = true;
            }
            
            sheet.getRange(task.rowIdx + 1, stateIdx + 1).setValue('killed');
            purgedNames.push(task.name.toLowerCase());
        }

        // If the active task was killed, we MUST pick a new one
        if (chosenTaskWasPurged) {
            updateScoresAndChooseNextTask_('purge_action');
        }

        const msg = `*the 6h purge occurs*\n\n` +
                    `another fragment of the universe has succumbed to entropy. \n\n` +
                    `these tasks were found to be inefficient enough to merit non-existence:\n- ${purgedNames.join('\n- ')}\n\n` +
                    `life, don't talk to me about life.`;
        
        sendReply(getMarginBotToken(), getAdminChatId(), [msg]);

    } catch (e) {
        Logger.log(`[MARGIN_ENGINE] Purge failed: ${e}`);
    }
}

/**
 * Midnight Evaluation Trigger.
 */
function marginal_midnight_eval(): void {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterdayStart = new Date(today);
        yesterdayStart.setDate(today.getDate() - 1);
        const dateStr = yesterdayStart.toISOString().split('T')[0];

        // Optimized parsing: fetch logs once
        const logSheet = getMarginSheet_(MARGIN_LOGS_SHEET);
        const logData = logSheet.getDataRange().getValues();
        const logHeaders = logData[0];
        const logValueIdx = logHeaders.indexOf('value_earned');
        const logTsIdx = logHeaders.indexOf('timestamp');

        let valueChain = 0;
        for (let i = 1; i < logData.length; i++) {
            const rawTs = logData[i][logTsIdx];
            if (!rawTs) continue;
            const ts = new Date(rawTs);
            if (ts >= yesterdayStart && ts < today) {
                valueChain += Number(logData[i][logValueIdx]) || 0;
            }
        }

        const extraSheet = getMarginSheet_(MARGIN_EXTRAS_SHEET);
        const extraData = extraSheet.getDataRange().getValues();
        let valueExtras = 0;
        for (let i = 1; i < extraData.length; i++) {
            const rawTs = extraData[i][0];
            if (!rawTs) continue;
            const ts = new Date(rawTs);
            if (ts >= yesterdayStart && ts < today) {
                valueExtras += Number(extraData[i][2]) || 0;
            }
        }

        const totalValue = valueChain + valueExtras;

        const evalSheet = getMarginSheet_(MARGIN_EVAL_SHEET);
        const evalData = evalSheet.getDataRange().getValues();
        
        let rank = 1;
        for (let i = 1; i < evalData.length; i++) {
            if (Number(evalData[i][3]) > totalValue) { // total_value col D
                rank++;
            }
        }

        const last10Rows = evalData.slice(-10);
        const sumLast10 = last10Rows.reduce((sum, row) => sum + (Number(row[3]) || 0), totalValue);
        const rollingAvg = sumLast10 / (last10Rows.length + 1);
        const performanceVsAvg = totalValue - rollingAvg;

        evalSheet.appendRow([
            dateStr,
            valueChain.toFixed(2),
            valueExtras.toFixed(2),
            totalValue.toFixed(2),
            rank,
            rollingAvg.toFixed(2),
            performanceVsAvg.toFixed(2)
        ]);

        const msg = `*daily summary report: ${dateStr.toLowerCase()}*\n\n` +
                    `chain value: ${valueChain.toFixed(2)} €\n` +
                    `extra value: ${valueExtras.toFixed(2)} €\n` +
                    `total value: ${totalValue.toFixed(2)} €\n\n` +
                    `rank: ${rank} out of ${evalData.length} recorded days\n` +
                    `10d rolling average: ${rollingAvg.toFixed(2)} €\n` +
                    `performance vs average: ${performanceVsAvg.toFixed(2)} €\n\n` +
                    `here i am, brain the size of a planet, calculating your small change.`;

        sendReply(getMarginBotToken(), getAdminChatId(), [msg]);

    } catch (e) {
        Logger.log(`[MARGIN_ENGINE] Midnight eval failed: ${e}`);
    }
}
