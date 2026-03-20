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

/** Bug bot token — writes user text to Issues sheet as BUG. */
function getBugBotToken(): string {
    return getScriptProp_('BUG_BOT_TOKEN');
}

/** Fail bot token — writes user text to Issues sheet as FAIL. */
function getFailBotToken(): string {
    return getScriptProp_('FAIL_BOT_TOKEN');
}

/** Task bot token — taskalgo bot */
function getTaskBotToken(): string {
    return getScriptProp_('TASK_BOT_TOKEN');
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
const DAILY_TOKEN_LIMIT = 1_000_000;

// ─── Sheet Names ────────────────────────────────────────────

/** The spreadsheet sheet name used for agent state persistence. */
const STATE_SHEET_NAME = 'AgentState';

/** The sheet name for bug/fail reports. */
const ISSUES_SHEET_NAME = 'Issues';

/** The spreadsheet ID for agent state (set in Script Properties). */
function getStateSpreadsheetId(): string {
    return getScriptProp_('STATE_SPREADSHEET_ID');
}

/** The SAM (central registry) spreadsheet ID. */
function getSamSheetId(): string {
    return getScriptProp_('SAM_SHEET_ID');
}
