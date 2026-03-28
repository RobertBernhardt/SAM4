/**
 * automations.ts — Time-Driven Triggers for SAM4.
 *
 * Set up these triggers in the GAS Dashboard:
 *   1. triggerQuests              → Every 1 hour
 *   2. triggerTelemetry           → Once per day (3:00 AM)
 *   3. runDailyBriefing           → Once per day (morning)
 *   4. triggerIssueNotifications  → Every 6 hours (or your preferred interval)
 *   5. triggerExperienceReview_   → Every 12 hours (or your preferred interval)
 *
 * To create triggers:
 *   GAS Editor → Triggers (alarm icon) → Add Trigger → Select function → Time-driven
 */
/**
 * Hourly Quest Engine trigger.
 */
function triggerQuests() {
    try {
        processQuests();
    }
    catch (err) {
        Logger.log(`[AUTOMATIONS] Quest trigger failed: ${err}`);
        try {
            sendReply(getMasterBotToken(), getAdminChatId(), [
                `🚨 Quest Trigger FAILED:\n${String(err)}`
            ]);
        }
        catch (_) { /* fail silently */ }
    }
}
/**
 * Daily briefing — analyzes yesterday's activity.
 */
function runDailyBriefing() {
    const uid = "auto_" + new Date().getTime();
    const instruction = "Analyze yesterday's logs and summarize the total token spend.";
    const result = runAlgo("masteralgo", uid, instruction);
    sendReply(getMasterBotToken(), getAdminChatId(), result);
}
/**
 * Nightly telemetry update — counts agent and tool usage from Logs.
 */
function triggerTelemetry() {
    try {
        updateTelemetry();
    }
    catch (err) {
        Logger.log(`[AUTOMATIONS] Telemetry update failed: ${err}`);
    }
}
/**
 * Issue notification trigger — sends NEW agent issues via BugBot.
 * Set to run every 6 hours (or 4x/day at 9:00, 12:00, 15:00, 18:00).
 */
function triggerIssueNotifications() {
    try {
        sendNewIssueNotifications_();
    }
    catch (err) {
        Logger.log(`[AUTOMATIONS] Issue notification failed: ${err}`);
    }
}
/**
 * Experience doc review trigger — picks one agent per run for review.
 * Uses weighted round-robin based on lifetime usage.
 */
function triggerExperienceReview_() {
    try {
        triggerExperienceReview();
    }
    catch (err) {
        Logger.log(`[AUTOMATIONS] Experience review failed: ${err}`);
    }
}
