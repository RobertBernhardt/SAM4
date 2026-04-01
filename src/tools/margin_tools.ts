/**
 * margin_tools.ts — Logic for the SAM4 Margin gamification system.
 */

interface MarginTask {
    task_id: string;
    name: string;
    worst_case_value: number;
    best_case_value: number;
    probability_best: number;
    expected_duration_min: number;
    marginal_hourly_value: number;
    score: number;
    state: 'active' | 'completed' | 'killed';
    is_chosen: boolean;
}

/**
 * Opens the margin sheet and returns it.
 */
function getMarginSheet_(name: string): GoogleAppsScript.Spreadsheet.Sheet {
    const ss = SpreadsheetApp.openById(getSamSheetId());
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        throw new Error(`[MARGIN] Sheet "${name}" not found in SAM spreadsheet.`);
    }
    return sheet;
}

/**
 * Normalizes probability to a decimal between 0 and 1.
 * Handles strings like "40,00%", numbers like 40, or decimals like 0.4.
 */
function sanitizeProbability_(prob: any): number {
    if (typeof prob === 'string') {
        prob = prob.replace('%', '').replace(',', '.').trim();
    }
    const n = Number(prob);
    if (isNaN(n)) return 0;
    // If the value is > 1 (e.g., 40 for 40%), convert to decimal 0.4
    if (n > 1) return n / 100;
    return n;
}

/**
 * Calculates the expected value based on worst/best case and probability.
 * Formula: (worst * (1 - prob)) + (best * prob)
 */
function calculateExpectedValue_(worst: number, best: number, probRaw: any): number {
    const prob = sanitizeProbability_(probRaw);
    return (worst * (1 - prob)) + (best * prob);
}

/**
 * Calculates marginal hourly value.
 * Formula: (expected_value / (duration / 60))
 */
function calculateMarginalHourlyValue_(expectedValue: number, durationMin: number): number {
    if (durationMin <= 0) return 0;
    return (expectedValue / (durationMin / 60));
}

/**
 * Updates the scores of all active tasks and picks the new "is_chosen" task.
 * 
 * @param excludedId The ID of the task that was just executed/skipped/killed.
 */
function updateScoresAndChooseNextTask_(excludedId: string): string {
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
    let winnerRowIdx = -1;

    // Use a batch update approach for performance
    const scores = [];
    const chosen = [];

    for (let i = 1; i < data.length; i++) {
        const taskId = data[i][idIdx];
        const state = data[i][stateIdx];
        const currentScore = Number(data[i][scoreIdx]) || 0;
        const marginal = Number(data[i][marginalIdx]) || 0;

        let newScore = currentScore;
        let isChosen = false;

        if (state === 'active') {
            // Inflate score for all active tasks EXCEPT the one that was just handled
            if (taskId !== excludedId) {
                newScore += Math.ceil(marginal);
            }
            
            if (newScore > maxScore) {
                maxScore = newScore;
                nextTaskName = data[i][nameIdx];
                winnerRowIdx = i;
            }
        }
        
        scores.push([newScore]);
        chosen.push([isChosen]);
    }

    // Set the new winner in our local arrays
    if (winnerRowIdx !== -1) {
        chosen[winnerRowIdx - 1] = [true];
    }

    // Single batch update per column for speed
    if (scores.length > 0) {
        sheet.getRange(2, scoreIdx + 1, scores.length, 1).setValues(scores);
        sheet.getRange(2, chosenIdx + 1, chosen.length, 1).setValues(chosen);
    }

    return nextTaskName;
}

/**
 * Tool: Log execution of the active task.
 */
function executeMarginalLogExecution(args: {
    duration_spent: number,
    is_completed: boolean,
    new_worst?: number,
    new_best?: number,
    new_prob?: number,
    new_duration?: number
}): Record<string, any> {
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

    if (activeRowIdx === -1) return { error: "no active task found" };

    const taskRow = data[activeRowIdx];
    const taskId = taskRow[idIdx];
    const oldWorst = Number(taskRow[worstIdx]);
    const oldBest = Number(taskRow[bestIdx]);
    const oldProb = taskRow[probIdx]; // Keep raw for santization
    const oldDuration = Number(taskRow[durationIdx]);

    // 1. Calculate expected value (old expectations)
    const expectedValue = calculateExpectedValue_(oldWorst, oldBest, oldProb);
    
    // 2. Calculate earned value
    let earnedValue = 0;
    if (args.is_completed) {
        earnedValue = expectedValue;
    } else {
        earnedValue = (args.duration_spent / oldDuration) * expectedValue;
        if (earnedValue > expectedValue) earnedValue = expectedValue;
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
function executeMarginalLogExtra(args: { description: string, value: number }): Record<string, any> {
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
function executeMarginalCreateTask(args: {
    name: string,
    worst: number,
    best: number,
    prob: number,
    duration: number
}): Record<string, any> {
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
        1,       // initial score
        'active', // state
        false    // is_chosen
    ]);

    return { result: `created task: ${args.name}`, task_id: taskId };
}

/**
 * Tool: Kill or skip the active task.
 */
function executeMarginalKillSkip(args: { action: 'kill' | 'skip' }): Record<string, any> {
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

    if (activeRowIdx === -1) return { error: "no active task found" };

    const rowNum = activeRowIdx + 1;
    const taskId = data[activeRowIdx][idIdx];

    if (args.action === 'skip') {
        // PER USER REQUIREMENT: handle skips by resetting score and rotating without appending to ledger.
        sheet.getRange(rowNum, scoreIdx + 1).setValue(1);
    } else if (args.action === 'kill') {
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
function executeMarginalGetEval(): Record<string, any> {
    try {
        const sheet = getMarginSheet_(MARGIN_EVAL_SHEET);
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) return { result: "no evaluation data available yet" };

        const lastTwo = data.slice(-2);
        return { evaluation_data: lastTwo };
    } catch (e) {
        return { error: String(e) };
    }
}

/**
 * Tool: Get the current active task name.
 * Scans the tasks sheet for state='active' and is_chosen=TRUE.
 */
function executeMarginalGetCurrentTask(): Record<string, any> {
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
    } catch (e) {
        return { error: String(e) };
    }
}
