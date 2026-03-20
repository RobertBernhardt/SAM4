# AGENTS.md — SAM4 Living Documentation

> **SAM4** — A GAS-based hierarchical AI agent system built with TypeScript and clasp.

---

## Overview

SAM4 is a modular, hierarchical AI agent system that runs entirely on Google Apps Script (GAS). Agents — called **Algos** — use Gemini function calling to invoke sub-agents and script tools. The system follows a strict **"no waiting"** rule: it never uses `Utilities.sleep()` to wait for human input. Instead, it persists state to Google Sheets and terminates execution, resuming when the next event arrives.

### Core Principles

| Principle | Description |
|---|---|
| **Flat Namespace, Local Hierarchy** | GAS flattens all files. We use local folders (`src/agents/`, `src/tools/`, `src/core/`) for organization; clasp handles the flattening on push. |
| **Algos, not Agents** | Every agent is an "algo." The naming convention reflects their algorithmic nature. |
| **No Waiting** | Never `Utilities.sleep()`. Save state → kill execution → resume on next event. |
| **Tool Calling** | Gemini function calling dispatches to sub-algos or script tools. |
| **State Persistence** | All state is stored in a Google Sheet, keyed by a unique UID per task. |

---

## File Structure

```
SAM4/
├── .clasp.json              # clasp config (rootDir: src, TS enabled)
├── .claspignore              # Files excluded from GAS push
├── AGENTS.md                 # This file — living documentation
├── Code.js                   # Legacy placeholder (can be removed)
│
└── src/
    ├── appsscript.json       # GAS manifest (timezone, runtime V8)
    ├── config.ts             # Global config: API keys, model defaults
    ├── main.ts               # Entry point: doPost() Telegram webhook
    │
    ├── core/
    │   ├── gemini_client.ts  # Gemini REST API wrapper (UrlFetchApp)
    │   └── state_manager.ts  # Sheet-based state persistence (CRUD by UID)
    │
    ├── agents/
    │   └── analgo.ts         # Analysis Algorithm — first algo
    │
    └── tools/
        └── calculator.ts     # Simple arithmetic tool (add/sub/mul/div)
```

---

## Naming Conventions

- **Algo files**: `src/agents/<algo_name>.ts` — lowercase, descriptive name.
- **Tool files**: `src/tools/<tool_name>.ts` — lowercase, one tool per file.
- **Core files**: `src/core/<module_name>.ts` — shared infrastructure.
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_MODEL`, `STATE_SHEET_NAME`).
- **Private GAS functions**: Suffix with `_` (e.g., `getStateSheet_()`, `sendTelegramMessage_()`).

---

## Algos

### Analgo (Analysis Algorithm)

| Property | Value |
|---|---|
| **File** | `src/agents/analgo.ts` |
| **ID** | `analgo` |
| **Model** | Inherits `DEFAULT_MODEL` (Gemini 2.0 Flash) |
| **Purpose** | Break down complex user requests into logical, actionable steps. |
| **Tools** | `calculator` |

**System Prompt:**
> You are the Analysis Algorithm (Analgo). Your job is to break down complex user requests into logical, actionable steps.

**Tool-Calling Loop:**
1. Receives user input + UID.
2. Calls Gemini with system prompt and registered tools.
3. If Gemini returns a `functionCall` → dispatches to the tool executor → feeds the result back.
4. Repeats until Gemini returns a final text response (max 5 loops).
5. Persists result via `state_manager`.

---

## Tools

### Calculator

| Property | Value |
|---|---|
| **File** | `src/tools/calculator.ts` |
| **Type** | Script tool (no LLM) |
| **Operations** | `add`, `subtract`, `multiply`, `divide` |
| **Parameters** | `operation` (string), `a` (number), `b` (number) |

---

## Configuration

### Script Properties (set in GAS Project Settings)

| Key | Description |
|---|---|
| `GEMINI_API_KEY` | Gemini API key for model calls |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for webhook responses |
| `STATE_SPREADSHEET_ID` | Google Sheet ID for state persistence |

### Defaults (in `config.ts`)

| Constant | Value | Notes |
|---|---|---|
| `DEFAULT_MODEL` | `gemini-2.0-flash` | Individual algos can override via their config |
| `DEFAULT_THINKING_BUDGET` | `0` | Set > 0 to enable thinking |
| `STATE_SHEET_NAME` | `AgentState` | Sheet tab name for state data |

---

## Entry Point

**`src/main.ts`** — `doPost(e)` handles Telegram webhooks:

1. Parses the incoming Telegram update.
2. Generates a unique UID via `generateUid()`.
3. Passes the user message to `runAnalgo(uid, text)`.
4. Sends the result back via Telegram Bot API.
5. Returns `200 OK` as JSON.

A `testAnalgo()` function is included for manual testing from the GAS editor.

---

## State Schema (Google Sheet)

| Column | Field | Type | Description |
|---|---|---|---|
| A | `uid` | string | Unique task identifier |
| B | `agent_id` | string | Which algo owns this state |
| C | `status` | enum | `pending` · `running` · `completed` · `error` |
| D | `state_json` | JSON string | Serialised agent state/data |
| E | `created_at` | ISO string | Creation timestamp |
| F | `updated_at` | ISO string | Last update timestamp |

---

## Deployment Checklist

1. Set the three Script Properties in GAS Project Settings.
2. `clasp push` to deploy all files.
3. Deploy as Web App (Execute as: Me, Access: Anyone).
4. Set Telegram webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WEB_APP_URL>`
5. Send a message to the bot → Analgo responds.

---

*Last updated: 2026-03-20*
