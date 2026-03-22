# SAM4: Universal Agent Runtime Operations Manual

> **SAM4** — A metadata-driven universal agent engine running entirely on Google Apps Script (GAS).

---

## 1. Core Principles of SAM4

- **Spreadsheet is Truth:** All agent logic (models, prompts, tools, settings) is driven entirely by the SAM Google Sheet registry. The codebase serves merely as the universal runner.
- **Death of Hardcoded Agents:** There are no more `analgo.ts` or `gemalgo.ts`. Every execution runs through the universal recursive `runAlgo()` engine.
- **Isolation is Quality:** Only give agents the tools they actually need to succeed.
- **English Internals:** Prompt in English, output in German.
- **Zero Hallucinations:** If it isn't explicitly defined in the sheet, it doesn't exist.
- **Temperature 0 for Logic:** Always use temperature `0.0` for critics and data analysts to kill agreeable slop.
- **No Waiting:** Never use `Utilities.sleep()`. Save state → kill execution → resume later. The engine must remain stateless.

---

## 2. Sheet Reference: Tab by Tab

This section defines every column in your SAM master sheet. Treat this as the law; the script breaks if indices or headers change.

### Tab: `AgentManifest`
*The "Brain" of the system.*
- **`agent_id`** (Col A): Unique string used as the starting point. *Ex: `masteralgo`.*
- **`system_prompt`** (Col B): The persona. You may paste raw text, OR paste a **Private Google Doc URL** (`https://docs.google...`). If it sees a Doc URL, `registry_loader.ts` will dynamically rip the text out of the document using `DocumentApp.openById()`.
- **`model_id`** (Col C): The Gemini model. *Ex: `models/gemini-2.0-flash`.*
- **`temperature`** (Col D): Number `0.0` to `1.0`. 
- **`thinking_level`** (Col E): `MINIMAL`, `MEDIUM`, or `HIGH`. Maps to internal token budgets.

### Tab: `ToolRegistry`
*The "Limbs" of the system.*
- **`Tool_id`** (Col A): Unique string. This is what Gemini sees as the function name.
- **`Type`** (Col B): `AGENT` (Calls another row in Manifest) or `SCRIPT` (Calls a GAS function in `tool_runner.ts`).
- **`description`** (Col C): Natural language explanation for the LLM. *Crucial for tool picking.*
- **`json_schema`** (Col D): The exact parameters Gemini must provide. Must be standard minified JSON.
- **`function_name`** (Col E): Optional notes.

### Tab: `Connections`
*The "Nervous System". Defines which agent is allowed to use which tool/agent.*
- **`parent_id`** (Col A): The `agent_id` from AgentManifest.
- **`child_id`** (Col B): The `Tool_id` from ToolRegistry.

### Tab: `References` (The RAG Machine)
*Static Context Library dynamically injected into the system prompt.*
- **`agent_id`** (Col A): Which agent gets this context.
- **`reference_id`** (Col B): A Google Doc URL, Google Sheet URL, Google Drive Image Share Link, or public URL.
- **`type`** (Col C): Choose between `DOC`, `SHEET`, `URL`, or `IMAGE`.
  - *Note on IMAGES:* Images are ripped securely via `DriveApp.getFileById()` and injected dynamically into the Gemini payload as a `Base64 inlineData` buffer. They are intentionally NEVER saved to the persistent `AgentState` cell to prevent breaching the 50,000 character Google Sheet limit.
- **`description`** (Col D): Summary of what the reference contains.

### Tab: `Logs`
*The Audit Trail. Automatically updated by `state_manager.ts` at the end of every workflow.*
- Columns: `timestamp`, `uid`, `caller_id`, `agent_id`, `input`, `thinking` (tool execution traces), `output`, `tokens`, `model used`.
- Token values are dynamically aggregated from all nested tool-calls and Gemini Metadata API usages.

### Tab: `Budget`
*Safety mechanism to prevent over-usage. Automatically updated.*
- Columns: `date`, `total_tokens`, `AI model`.
- The engine checks tokens consumed by specific models on today's date. If a model exceeds 1,000,000 tokens, the system safely pauses entirely for that model until the next day.

### Tab: `Issues`
*The Support Ticket Database.*
- Automatically managed by the `issue_logger.ts` script tool when triggered by `bugalgo`, `failalgo`, or `taskalgo`.

---

## 3. Multi-Bot Dispatch Architecture

SAM4 operates via 5 core bots connected through Telegram webhooks. `main.ts` intercepts all requests and operates as a pure dispatcher:

1. **MasterBot:** CEO access (routes to `masteralgo`).
2. **GemBot:** Direct line to the specialist (routes to `gemalgo`).
3. **BugBot:** For logging script errors.
4. **FailBot:** For logging logic failures/hypotheses.
5. **TaskBot:** For logging missing functionality.

### Cloudflare Webhook Proxy (The 302 Shield)
Google Apps Script unconditionally responds to POST requests with an HTTP 302 Redirect. Telegram Webhooks categorically reject 302 redirects, leading to an infinite retry death-loop. To solve this without queues, SAM4 is permanently deployed behind a free **Cloudflare Worker proxy**. 

1. Cloudflare receives the Telegram POST payload.
2. Cloudflare blindly passes the `?bot=` query parameter to GAS.
3. Cloudflare calls `ctx.waitUntil(fetch(GAS_URL))` to run GAS synchronously in the background (up to 6 minutes).
4. Cloudflare instantly returns a `200 OK` to Telegram within 50ms, permanently solving all webhook timeouts.

---

## 4. How to Extend SAM (Operator's Manual)

### To add a new thinking specialist / bot:
1. Talk to Botfather, get a token, and add it to GAS Script Properties.
2. Update the dispatcher in `main.ts` to route the new URL parameter (`else if (urlBot === 'newbot')`).
3. Set the Telegram webhook to your unified Cloudflare URL: `...?url=https://sam-proxy.workers.dev/?bot=newbot`.
4. Add a row to `AgentManifest` defining its logic.

### To add a new physical capability (SCRIPT Tool):
1. Write the logic in `src/tools/my_tool.ts`.
2. Map it inside the switch case in `src/tools/tool_runner.ts`.
3. Register the exact `Tool_id` and JSON Schema in `ToolRegistry`.
4. Give an agent access to it by adding a row in `Connections`.

### To maintain quality (The Critique Loop):
1. Create a specialized critic in the Manifest (e.g., `german_critic`) as a standalone persona.
2. Register the critic in `ToolRegistry` with Type = `AGENT`.
3. Give your worker agent access by adding a row in `Connections` (Parent: worker, Child: critic).
4. Tell your worker agent in its system prompt: *"Before returning your final output, you must submit your draft to the german_critic tool and revise it based on the feedback."*

---

## 5. Operations & Gotchas

- **Aggressive Caching**: `registry_loader.ts` utilizes Google's `CacheService`. During active development, `CACHE_TTL` is set to 60 seconds. In production, it can be raised to 6 hours. If your bot ignores spreadsheet updates, the cache is active.
- **GAS Execution Limits**: Google Apps Script has a **6-minute execution wall-clock limit**. Deep recursion will kill the script. Keep tool chains shallow (Master -> Specialist -> Tool).
- **JSON Object requirement**: When creating SCRIPT tools, always return a serialized string or an object. Gemini needs a deterministic JSON structure to "hear" the result back from the tool effectively.
- **Review Permissions**: Whenever you add a new feature that touches Google Drive, Docs, Sheets, or External APIs, Google will silently pause your webhooks until you manually click **Run -> Review Permissions** on a function inside the web editor.

---
*End of Document*
