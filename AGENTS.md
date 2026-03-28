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
- **`model_id`** (Col C): The AI model category. *Ex: `system`, `bots`, `thinking`.* Models are mapped in the new `Models` tab.
- **`temperature`** (Col D): Number `0.0` to `1.0`. 
- **`thinking_level`** (Col E): `MINIMAL`, `MEDIUM`, or `HIGH`. Maps to internal token budgets.
- **`lifetime_usage`** (Col H): Auto-populated nightly by `updateTelemetry()`. Direct invocation count from Logs.
- **`experience_doc_url`** (Col I): Auto-created Google Doc for agent self-learning. These are generated automatically and placed in the Google Drive folder specified by the `EXPERIENCE_FOLDER_ID` Script Property. The engine injects its content as `[AGENT EXPERIENCE]` into the system prompt.
- **`total_invocations`** (Col J): Auto-populated nightly. Sum of direct invocations + times called as a sub-agent tool.

### Tab: `Models`
*The Model Mapping System.*
- **`category`** (Col A): Unique category name. *Ex: `system`, `bots`, `simple`, `thinking`, `wild`, `images`.*
- **`model`** (Col B): The exact Google Gemini model name. *Ex: `models/gemini-2.0-flash`.*
Instead of hardcoding APIs into the AgentManifest, the system abstracts them to allow one-click model swapping across all agents. Note: Internal background agents (`quest_update_algo`, `subquest_approval_algo`, `experience_algo`, `new_quest_algo`) are hardcoded in the codebase for stability but dynamically fetch their model from the `system` category defined here.

### Tab: `ToolRegistry`
*The "Limbs" of the system.*
- **`Tool_id`** (Col A): Unique string. This is what Gemini sees as the function name.
- **`Type`** (Col B): `AGENT` (Calls another row in Manifest) or `SCRIPT` (Calls a GAS function in `tool_runner.ts`).
- **`description`** (Col C): Natural language explanation for the LLM. *Crucial for tool picking.*
- **`json_schema`** (Col D): The exact parameters Gemini must provide. Must be standard minified JSON.
- **`function_name`** (Col E): Optional notes.
- **`lifetime_usage`** (Col F): Auto-populated nightly by `updateTelemetry()`. Total invocation count from Logs.

### Tab: `Connections`
*The "Nervous System". Defines which agent is allowed to use which tool/agent.*
- **`parent_id`** (Col A): The `agent_id` from AgentManifest. Use `*` (wildcard) to make a tool available to ALL agents.
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
*The Agent Complaint System. Any agent can log issues using the globally available `log_issue` tool.*
- Columns: `timestamp`, `agent_id`, `type` (BUG/MISSING_TOOL/BAD_TOOL/MISSING_REFERENCE), `description`, `priority`, `status` (NEW → SENT → FIXED).
- `agent_id` is auto-injected by the engine — agents don't need to specify it.
- BugBot sends notifications about NEW issues (configurable frequency). Issues are marked SENT after notification.
- You manually mark issues as FIXED when resolved.

### Tab: `Quests` (SAM Sheet)
*The Autonomous Mission Backlog. Driven by weighted round-robin scheduling.*
- **`quest_id`** (Col A): Unique string identifier. *Ex: `find_ai_leads`.*
- **`description`** (Col B): What this quest is about. Can be vague ("Make money") or specific ("Find 10 plumbers in Berlin").
- **`progress`** (Col C): 0–100. Updated by the Creator via `/update` command.
- **`status`** (Col D): `ACTIVE`, `PAUSED`, or `FINISHED`. Auto-set to `FINISHED` when progress reaches 100.
- **`weight`** (Col E): Priority value 1–100. Higher weight = triggered more frequently. *Ex: Main quest = 50, side quest = 5.*
- **`current_score`** (Col F): Internal accumulator. Each tick adds `weight` to this. The highest scorer gets picked and reset to 1. **Do not edit manually.**
- **`last_feedback`** (Col G): The Creator's latest feedback text from the `/update` command.
- **`parent_id`** (Col H): If this is a subquest, the ID of its mother quest. Empty for main quests.
- **`state_doc_url`** (Col I): Auto-created Google Doc serving as the quest's living memory. Contains detailed results and state across runs.

### Tab: `QuestReferences` (SAM Sheet)
*Static Context Library for quests. Same structure as agent References but scoped per quest.*
- **`quest_id`** (Col A): Which quest gets this context.
- **`reference_id`** (Col B): A Google Doc URL, Sheet URL, Drive Image, or public URL.
- **`type`** (Col C): `DOC`, `SHEET`, `URL`, or `IMAGE`.
- **`description`** (Col D): Summary of what the reference contains.

### Tab: `QuestLogs` (State Sheet)
*Per-quest execution history. Scoped: each quest only sees its own logs.*
- **`timestamp`** (Col A): When this run started.
- **`quest_id`** (Col B): Links to the `Quests` tab.
- **`run_number`** (Col C): Incrementing counter per quest.
- **`agent_actions`** (Col D): What the agent did during this run.
- **`lessons_learned`** (Col E): What worked and what didn't.
- **`creator_feedback`** (Col F): Filled in later by the Creator via `/update`.
- **`progress_after`** (Col G): The new progress % set by the Creator.

---

## 3. Multi-Bot Dispatch Architecture

SAM4 operates via 8 core bots connected through Telegram webhooks. `main.ts` intercepts all requests and operates as a pure dispatcher:

1. **MasterBot:** CEO access (routes to `masteralgo`).
2. **Questbot:** The automated reporter. Delivers quest results and accepts `/update` feedback.
3. **Subquestbot:** Approver bot. Asks for permission when quests want to spawn subquests. Accepts `/approve_sub`.
4. **NewQuestBot:** Creator-initiated quest creation. Send a natural language message to create a new quest.
5. **GemBot:** Direct line to the specialist (routes to `gemalgo`).
6. **BugBot:** Issues notification bot. Sends batched agent complaints to the Creator.
7. **FailBot:** For logging logic failures/hypotheses.
8. **TaskBot:** For logging missing functionality.

### Cloudflare Webhook Proxy (The 302 Shield)
Google Apps Script unconditionally responds to POST requests with an HTTP 302 Redirect. Telegram Webhooks categorically reject 302 redirects, leading to an infinite retry death-loop. To solve this without queues, SAM4 is permanently deployed behind a free **Cloudflare Worker proxy**. 

1. Cloudflare receives the Telegram POST payload.
2. Cloudflare blindly passes the `?bot=` query parameter to GAS.
3. Cloudflare calls `ctx.waitUntil(fetch(GAS_URL))` to run GAS synchronously in the background (up to 6 minutes).
4. Cloudflare instantly returns a `200 OK` to Telegram within 50ms, permanently solving all webhook timeouts.

---

## 4. Quest Engine (Autonomous Execution System)

The Quest Engine turns SAM4 from a reactive chatbot into a proactive autonomous system. Instead of waiting for Telegram messages, SAM automatically picks and executes quests on a schedule.

### How It Works
1. **Every hour**, the `triggerQuests()` function fires via a GAS Time-Driven Trigger.
2. **Timeout detection** runs first: any previous run with actions but no lessons is marked `[TIMEOUT]`.
3. It reads all `ACTIVE` quests from the `Quests` tab and adds each quest's `weight` to its `current_score`.
4. The quest with the **highest score** is selected (alphabetically first on ties).
5. The winner's score is reset to 1. All other scores keep accumulating.
6. **Pre-write**: A log row is written to `QuestLogs` *before* execution starts (timeout safety net).
7. The engine loads the quest's **scoped history** from `QuestLogs` (only its own past runs).
8. The prompt is executed through `runAlgo('masteralgo', ...)` — the universal engine.
9. The pre-written log row is updated in-place with actual results.
10. The report is queued in the **Outbox** (event-driven delivery — see below).

### Timeout Safety Net
If GAS hits its 6-minute execution limit mid-run, the pre-written log row survives with empty `lessons_learned`. On the next trigger, `detectAndMarkTimeouts_()` finds these orphaned rows and writes a `[TIMEOUT]` marker. The agent sees this in its history and knows the previous attempt was too ambitious.

### Outbox: Event-Driven Message Delivery
Instead of flooding Telegram with hourly reports, the engine uses a queue:
- Reports are written to the `Outbox` tab (State Sheet).
- If no other messages are pending, the report is sent immediately.
- If messages are already queued, the new one waits as `PENDING`.
- When the Creator replies with `/update`, the feedback is processed and the **next pending message is delivered immediately**.
- This creates an event-driven chain: you reply → next report appears → you reply → next report appears.
- **Crash reports bypass the Outbox** and send immediately (they're urgent).
- Old DELIVERED messages are cleaned up nightly by `updateTelemetry()`.

### Tab: `Outbox` (State Sheet)
- **`timestamp`** (Col A): When the message was queued.
- **`quest_id`** (Col B): Which quest this report belongs to.
- **`message`** (Col C): The full Telegram message text.
- **`status`** (Col D): `PENDING` or `DELIVERED`.

### Subquests & Delegation
A quest agent can spawn subquests by using the `suggest_subquest` tool. 
- The proposal is sent to the Creator via the **Subquestbot**.
- The Creator replies **in plain language** (e.g. "approve, but focus on Berlin" or "no, too broad"). A lightweight Gemini 2.5 Flash parser extracts the intent automatically.
- Legacy slash command `/approve_sub <parent> <sub_id> <weight> [description]` is also supported.
- **Context Scoping**: A Mother Quest automatically receives the logs of *all its active subquests* concatenated to its own history. This allows the mother quest to track delegated progress.
- **Isolation**: Subquests do *not* receive logs from their mother quest, keeping their context perfectly focused on their specific delegated task.
- When a subquest is marked `FINISHED`, it drops out of the mother quest's context window to save tokens.

### The Feedback Loop
- The Creator receives a quest report on the **Questbot** and replies **in plain language** (e.g. "looks good, 35%, focus on plumbers not dentists"). A lightweight Gemini 2.5 Flash parser extracts the progress % and feedback.
- Legacy slash command `/update find_ai_leads 35 Good progress but focus on plumbers not dentists` is also supported.
- This updates the `QuestLogs` row (creator_feedback, progress_after) AND the `Quests` row (progress, last_feedback).
- The next pending Outbox message is delivered immediately.
- On the next run, the agent reads this feedback and adjusts its approach.
- If progress reaches 100%, the quest auto-marks as `FINISHED`.

### Weighted Round-Robin Scheduling
The scheduling algorithm ensures variety while respecting priorities:
- A quest with **weight 50** runs ~10x more often than a quest with **weight 5**.
- A quest with **weight 1** still runs eventually — it just accumulates slowly.
- Example with Quest A (weight=50) and Quest B (weight=5):
  - Hours 1–9: A runs every time (its score grows faster).
  - Hour 10: B finally catches up and runs. B resets to 1.
  - This cycle repeats: A runs ~10x for every 1 time B runs.

### Telemetry (Usage Analytics)
- `updateTelemetry()` runs nightly at 3:00 AM via a Time-Driven Trigger.
- It scans the `Logs` tab and counts how often each agent and tool was invoked.
- Writes `lifetime_usage` to `AgentManifest` (Col H) and `ToolRegistry` (Col F).
- This tells the Creator which tools to prioritize improving.

---

## 5. How to Extend SAM (Operator's Manual)

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

### To add a new Quest:
1. Add a row to the `Quests` tab in the SAM Sheet.
2. Set `quest_id`, `description`, `progress` (0), `status` (ACTIVE), `weight` (1–100).
3. Leave `current_score` empty (defaults to 0) and `last_feedback` blank.
4. The quest will automatically be picked up by the next hourly trigger.

### To maintain quality (The Critique Loop):
1. Create a specialized critic in the Manifest (e.g., `german_critic`) as a standalone persona.
2. Register the critic in `ToolRegistry` with Type = `AGENT`.
3. Give your worker agent access by adding a row in `Connections` (Parent: worker, Child: critic).
4. Tell your worker agent in its system prompt: *"Before returning your final output, you must submit your draft to the german_critic tool and revise it based on the feedback."*

---

## 6. Operations & Gotchas

- **Aggressive Caching**: `registry_loader.ts` utilizes Google's `CacheService`. During active development, `CACHE_TTL` is set to 60 seconds. In production, it can be raised to 6 hours. If your bot ignores spreadsheet updates, the cache is active.
- **GAS Execution Limits**: Google Apps Script has a **6-minute execution wall-clock limit**. Deep recursion will kill the script. Keep tool chains shallow (Master -> Specialist -> Tool).
- **JSON Object requirement**: When creating SCRIPT tools, always return a serialized string or an object. Gemini needs a deterministic JSON structure to "hear" the result back from the tool effectively.
- **Review Permissions**: Whenever you add a new feature that touches Google Drive, Docs, Sheets, or External APIs, Google will silently pause your webhooks until you manually click **Run -> Review Permissions** on a function inside the web editor.
- **Quest Engine Safety**: The quest engine runs through `questalgo`, which delegates to `masteralgo`. Make sure `masteralgo` has the right tools connected in `Connections` for your quests to work. If a quest needs web search, `masteralgo` needs access to a `searchWeb` tool.
- **Global Tools**: Tools connected with `parent_id = *` in the Connections tab are automatically available to ALL agents. Use this for `log_issue` and `append_experience`.
- **Gemini Free Tier Rate Limits (RPM)**: Free tier models like Gemini 1.5 Flash Lite have a strict 15 Requests Per Minute limit. To prevent crashes during long tool loops, `gemini_client.ts` contains a workaround (`_apiCallsThisExecution` tracking). It forces `Utilities.sleep(61000)` every 13 API calls. **When upgrading to a paid Google AI Studio tier**, delete this sleep workaround in `src/core/gemini_client.ts` to restore maximum execution speed.

---
*End of Document*
