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

/** Telegram Bot Token stored in Script Properties. */
function getTelegramBotToken(): string {
    return getScriptProp_('TELEGRAM_BOT_TOKEN');
}

// ─── Model Defaults ─────────────────────────────────────────

/**
 * System-wide default model. Individual algos can override this
 * by passing their own `model` string to `callGemini()`.
 */
const DEFAULT_MODEL = 'gemini-2.0-flash';

/**
 * Default thinking budget for complex reasoning.
 * Set to 0 to disable thinking.
 */
const DEFAULT_THINKING_BUDGET = 0;

// ─── Sheet Names ────────────────────────────────────────────

/** The spreadsheet sheet name used for agent state persistence. */
const STATE_SHEET_NAME = 'AgentState';

/** The spreadsheet ID for agent state (set in Script Properties). */
function getStateSpreadsheetId(): string {
    return getScriptProp_('STATE_SPREADSHEET_ID');
}
