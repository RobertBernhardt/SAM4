/**
 * issue_logger.ts — Agents log complaints about tools, missing capabilities, or errors.
 *
 * Issues Tab Columns (SAM Sheet):
 *   A: timestamp
 *   B: agent_id      — Auto-injected by engine via _caller_agent_id
 *   C: type           — BUG / MISSING_TOOL / BAD_TOOL / MISSING_REFERENCE
 *   D: description    — What went wrong
 *   E: priority       — LOW / MEDIUM / HIGH / CRITICAL
 *   F: status         — NEW → SENT → FIXED
 */

interface IssueLoggerArgs {
    type: string;        // BUG, MISSING_TOOL, BAD_TOOL, MISSING_REFERENCE
    description: string;
    priority: string;    // LOW, MEDIUM, HIGH, CRITICAL
    _caller_agent_id?: string; // Auto-injected by engine.ts
}

function executeIssueLogger(args: IssueLoggerArgs): { status: string; log: string } {
    try {
        const ss = SpreadsheetApp.openById(getSamSheetId());

        let sheet = ss.getSheetByName('Issues');
        if (!sheet) {
            sheet = ss.insertSheet('Issues');
            sheet.appendRow(['timestamp', 'agent_id', 'type', 'description', 'priority', 'status']);
            sheet.setFrozenRows(1);
        }

        // Auto-ensure header has all 6 columns
        const headers = sheet.getRange('A1:F1').getValues()[0];
        if (String(headers[5]) !== 'status') {
            sheet.getRange('A1:F1').setValues([['timestamp', 'agent_id', 'type', 'description', 'priority', 'status']]);
        }

        const agentId = args._caller_agent_id || 'unknown';
        const timestamp = new Date().toISOString();

        sheet.appendRow([
            timestamp,
            agentId,
            args.type || 'BUG',
            args.description || '(no description)',
            args.priority || 'MEDIUM',
            'NEW'
        ]);

        return { status: 'SUCCESS', log: `Issue logged by ${agentId}: [${args.type}] ${args.description}` };
    } catch (e) {
        return { status: 'ERROR', log: String(e) };
    }
}

/**
 * Scans for NEW issues and sends them via BugBot. Marks them as SENT.
 * Called by triggerIssueNotifications() in automations.ts.
 */
function sendNewIssueNotifications_(): void {
    const ss = SpreadsheetApp.openById(getSamSheetId());
    const sheet = ss.getSheetByName('Issues');
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    const newIssues: { row: number; agent: string; type: string; desc: string; priority: string }[] = [];

    for (let i = 1; i < data.length; i++) {
        if (String(data[i][5]).trim() === 'NEW') {
            newIssues.push({
                row: i + 1,
                agent: String(data[i][1]).trim(),
                type: String(data[i][2]).trim(),
                desc: String(data[i][3]).trim(),
                priority: String(data[i][4]).trim()
            });
        }
    }

    if (newIssues.length === 0) return;

    const lines = [`🚨 ${newIssues.length} New Agent Issue(s):\n`];

    for (let i = 0; i < newIssues.length; i++) {
        const issue = newIssues[i];
        lines.push(`${i + 1}. [${issue.agent}] ${issue.type} — ${issue.priority}`);
        lines.push(`   ${issue.desc}\n`);
    }

    try {
        sendReply(getBugBotToken(), getAdminChatId(), [lines.join('\n')]);

        // Mark all as SENT
        for (const issue of newIssues) {
            sheet.getRange(issue.row, 6).setValue('SENT');
        }
        SpreadsheetApp.flush();
        Logger.log(`[ISSUES] Sent ${newIssues.length} issue notification(s)`);
    } catch (e) {
        Logger.log(`[ISSUES] Failed to send notifications: ${e}`);
    }
}
