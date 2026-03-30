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
- **`lessons_count`** (Col G): Internal counter for agent lessons (auto-incremented by the AgentTip system).
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
  - *Note on IMAGES:* Images are ripped securely via `DriveApp.getFileById()` and injected dynamically into the Gemini payload as a `Base64 inlineData` buffer.
- **`description`** (Col D): Summary of what the reference contains.

### Tab: `Logs`
*The Audit Trail. Automatically updated by `state_manager.ts` at the end of every workflow.*
- Columns: `timestamp`, `uid`, `caller_id`, `agent_id`, `input`, `thinking` (tool execution traces), `output`, `tokens`, `model used`.

### Tab: `Budget`
*Safety mechanism to prevent over-usage. Automatically updated.*
- Columns: `date`, `total_tokens`, `AI model`.
- The engine checks tokens consumed by specific models on today's date. If a model exceeds 2,500,000 tokens, the system safely pauses entirely for that model until the next day.

### Tab: `Quests` (SAM Sheet)
*The Autonomous Mission Backlog. Driven by weighted round-robin scheduling.*
- **`quest_id`** (Col A): Unique string identifier. *Ex: `find_ai_leads`.*
- **`description`** (Col B): What this quest is about. Can be vague ("Make money") or specific ("Find 10 plumbers in Berlin").
- **`status`** (Col C): `ACTIVE`, `PAUSED`, or `FINISHED`. 
- **`weight`** (Col D): Priority value 1–100. Higher weight = triggered more frequently. *Ex: Main quest = 50, side quest = 5.*
- **`current_score`** (Col E): Internal accumulator. Each tick adds `weight` to this. The highest scorer gets picked and reset to 1. **Do not edit manually.**
- **`parent_id`** (Col F): If this is a subquest, the ID of its mother quest. Empty for main quests.

### Tab: `QuestLogs` (State Sheet)
*Per-quest execution history. Scoped: each quest only sees its own logs.*
- **`timestamp`** (Col A): When this run started.
- **`quest_id`** (Col B): Links to the `Quests` tab.
- **`run_number`** (Col C): Incrementing counter per quest.
- **`agent_actions`** (Col D): What the agent did during this run (Tool history buffer).
- **`report_doc_url`** (Col E): The automatically generated Markdown execution doc.
- **`creator_feedback`** (Col F): Filled in later by the Creator via QuestBot Telegram updates.

### Tab: `Outbox` (State Sheet)
*Queue for Telegram messages to ensure sequential delivery rather than floods.*
- **`timestamp`** (Col A): When the message was queued.
- **`target_id`** (Col B): The quest_id or agent_id.
- **`target_bot`** (Col C): Which bot sends it (`questbot`, `subquestbot`, `agentbot`).
- **`status`** (Col D): `PENDING` or `DELIVERED`. Messages remain PENDING until explicitly triggered.
- **`message`** (Col E): Raw Telegram message payload.
- **`metadata`** (Col F): Internal JSON used for subquests and agent tips.

---

## 3. Multi-Bot Dispatch Architecture

SAM4 operates via core bots connected through Telegram webhooks. `main.ts` intercepts all requests and operates as a pure dispatcher:

1. **MasterBot:** CEO access (routes to `masteralgo`).
2. **Questbot:** The automated reporter. Delivers execution markdown summaries from the `Outbox` and receives creator feedback (`ACCEPT`, `REPEAT`, `SUCKS`).
3. **Subquestbot:** Approver bot. Proposes new subquests when a main quest crashes, or new follow-up quests when a parent task finishes successfully.
4. **NewQuestBot:** Creator-initiated quest creation via natural language parsing.
5. **AgentBot:** Auto-identifies execution flaws to manually propose structural agent lessons back to the creator (`agentalgo`).
6. **TaskBot:** Triggered every 6/12 hours delivering a clean rundown of the top 12 highest-priority active quests.
7. **GemBot:** Direct line to the specialist (routes to `gemalgo`).
8. **FailBot:** For logging logic failures/hypotheses.

### Cloudflare Webhook Proxy (The 302 Shield)
Google Apps Script unconditionally responds to POST requests with an HTTP 302 Redirect. Telegram Webhooks categorically reject 302 redirects, leading to an infinite retry death-loop. To solve this without queues, SAM4 is permanently deployed behind a free **Cloudflare Worker proxy**. 

---

## 4. Quest Engine II (Autonomous Execution System)

The Quest Engine turns SAM4 from a reactive chatbot into a proactive autonomous system.

### How It Works (The 3-Stage Pipeline)
1. **Execution (`questalgo`)**: Driven by the `processQuests()` trigger, the primary executor runs strictly based on the mission description. No past memory is given natively, keeping execution fast.
2. **Reporting (`logalgo`)**: When execution finishes, a background `logalgo` evaluates the execution transcript, writes a beautiful execution markdown report, and saves it seamlessly as a standalone Google Doc.
3. **Formatting (`userinfoalgo`)**: A slim summarization module translates the report into Telegram-friendly bullets and places it in the `PENDING` Outbox queue.

### The Feedback Loop 
When you reply to the `QuestBot` report, the system processes your Plain Language intent into three categories:
- **`ACCEPT`**: Marks quest as `FINISHED`, unpauses parent tasks, and triggers `follow_up_algo` to brainstorm the next logical quest on the roadmap via SubquestBot.
- **`REPEAT`**: Leaves the task `ACTIVE` in the backlog and resets the score to `1`.
- **`SUCKS`**: Triggers a subquest flag, executing a twin-pronged response:
  - **Subquest Proposal**: `subquest_proposal_algo` instantly reads the crash log and proposes a focused sub-task designed purely to clear the bottleneck.
  - **Agent Learning**: `agentalgo` parses the exact reasons for the crash against the tools used, extracting a high-level lesson. It asks for your permission on the `AgentBot`. If approved, it is written as an incremental `# Header` into `experience_doc_urls` (Col I of Manifest).

### Weighted Round-Robin Scheduling
The scheduling algorithm ensures variety while respecting priorities:
- Highest score wins. All quests accumulate their assigned `weight` every tick (e.g. 50 grows faster than 5).
- Ensures the AI cycles smoothly through side tasks over time while heavily favoring main objectives.
- Example: Quest A (weight=50) runs ~10x more frequently than B (weight=5).

---

## 5. Operations & Gotchas

- **Aggressive Caching**: `registry_loader.ts` utilizes Google's `CacheService`. During active development, `CACHE_TTL` is set to 60 seconds. In production, it can be raised to 6 hours. If your bot ignores spreadsheet updates, the cache is active.
- **GAS Execution Limits**: Google Apps Script has a **6-minute execution wall-clock limit**. Deep recursion will kill the script. Keep tool chains shallow.
- **JSON Object requirement**: When creating SCRIPT tools, always return a serialized string or an object. Gemini needs a deterministic JSON structure to "hear" the result back from the tool effectively.
- **Review Permissions**: Whenever you add a new feature that touches Google Drive, Docs, Sheets, or External APIs, Google will silently pause your webhooks until you manually click **Run -> Review Permissions** on a function inside the web editor.
- **Gemini Free Tier Rate Limits (RPM)**: Free tier models like Gemini 1.5 Flash Lite have a strict 15 Requests Per Minute limit. To prevent crashes during long tool loops, `gemini_client.ts` contains a workaround (`_apiCallsThisExecution` tracking). It forces `Utilities.sleep(61000)` every 13 API calls. **When upgrading to a paid Google AI Studio tier**, delete this sleep workaround in `src/core/gemini_client.ts` to restore maximum execution speed.
