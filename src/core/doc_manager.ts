/**
 * doc_manager.ts — Google Docs operations for quest state docs and agent experience docs.
 *
 * All docs are created in the QUEST_DOCS_FOLDER_ID Drive folder.
 */

// ─── Low-Level Helpers ──────────────────────────────────────

function extractDocId_(url: string): string | null {
    if (!url) return null;
    const match = url.match(/\/d\/([-\w]{25,})/) || url.match(/id=([-\w]{25,})/);
    return match ? match[1] : null;
}

function createDocInFolder_(title: string, customFolderId?: string): string {
    const doc = DocumentApp.create(title);
    const docId = doc.getId();
    const file = DriveApp.getFileById(docId);

    try {
        const folderId = customFolderId || getQuestDocsFolderId();
        const folder = DriveApp.getFolderById(folderId);
        folder.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
    } catch (e) {
        Logger.log(`[DOC_MANAGER] Could not move doc to folder: ${e}. Doc stays in root.`);
    }

    return doc.getUrl();
}

// ─── Quest Execution Reports ──────────────────────────────────

function createQuestExecutionReport_(questId: string, runNumber: number, content: string): string {
    const url = createDocInFolder_(`Run #${runNumber} Report - ${questId}`);
    const docId = extractDocId_(url);

    if (docId) {
        const doc = DocumentApp.openById(docId);
        const body = doc.getBody();
        body.appendParagraph(`=== Quest: ${questId} (Run #${runNumber}) ===`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
        
        // Write the generated markdown report directly into the doc
        const lines = content.split('\n');
        for (const line of lines) {
            body.appendParagraph(line);
        }
        
        doc.saveAndClose();
    }

    return url;
}

// ─── Agent Experience Docs ──────────────────────────────────

function createExperienceDoc_(agentId: string): string {
    const title = `${agentId} - valueable lessons / experience doc`;
    const url = createDocInFolder_(title, getExperienceDocsFolderId());
    const docId = extractDocId_(url);

    if (docId) {
        const doc = DocumentApp.openById(docId);
        const body = doc.getBody();
        body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING1);
        body.appendParagraph('');
        body.appendParagraph('#1').setHeading(DocumentApp.ParagraphHeading.HEADING2);
        doc.saveAndClose();
    }

    // Notify the Creator that a new experience doc has been auto-generated
    try {
        if (typeof sendReply === 'function') {
            const msg = `📄 *Experience Doc Generated*\n\nA new experience document was automatically created for agent: *${agentId}*\n\n[Open Document](${url})`;
            // sendReply(getMasterBotToken(), getAdminChatId(), msg);
            Logger.log(`[DOC_MANAGER] Auto-created experience doc, suppressing telegram notification to avoid MasterBot confusion.`);
        }
    } catch (e) {
        Logger.log(`[DOC_MANAGER] Failed to notify Creator about new experience doc: ${e}`);
    }

    return url;
}

/**
 * Auto-creates an experience doc if the agent doesn't have one yet.
 * Returns the doc URL (existing or newly created).
 */
function ensureExperienceDoc_(agentId: string): string {
    const ss = SpreadsheetApp.openById(getSamSheetId());
    const sheet = ss.getSheetByName('AgentManifest');
    if (!sheet) return '';

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === agentId) {
            const existingUrl = String(data[i][8] || '').trim(); // Col I = index 8
            if (existingUrl) return existingUrl;

            const url = createExperienceDoc_(agentId);
            sheet.getRange(i + 1, 9).setValue(url); // Col I = column 9
            SpreadsheetApp.flush();
            Logger.log(`[DOC_MANAGER] Auto-created experience doc for agent "${agentId}"`);
            return url;
        }
    }
    return '';
}

// ─── Read / Write Operations ────────────────────────────────

function readDocContent(docUrl: string): string {
    const docId = extractDocId_(docUrl);
    if (!docId) return '';

    try {
        return DocumentApp.openById(docId).getBody().getText();
    } catch (e) {
        Logger.log(`[DOC_MANAGER] Failed to read doc: ${e}`);
        return '';
    }
}

function appendToDoc(docUrl: string, content: string): string {
    const docId = extractDocId_(docUrl);
    if (!docId) return 'ERROR: Invalid doc URL';

    try {
        const doc = DocumentApp.openById(docId);
        const body = doc.getBody();

        const lines = content.split('\n');
        for (const line of lines) {
            body.appendParagraph(line);
        }

        doc.saveAndClose();
        return 'SUCCESS';
    } catch (e) {
        return `ERROR: ${e}`;
    }
}

function overwriteDocContent(docUrl: string, newContent: string): string {
    const docId = extractDocId_(docUrl);
    if (!docId) return 'ERROR: Invalid doc URL';

    try {
        const doc = DocumentApp.openById(docId);
        const body = doc.getBody();
        body.clear();

        const lines = newContent.split('\n');
        for (const line of lines) {
            body.appendParagraph(line);
        }

        doc.saveAndClose();
        return 'SUCCESS';
    } catch (e) {
        return `ERROR: ${e}`;
    }
}
