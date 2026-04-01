/**
 * margin_tools.ts — Logic for the SAM4 Margin gamification system.
 */
/**
 * Opens the margin sheet and returns it.
 */
function getMarginSheet_(name) {
    const ss = SpreadsheetApp.openById(getSamSheetId());
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        throw new Error(`[MARGIN] Sheet "${name}" not found in SAM spreadsheet.`);
    }
    return sheet;
}
/**
 * Calculates the expected value based on worst/best case and probability.
 */
function calculateExpectedValue_(worst, best, probBest) {
    return ((100 - probBest) * worst + probBest * best) / 100;
}
/**
 * Calculates marginal hourly value.
 */
function calculateMarginalHourlyValue_(expectedValue, durationMin) {
    if (durationMin <= 0)
        return 0;
    return (expectedValue / durationMin) * 60;
}
/**
 * Updates the scores of all active tasks and picks the new "is_chosen" task.
 * Called after a task execution, skip, or kill.
 */
function updateScoresAndChooseNextTask_() {
    const sheet = getMarginSheet_(MARGIN_TASKS_SHEET);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('task_id');
    const marginalIdx = headers.indexOf('marginal_hourly_value');
    const scoreIdx = headers.indexOf('score');
    const stateIdx = headers.indexOf('state');
    const chosenIdx = headers.indexOf('is_chosen');
    const nameIdx = headers.indexOf('name');
    let maxScore = -Infinity;
    let nextTaskId = '';
    let nextTaskName = 'None (All tasks finished or killed)';
    let bestRowIdx = -1;
    const updates = [];
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const state = row[stateIdx];
        const currentScore = Number(row[scoreIdx]) || 0;
        const marginal = Number(row[marginalIdx]) || 0;
        const isChosen = row[chosenIdx] === true || row[chosenIdx] === 'TRUE';
        if (state === 'active') {
            let newScore = currentScore;
            // If it WAS chosen, it was just executed/skipped/killed elsewhere, 
            // BUT this function is called AFTER that reset. 
            // Actually, if it's still active, we inflate it IF it's not the one we just reset.
            // Wait, the logic says: "all the other tasks get their score increased by their marginal hourly value... except for the one which has been executed, which gets set back to 1."
            // If the task was just executed, its score should already be 1 (set by the calling tool).
            // We increase score for ALL active tasks that have score > 1? 
            // No, the rule is simpler: all OTHER tasks get increased.
            if (currentScore > 1) {
                newScore += Math.ceil(marginal);
            }
            updates.push({ row: i + 1, score: newScore, isChosen: false });
            if (newScore > maxScore) {
                maxScore = newScore;
                nextTaskId = row[idIdx];
                nextTaskName = row[nameIdx];
                bestRowIdx = updates.length - 1;
            }
        }
        else {
            // Task is completed or killed, ensure is_chosen is false
            if (isChosen) {
                updates.push({ row: i + 1, score: currentScore, isChosen: false });
            }
        }
    }
    // Mark the winner
    if (bestRowIdx !== -1) {
        updates[bestRowIdx].isChosen = true;
    }
    // Apply updates to sheet
    updates.forEach(u => {
        sheet.getRange(u.row, scoreIdx + 1).setValue(u.score);
        sheet.getRange(u.row, chosenIdx + 1).setValue(u.isChosen);
    });
    return nextTaskName;
}
/**
 * Tool: Log execution of the active task.
 */
function executeMarginalLogExecution(args) {
    const sheet = getMarginSheet_(MARGIN_TASKS_SHEET);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('task_id');
    const nameIdx = headers.indexOf('name');
    const worstIdx = headers.indexOf('worst_case_value');
    const bestIdx = headers.indexOf('best_case_value');
    const probIdx = headers.indexOf('probability_best');
    const durationIdx = headers.indexOf('expected_duration_min');
    const stateIdx = headers.indexOf('state');
    const chosenIdx = headers.indexOf('is_chosen');
    const scoreIdx = headers.indexOf('score');
    const marginalIdx = headers.indexOf('marginal_hourly_value');
    let activeRowIdx = -1;
    for (let i = 1; i < data.length; i++) {
        if (data[i][chosenIdx] === true || data[i][chosenIdx] === 'TRUE') {
            activeRowIdx = i;
            break;
        }
    }
    if (activeRowIdx === -1)
        return "No active task found to log execution against.";
    const taskRow = data[activeRowIdx];
    const taskId = taskRow[idIdx];
    const oldWorst = Number(taskRow[worstIdx]);
    const oldBest = Number(taskRow[bestIdx]);
    const oldProb = Number(taskRow[probIdx]);
    const oldDuration = Number(taskRow[durationIdx]);
    const expectedTotalValue = calculateExpectedValue_(oldWorst, oldBest, oldProb);
    // Calculate earned value: (duration_spent / expected_duration) * expected_total_value
    // But capped at expected_total_value if completed or if duration exceeds.
    let earnedValue = (args.duration_spent / oldDuration) * expectedTotalValue;
    if (args.is_completed || earnedValue > expectedTotalValue) {
        earnedValue = expectedTotalValue;
    }
    earnedValue = Math.round(earnedValue * 100) / 100;
    // 1. Write to tasklogs
    const logSheet = getMarginSheet_(MARGIN_LOGS_SHEET);
    logSheet.appendRow([
        Utilities.getUuid(),
        taskId,
        new Date().toISOString(),
        args.duration_spent,
        earnedValue
    ]);
    // 2. Update task stats
    const newWorst = args.new_worst !== undefined ? args.new_worst : oldWorst;
    const newBest = args.new_best !== undefined ? args.new_best : oldBest;
    const newProb = args.new_prob !== undefined ? args.new_prob : oldProb;
    const newDuration = args.new_duration !== undefined ? args.new_duration : oldDuration;
    const newState = args.is_completed ? 'completed' : 'active';
    const newExpectedValue = calculateExpectedValue_(newWorst, newBest, newProb);
    const newMarginal = calculateMarginalHourlyValue_(newExpectedValue, newDuration);
    const rowNum = activeRowIdx + 1;
    sheet.getRange(rowNum, worstIdx + 1).setValue(newWorst);
    sheet.getRange(rowNum, bestIdx + 1).setValue(newBest);
    sheet.getRange(rowNum, probIdx + 1).setValue(newProb);
    sheet.getRange(rowNum, durationIdx + 1).setValue(newDuration);
    sheet.getRange(rowNum, stateIdx + 1).setValue(newState);
    sheet.getRange(rowNum, marginalIdx + 1).setValue(newMarginal);
    sheet.getRange(rowNum, scoreIdx + 1).setValue(1); // Reset score
    sheet.getRange(rowNum, chosenIdx + 1).setValue(false); // Temporary, updateScoresAndChooseNextTask_ will set the new one
    // 3. Score inflation and pick next
    const nextTaskName = updateScoresAndChooseNextTask_();
    return `Logged ${args.duration_spent} min, earned ${earnedValue} €. ${args.is_completed ? 'Task completed.' : 'Task remains active.'} Next task: ${nextTaskName}`;
}
/**
 * Tool: Log an extra task (one-off).
 */
function executeMarginalLogExtra(args) {
    const sheet = getMarginSheet_(MARGIN_EXTRAS_SHEET);
    sheet.appendRow([
        new Date().toISOString(),
        args.description,
        args.value
    ]);
    return `Logged extra task: "${args.description}" for ${args.value} €.`;
}
/**
 * Tool: Create a new task.
 */
function executeMarginalCreateTask(args) {
    const sheet = getMarginSheet_(MARGIN_TASKS_SHEET);
    const expectedValue = calculateExpectedValue_(args.worst, args.best, args.prob);
    const marginal = calculateMarginalHourlyValue_(expectedValue, args.duration);
    const taskId = Utilities.getUuid().substring(0, 8);
    sheet.appendRow([
        taskId,
        args.name,
        args.worst,
        args.best,
        args.prob,
        args.duration,
        marginal,
        1, // initial score
        'active', // state
        false // is_chosen
    ]);
    return `Created new task "${args.name}" (ID: ${taskId}). Marginal value: ${marginal.toFixed(2)} €/h.`;
}
/**
 * Tool: Kill or skip the active task.
 */
function executeMarginalKillSkip(args) {
    const sheet = getMarginSheet_(MARGIN_TASKS_SHEET);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const stateIdx = headers.indexOf('state');
    const chosenIdx = headers.indexOf('is_chosen');
    const scoreIdx = headers.indexOf('score');
    let activeRowIdx = -1;
    for (let i = 1; i < data.length; i++) {
        if (data[i][chosenIdx] === true || data[i][chosenIdx] === 'TRUE') {
            activeRowIdx = i;
            break;
        }
    }
    if (activeRowIdx === -1)
        return "No active task found to " + args.action + ".";
    const rowNum = activeRowIdx + 1;
    if (args.action === 'kill') {
        sheet.getRange(rowNum, stateIdx + 1).setValue('killed');
    }
    // Both actions reset score and uncheck is_chosen before picking new
    sheet.getRange(rowNum, scoreIdx + 1).setValue(1);
    sheet.getRange(rowNum, chosenIdx + 1).setValue(false);
    const nextTaskName = updateScoresAndChooseNextTask_();
    return `Task ${args.action}ed. Next task: ${nextTaskName}`;
}
/**
 * Tool: Get evaluation data for today and yesterday.
 */
function executeMarginalGetEval() {
    try {
        const sheet = getMarginSheet_(MARGIN_EVAL_SHEET);
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1)
            return "No evaluation data available yet.";
        // Get last two rows
        const lastTwo = data.slice(-2);
        return JSON.stringify(lastTwo);
    }
    catch (e) {
        return "Error fetching eval data: " + e;
    }
}
