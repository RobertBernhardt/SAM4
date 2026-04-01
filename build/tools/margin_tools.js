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
 * Formula: (worst_case * (100 - prob)/100) + (best_case * prob/100)
 */
function calculateExpectedValue_(worst, best, probBest) {
    return (worst * (100 - probBest) / 100) + (best * probBest / 100);
}
/**
 * Calculates marginal hourly value.
 * Formula: (expected_value / (duration / 60))
 */
function calculateMarginalHourlyValue_(expectedValue, durationMin) {
    if (durationMin <= 0)
        return 0;
    return (expectedValue / (durationMin / 60));
}
/**
 * Updates the scores of all active tasks and picks the new "is_chosen" task.
 *
 * @param excludedId The ID of the task that was just executed/skipped/killed.
 */
function updateScoresAndChooseNextTask_(excludedId) {
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
    let nextTaskName = 'none';
    let winnerRow = -1;
    for (let i = 1; i < data.length; i++) {
        const taskId = data[i][idIdx];
        const state = data[i][stateIdx];
        const currentScore = Number(data[i][scoreIdx]) || 0;
        const marginal = Number(data[i][marginalIdx]) || 0;
        if (state === 'active') {
            let newScore = currentScore;
            // Inflate score for all active tasks EXCEPT the one that was just handled
            if (taskId !== excludedId) {
                newScore += Math.ceil(marginal);
            }
            sheet.getRange(i + 1, scoreIdx + 1).setValue(newScore);
            sheet.getRange(i + 1, chosenIdx + 1).setValue(false);
            if (newScore > maxScore) {
                maxScore = newScore;
                nextTaskName = data[i][nameIdx];
                winnerRow = i + 1;
            }
        }
        else {
            sheet.getRange(i + 1, chosenIdx + 1).setValue(false);
        }
    }
    if (winnerRow !== -1) {
        sheet.getRange(winnerRow, chosenIdx + 1).setValue(true);
    }
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
        return { error: "no active task found" };
    const taskRow = data[activeRowIdx];
    const taskId = taskRow[idIdx];
    const oldWorst = Number(taskRow[worstIdx]);
    const oldBest = Number(taskRow[bestIdx]);
    const oldProb = Number(taskRow[probIdx]);
    const oldDuration = Number(taskRow[durationIdx]);
    // 1. Calculate expected value (old expectations)
    const expectedValue = calculateExpectedValue_(oldWorst, oldBest, oldProb);
    // 2. Calculate earned value
    let earnedValue = 0;
    if (args.is_completed) {
        earnedValue = expectedValue;
    }
    else {
        earnedValue = (args.duration_spent / oldDuration) * expectedValue;
        if (earnedValue > expectedValue)
            earnedValue = expectedValue;
    }
    earnedValue = Math.round(earnedValue * 100) / 100;
    // 3. Log it to tasklogs
    const logSheet = getMarginSheet_(MARGIN_LOGS_SHEET);
    logSheet.appendRow([
        Utilities.getUuid(),
        taskId,
        new Date().toISOString(),
        args.duration_spent,
        earnedValue
    ]);
    // 4. Update task expectations (if provided)
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
    // 5. Reset score of THIS task to 1 so inflation skipping logic works
    sheet.getRange(rowNum, scoreIdx + 1).setValue(1);
    sheet.getRange(rowNum, chosenIdx + 1).setValue(false);
    // 6. The gamification scoring round & pick new task
    const nextTaskName = updateScoresAndChooseNextTask_(taskId);
    return { next_task: nextTaskName };
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
    return { result: `logged extra task: ${args.description} for ${args.value} €` };
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
    return { result: `created task: ${args.name}`, task_id: taskId };
}
/**
 * Tool: Kill or skip the active task.
 */
function executeMarginalKillSkip(args) {
    const sheet = getMarginSheet_(MARGIN_TASKS_SHEET);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('task_id');
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
        return { error: "no active task found" };
    const rowNum = activeRowIdx + 1;
    const taskId = data[activeRowIdx][idIdx];
    if (args.action === 'skip') {
        const logSheet = getMarginSheet_(MARGIN_LOGS_SHEET);
        logSheet.appendRow([
            Utilities.getUuid(),
            taskId,
            new Date().toISOString(),
            0, // 0 minutes
            0 // 0 €
        ]);
        sheet.getRange(rowNum, scoreIdx + 1).setValue(1);
    }
    else if (args.action === 'kill') {
        sheet.getRange(rowNum, stateIdx + 1).setValue('killed');
        sheet.getRange(rowNum, scoreIdx + 1).setValue(1);
    }
    sheet.getRange(rowNum, chosenIdx + 1).setValue(false);
    const nextTaskName = updateScoresAndChooseNextTask_(taskId);
    return { next_task: nextTaskName };
}
/**
 * Tool: Get evaluation data for today and yesterday.
 */
function executeMarginalGetEval() {
    try {
        const sheet = getMarginSheet_(MARGIN_EVAL_SHEET);
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1)
            return { result: "no evaluation data available yet" };
        const lastTwo = data.slice(-2);
        return { evaluation_data: lastTwo };
    }
    catch (e) {
        return { error: String(e) };
    }
}
/**
 * Tool: Get the current active task name.
 * Scans the tasks sheet for state='active' and is_chosen=TRUE.
 */
function executeMarginalGetCurrentTask() {
    try {
        const sheet = getMarginSheet_(MARGIN_TASKS_SHEET);
        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const nameIdx = headers.indexOf('name');
        const stateIdx = headers.indexOf('state');
        const chosenIdx = headers.indexOf('is_chosen');
        for (let i = 1; i < data.length; i++) {
            if (data[i][stateIdx] === 'active' && (data[i][chosenIdx] === true || data[i][chosenIdx] === 'TRUE')) {
                return { result: data[i][nameIdx] };
            }
        }
        return { result: "no active task found" };
    }
    catch (e) {
        return { error: String(e) };
    }
}
