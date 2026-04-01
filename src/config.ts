/**
 * config.ts — Global configuration for the SAM4 agent system.
 *
 * Reads secrets from GAS Script Properties and exposes
 * system-wide defaults. Individual agents can override
 * DEFAULT_MODEL in their own config objects.
 */

// ─── Secrets ────────────────────────────────────────────────
function getScriptProp_(key: string): string {
    const value = PropertiesService.getScriptProperties().getProperty(key);
    if (!value) {
        throw new Error(`[CONFIG] Missing script property: "${key}". Set it in Project Settings → Script Properties.`);
    }
    return value;
}

/** Gemini API key stored in Script Properties. */
function getGeminiApiKey(): string {
    return getScriptProp_('GEMINI_API_KEY');
}

// ─── Multi-Bot Tokens ───────────────────────────────────────

/** Master bot token — starts the analgo workflow. */
function getMasterBotToken(): string {
    return getScriptProp_('MASTER_BOT_TOKEN');
}

/** Gem bot token — bypasses master, calls gemalgo directly. */
function getGemBotToken(): string {
    return getScriptProp_('GEM_BOT_TOKEN');
}

/** Agent bot token — for sending agent tips to the creator. Uses BUG_BOT_TOKEN internally so env doesn't break. */
function getAgentBotToken(): string {
    return getScriptProp_('BUG_BOT_TOKEN');
}

/** Fail bot token — writes user text to Issues sheet as FAIL. (Currently unused but kept for expansion) */
function getFailBotToken(): string {
    return getScriptProp_('FAIL_BOT_TOKEN');
}

/** Task bot token — taskalgo bot */
function getTaskBotToken(): string {
    return getScriptProp_('TASK_BOT_TOKEN');
}

/** Quest bot token — used by the autonomous quest engine for reports */
function getQuestBotToken(): string {
    return getScriptProp_('QUEST_BOT_TOKEN');
}

/** Subquest bot token — used for suggesting and approving subquests */
function getSubquestBotToken(): string {
    return getScriptProp_('SUBQUEST_BOT_TOKEN');
}

/** NewQuest bot token — Creator manually creates quests via natural language */
function getNewQuestBotToken(): string {
    return getScriptProp_('NEWQUEST_BOT_TOKEN');
}

/** Margin bot token — Gamified life tasks */
function getMarginBotToken(): string {
    return getScriptProp_('MARGIN_BOT_TOKEN');
}

/** Admin chat ID for push automations */
function getAdminChatId(): number {
    return parseInt(getScriptProp_('ADMIN_CHAT_ID'), 10);
}

// ─── Model Defaults ─────────────────────────────────────────

/**
 * System-wide default model. Uses the required models/ prefix.
 * Individual algos can override this via the SAM sheet.
 */
const DEFAULT_MODEL = 'models/gemini-2.0-flash';

/**
 * Default thinking budget for complex reasoning.
 * Set to 0 to disable thinking.
 */
const DEFAULT_THINKING_BUDGET = 0;

// ─── Token Budget ───────────────────────────────────────────

/**
 * Maximum daily token budget. If DAILY_TOKENS (tracked in
 * Script Properties) exceeds this value, all model calls
 * are hard-stopped.
 */
const DAILY_TOKEN_LIMIT = 2_500_000;

// ─── Sheet Names ────────────────────────────────────────────

/** The spreadsheet sheet name used for agent state persistence. */
const STATE_SHEET_NAME = 'AgentState';

/** The sheet name for bug/fail reports. */
const ISSUES_SHEET_NAME = 'Issues';

/** The sheet name for queued background jobs. */
const QUEUE_SHEET_NAME = 'Queue';

/** The sheet name for the active quest backlog. */
const QUESTS_SHEET_NAME = 'Quests';

/** The sheet name for quest execution logs (scoped per quest). */
const QUEST_LOGS_SHEET_NAME = 'QuestLogs';

/** The sheet name for the Telegram message outbox (event-driven delivery). */
const OUTBOX_SHEET_NAME = 'Outbox';

/** The sheet name for quest-specific references. */
const QUEST_REFS_SHEET_NAME = 'QuestReferences';

// ─── Margin Sheets ──────────────────────────────────────────
const MARGIN_TASKS_SHEET = 'tasks';
const MARGIN_LOGS_SHEET = 'tasklogs';
const MARGIN_EXTRAS_SHEET = 'extratasks';
const MARGIN_EVAL_SHEET = 'taskevaluation';

/** The spreadsheet ID for agent state (set in Script Properties). */
function getStateSpreadsheetId(): string {
    return getScriptProp_('STATE_SPREADSHEET_ID');
}

/** The SAM (central registry) spreadsheet ID. */
function getSamSheetId(): string {
    return getScriptProp_('SAM_SHEET_ID');
}

/** Google Drive folder ID for auto-created quest state and experience docs. */
function getQuestDocsFolderId(): string {
    return getScriptProp_('QUEST_DOCS_FOLDER_ID');
}

/** Google Drive folder ID for auto-created agent experience docs. */
function getExperienceDocsFolderId(): string {
    return getScriptProp_('EXPERIENCE_FOLDER_ID');
}
