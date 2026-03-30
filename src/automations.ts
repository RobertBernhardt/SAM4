/**
 * automations.ts — Time-Driven Triggers for SAM4.
 *
 * Set up these triggers in the GAS Dashboard:
 *   1. triggerQuests              → Every 1 hour
 *   2. triggerTelemetry           → Once per day (3:00 AM)
 *   3. runDailyBriefing           → Once per day (morning)
 *   4. triggerTaskBotUpdate       → Every 6 or 12 hours
 *   5. triggerExperienceReview_   → Every 12 hours (or your preferred interval)
 *
 * To create triggers:
 *   GAS Editor → Triggers (alarm icon) → Add Trigger → Select function → Time-driven
 */

/**
 * Hourly Quest Engine trigger.
 */
function triggerQuests(): void {
    try {
        processQuests();
    } catch (err) {
        Logger.log(`[AUTOMATIONS] Quest trigger failed: ${err}`);
        try {
            sendReply(getMasterBotToken(), getAdminChatId(), [
                `🚨 Quest Trigger FAILED:\n${String(err)}`
            ]);
        } catch (_) { /* fail silently */ }
    }
}

/**
 * Daily briefing — analyzes yesterday's activity.
 */
function runDailyBriefing(): void {
    const uid = "auto_" + new Date().getTime();
    const instruction = "Analyze yesterday's logs and summarize the total token spend.";
    const result = runAlgo("masteralgo", uid, instruction);
    sendReply(getMasterBotToken(), getAdminChatId(), result);
}

/**
 * Nightly telemetry update — counts agent and tool usage from Logs.
 */
function triggerTelemetry(): void {
    try {
        updateTelemetry();
    } catch (err) {
        Logger.log(`[AUTOMATIONS] Telemetry update failed: ${err}`);
    }
}

/**
 * Task list notification trigger — sends top 12 active quests via TaskBot.
 * Set to run every 6 or 12 hours.
 */
function triggerTaskBotUpdate(): void {
    try {
        if (typeof sendActiveQuestsList_ === 'function') {
            sendActiveQuestsList_();
        }
    } catch (err) {
        Logger.log(`[AUTOMATIONS] TaskBot update failed: ${err}`);
    }
}

/**
 * Experience doc review trigger — picks one agent per run for review.
 * Uses weighted round-robin based on lifetime usage.
 */
function triggerExperienceReview_(): void {
    try {
        triggerExperienceReview();
    } catch (err) {
        Logger.log(`[AUTOMATIONS] Experience review failed: ${err}`);
    }
}