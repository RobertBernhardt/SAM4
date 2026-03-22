/**
 * issue_logger.ts — Natively writes support tickets to the Issues tab.
 */

interface IssueLoggerArgs {
    bot_type: string; // e.g., 'BUG', 'FAIL', 'TASK'
    description: string;
    priority: string; // e.g., 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
}

function executeIssueLogger(args: IssueLoggerArgs): { status: string; log: string } {
    try {
        // Find the main SAM sheet
        const ss = SpreadsheetApp.openById(getSamSheetId());
        
        let sheet = ss.getSheetByName('Issues');
        if (!sheet) {
            sheet = ss.insertSheet('Issues');
            sheet.appendRow(['timestamp', 'bot_type', 'description', 'priority']);
            sheet.setFrozenRows(1);
        }
        
        const timestamp = new Date().toISOString();
        const rowData = [timestamp, args.bot_type, args.description, args.priority];
        sheet.appendRow(rowData);
        
        return { status: "SUCCESS", log: "Issue successfully securely logged to the spreadsheet's Issues tab." };
    } catch (e) {
        return { status: "ERROR", log: String(e) };
    }
}
