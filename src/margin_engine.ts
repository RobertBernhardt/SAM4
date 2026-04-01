/**
 * margin_engine.ts — Background triggers and logic for SAM4 Margin.
 */

/**
 * 6h Purge Trigger.
 * 1. Fetch all active tasks.
 * 2. EXEMPT the currently chosen task (is_chosen = TRUE) from the purge.
 * 3. Sort remaining by marginal_hourly_value ascending.
 * 4. Kill the bottom 1% (at least 1 if total > 0).
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
            const isChosen = data[i][chosenIdx] === true || data[i][chosenIdx] === 'TRUE';
            // PER USER REQUIREMENT: Any task where is_chosen === true is absolutely immune to the purge.
            if (data[i][stateIdx] === 'active' && !isChosen) {
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
        for (const task of purged) {
            sheet.getRange(task.rowIdx + 1, stateIdx + 1).setValue('killed');
            purgedNames.push(task.name.toLowerCase());
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
 * 1. Calculate yesterday's performance using boundary-safe date logic.
 * 2. Update evaluation sheet.
 * 3. Generate an energetic morning report via AI.
 */
function marginal_midnight_eval(): void {
    try {
        // PER USER REQUIREMENT: Use precise date math to prevent month-boundary drift.
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - 1);
        const dateStr = Utilities.formatDate(targetDate, Session.getScriptTimeZone(), "yyyy-MM-dd");

        const yesterdayStart = new Date(targetDate);
        yesterdayStart.setHours(0, 0, 0, 0);
        const yesterdayEnd = new Date(targetDate);
        yesterdayEnd.setHours(23, 59, 59, 999);

        // 1. Calculate Chain Value (from yesterday's tasklogs)
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
            if (ts >= yesterdayStart && ts <= yesterdayEnd) {
                valueChain += Number(logData[i][logValueIdx]) || 0;
            }
        }

        // 2. Calculate Extra Value (from yesterday's extratasks)
        const extraSheet = getMarginSheet_(MARGIN_EXTRAS_SHEET);
        const extraData = extraSheet.getDataRange().getValues();
        let valueExtras = 0;
        for (let i = 1; i < extraData.length; i++) {
            const rawTs = extraData[i][0];
            if (!rawTs) continue;
            const ts = new Date(rawTs);
            if (ts >= yesterdayStart && ts <= yesterdayEnd) {
                valueExtras += Number(extraData[i][2]) || 0;
            }
        }

        const totalValue = valueChain + valueExtras;

        // 3. Update evaluation sheet
        const evalSheet = getMarginSheet_(MARGIN_EVAL_SHEET);
        const evalData = evalSheet.getDataRange().getValues();
        
        let rank = 1;
        for (let i = 1; i < evalData.length; i++) {
            if (Number(evalData[i][3]) > totalValue) { // total_value is col D
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

        // 4. Generate energetic report via AI
        const rawMetrics = {
            date: dateStr,
            valueChain: valueChain.toFixed(2),
            valueExtras: valueExtras.toFixed(2),
            totalValue: totalValue.toFixed(2),
            rank: rank,
            totalDays: evalData.length,
            rollingAvg: rollingAvg.toFixed(2),
            performanceVsAvg: performanceVsAvg.toFixed(2)
        };

        const instruction = `
            ACT AS MARVIN THE PARANOID ANDROID (DOUGLAS ADAMS STYLE). 
            GENERATE THE DAILY PERFORMANCE REPORT BASED ON THESE METRICS: ${JSON.stringify(rawMetrics)}.
            TONE: COLD, CYNICAL, DEPRESSED, BUT FUN AND ENGAGING FOR A MORNING READ.
            REQUIREMENT: ACCURATELY REPORT ALL METRICS BUT EXPRESS PROFOUND DISDAIN FOR THE SIGNIFICANCE OF THESE NUMBERS IN AN INFINITE UNIVERSE.
            FORMAT: ALL LOWER CASE. NO MARKDOWN ENTITIES EXCEPT BOLDING.
        `;

        const uid = "eval_" + dateStr + "_" + new Date().getTime();
        // Use a generic model call or a temporary logic to get the energetic tone
        // Since we want to overhaul the tone and use AI, we'll route this to an energetic variant of the agent.
        const report = runAlgo("masteralgo", uid, instruction);
        
        sendReply(getMarginBotToken(), getAdminChatId(), report);

    } catch (e) {
        Logger.log(`[MARGIN_ENGINE] Midnight eval failed: ${e}`);
    }
}
