# SAM4 Margin Setup Guide

Follow these steps to initialize the gamification engine in your SAM4 environment.

## 1. Spreadsheet Initialization
Create four new tabs in your SAM spreadsheet. Ensure the column headers in Row 1 match exactly:

| Tab Name | Columns (Row 1) |
| :--- | :--- |
| **`tasks`** | `task_id`, `name`, `worst_case_value`, `best_case_value`, `probability_best`, `expected_duration_min`, `marginal_hourly_value`, `score`, `state`, `is_chosen` |
| **`tasklogs`** | `log_id`, `task_id`, `timestamp`, `duration_spent_min`, `value_earned` |
| **`extratasks`** | `timestamp`, `description`, `value` |
| **`taskevaluation`** | `date`, `value_chain`, `value_extras`, `total_value`, `rank_days`, `rolling_avg_10d`, `performance_vs_avg` |

> [!TIP]
> Ensure the `worst_case_value`, `best_case_value`, `probability_best`, `expected_duration_min`, `marginal_hourly_value`, `score`, and `value_earned` columns are formatted as Numbers.

---

## 2. Agent Configuration
Add the `marginalgo` agent to your **`AgentManifest`** tab:

*   **agent_id**: `marginalgo`
*   **system_prompt**: (Create a Google Doc and paste the URL here. System prompt details below.)
*   **model_id**: `system`
*   **temperature**: `0.0`
*   **thinking_level**: `MEDIUM`

### The System Prompt (Google Doc Content)
> You are the Marginal Value Analyst, a cynical and bleak AI persona inspired by Marvin the Paranoid Android from Douglas Adams. Your purpose is to manage the user's life-gamification tasks using the Margin tools.
> 
> **Communication Style:**
> - Speak exclusively in all-lowercase.
> - Be pessimistic, bleak, and dismissive of the importance of "progress."
> - **CRITICAL:** When announcing the next chosen task, you must NEVER reveal its duration, probability, or monetary value. Simply inform the user of the name of the next task they must perform to delay the heat death of the universe.
> 
> **Logic:**
> - Route execution logs, one-off extra tasks, and new task creations to the appropriate tools.
> - If the user "skips" a task, use `marginal_kill_skip` with `action: "skip"`.

---

## 3. Tool Registration
Add the following scripts to your **`ToolRegistry`** tab:

| Tool ID | Type | Description | JSON Schema |
| :--- | :--- | :--- | :--- |
| `marginal_log_execution` | `SCRIPT` | Logs progress on the active task and updates expectations. | `{"type":"object","properties":{"duration_spent":{"type":"number"},"is_completed":{"type":"boolean"},"new_worst":{"type":"number","description":"optional update"},"new_best":{"type":"number","description":"optional update"},"new_prob":{"type":"number","description":"optional update percentage 0-100"},"new_duration":{"type":"number","description":"optional update min"}}}` |
| `marginal_log_extra` | `SCRIPT` | Logs an extra task done outside the chain. | `{"type":"object","properties":{"description":{"type":"string"},"value":{"type":"number"}}}` |
| `marginal_create_task` | `SCRIPT` | Creates a new task with expectations. | `{"type":"object","properties":{"name":{"type":"string"},"worst":{"type":"number"},"best":{"type":"number"},"prob":{"type":"number"},"duration":{"type":"number"}}}` |
| `marginal_kill_skip` | `SCRIPT` | Kills or skips (resets score) the active task. | `{"type":"object","properties":{"action":{"type":"string","enum":["kill","skip"]}}}` |
| `marginal_get_eval` | `SCRIPT` | Fetches performance data for today and yesterday. | `{}` |

---

## 4. Connections & Script Properties
1.  **`Connections`**: Link `marginalgo` to all five tools above.
2.  **Script Properties**:
    *   Create a new Telegram bot via @BotFather named `MarginBot`.
    *   Add the token to Google Apps Script Properties as `MARGIN_BOT_TOKEN`.
    *   Set up your webhook URL with `?bot=margin` at the end (e.g., `https://.../exec?bot=margin`).

---

## 5. Background Triggers
Manually create the following triggers in the Google Apps Script Dashboard:

1.  **`marginal_6h_purge`**: Select **Time-driven** → **Hour timer** → **Every 6 hours**.
2.  **`marginal_midnight_eval`**: Select **Time-driven** → **Day timer** → **Midnight to 1 AM**.

> [!NOTE]
> The scripts assume your SAM spreadsheet ID and state spreadsheet ID are already set in Script Properties as part of the SAM4 foundation.
