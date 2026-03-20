# SAM4 Living Documentation

> **SAM4** — A metadata-driven universal agent engine running entirely on Google Apps Script (GAS).

---

## Overview

SAM4 is a modular AI agent system where **agents do not get their own files anymore**. They are just configurations in a spreadsheet. The codebase serves merely as the universal runner. The "SAM" Google Sheet is the brain of the operation.

### Core Principles

| Principle | Description |
|---|---|
| **Flat Namespace, Local Hierarchy** | GAS flattens all files. We use `src/core/` and `src/tools/` for organization. |
| **Death of Hardcoded Agents** | There are no more `analgo.ts` or `gemalgo.ts`. Every execution runs through the universal `runAlgo()` engine. |
| **Spreadsheet is Truth** | All agent logic (models, prompts, tools, settings) is driven by the SAM sheet registry. |
| **No Waiting** | Never use `Utilities.sleep()`. Save state → kill execution → resume later. |
| **models/ Prefix** | All Gemini model calls must strictly use the `models/` prefix. |

---

## The Core Engine (`runAlgo`)

The `engine.ts` file acts as the universal processor:
1. Receives an `algoId`, `uid`, and user input.
2. Uses `RegistryLoader` to fetch the algo configuration and associated tools from the SAM sheet.
3. Iteratively calls the Gemini model.
4. Executes SCRIPT tools locally or recursively calls `runAlgo()` for AGENT tools.
5. Logs token usage and every step via `state_manager.ts`.

---

## The SAM Registry

**SAM** is the central registry sheet.

### AgentManifest Tab
Contains the configuration for algorithms.
Columns: `agent_id` (e.g. `masteralgo`), `model`, `system_prompt`, `temperature`, `max_tool_calls`, `thinking_budget`.

### Connections Tab
Maps each `algoId` to the `tool_name` it possesses.

### ToolRegistry Tab
Contains the raw JSON schemas for tools.
Columns: `tool_name`, `type` (`SCRIPT` or `AGENT`), `schema_json`.

---

## Tool Execution Mapping

When Gemini determines a tool needs to be called, `tool_runner.ts` intercepts it.
- **SCRIPT** tools match string names exactly to local TypeScript functions (like `executeCalculator`).
- **AGENT** tools trigger a recursive `runAlgo()` call, effectively passing execution to a sub-algo defined strictly in the SAM sheet.

---

## Multi-Bot Dispatch Architecture

SAM4 operates via 5 core bots connected through Telegram webhooks. `main.ts` intercepts all requests and operates as a pure dispatcher:

| Bot Token in Config | Target Algo | Use Case |
|---|---|---|
| `MASTER_BOT_TOKEN` | `masteralgo` | Starts the central / main workflow. |
| `GEM_BOT_TOKEN` | `gemalgo` | Used specifically for retrieving gems directly. |
| `BUG_BOT_TOKEN` | `bugalgo` | For reporting explicit bugs. |
| `FAIL_BOT_TOKEN` | `failalgo` | For reporting workflow failures. |
| `TASK_BOT_TOKEN` | `taskalgo` | Dispatches task-oriented requests. |

The webhook dispatcher pulls the token or "bot" identifier directly from the URL query params (`?bot=master` or `?token=...`) to route the message.

### Multi-Message Support

The transport layer (`transport_telegram.ts`) possesses a universal `sendReply` function. If `runAlgo` returns an array of multiple strings (e.g., `gemalgo` retrieving five gems), `sendReply` seamlessly fires them as five independent Telegram messages back sequentially.

---

## Deployment & Setup

1. Configure script properties for all 5 `*_BOT_TOKEN` keys along with `GEMINI_API_KEY`, `SAM_SHEET_ID`, and `STATE_SPREADSHEET_ID`.
2. Define `masteralgo`, `gemalgo`, `bugalgo`, `failalgo`, and `taskalgo` inside the SAM sheet (AgentManifest tab).
3. Push codebase via `clasp push`.
4. Deploy the GAS Web App.
5. Configure each Telegram bot webhook pointing to the GAS deployment URL featuring their specific target identity (`?bot=master`, `?bot=gem`, etc.).

---

*End of Document*
