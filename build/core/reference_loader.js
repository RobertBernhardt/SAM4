/**
 * reference_loader.ts — Turns your Agents into dynamic RAG machines.
 * Scans the 'References' tab to fetch static Google Docs, Google Sheets, or URLs.
 */
function getReferencesPayload(algoId) {
    const payload = { textRefs: '', imageRefs: [] };
    // Due to 50k char limit in Google Sheet cells, we MUST NOT cache base64 images here.
    // If you cache them in CacheService it works natively, but we will rebuild manually
    // to keep the architecture perfectly stateless.
    const cache = CacheService.getScriptCache();
    const cacheKey = `SAM_REFS_TXT_V3_${algoId}`;
    let isTextCached = false;
    // We only cache the text payload. Images are processed live every time.
    if (cache) {
        const cachedText = cache.get(cacheKey);
        if (cachedText) {
            payload.textRefs = cachedText;
            isTextCached = true;
        }
    }
    const ss = SpreadsheetApp.openById(getSamSheetId());
    const sheet = ss.getSheetByName('References');
    if (!sheet)
        return payload;
    const data = sheet.getDataRange().getDisplayValues();
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (String(row[0]).trim() === algoId) {
            const refId = String(row[1]).trim();
            const type = String(row[2]).trim().toUpperCase();
            const desc = String(row[3]).trim();
            try {
                // Extract clean Drive ID if it's a URL
                const match = refId.match(/\/d\/([-\w]{25,})/);
                const cleanId = (match && match[1]) ? match[1] : refId;
                // Handle Drive Images securely
                if (type === 'IMAGE') {
                    const file = DriveApp.getFileById(cleanId);
                    const blob = file.getBlob();
                    payload.imageRefs.push({
                        inlineData: {
                            mimeType: blob.getContentType(),
                            data: Utilities.base64Encode(blob.getBytes())
                        }
                    });
                    Logger.log(`[REFERENCES] Injected Drive Image: ${desc}`);
                    continue; // Image parsing is distinct from Text parsing below
                }
                // If it isn't cached yet, build the TEXT payload.
                if (!isTextCached) {
                    payload.textRefs += `\n\n--- REFERENCE ARCHIVE: ${desc} ---\n`;
                    if (type === 'DOC') {
                        payload.textRefs += DocumentApp.openById(cleanId).getBody().getText();
                    }
                    else if (type === 'SHEET') {
                        const refSs = SpreadsheetApp.openById(cleanId);
                        const sheets = refSs.getSheets();
                        sheets.forEach(refSheet => {
                            const sheetName = refSheet.getName();
                            payload.textRefs += `\n[TAB: ${sheetName}]\n`;
                            const refData = refSheet.getDataRange().getDisplayValues();
                            if (refData.length > 0) {
                                const tableText = refData.map(r => r.join(' | ')).join('\n');
                                payload.textRefs += tableText + `\n`;
                            }
                        });
                    }
                    else if (type === 'URL') {
                        const response = UrlFetchApp.fetch(refId, { muteHttpExceptions: true });
                        const rawHtml = response.getContentText();
                        const stripped = rawHtml
                            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/\s+/g, ' ');
                        payload.textRefs += stripped.substring(0, 15000);
                    }
                    else {
                        payload.textRefs += `[UNKNOWN REFERENCE TYPE: ${type}]`;
                    }
                }
            }
            catch (e) {
                if (!isTextCached)
                    payload.textRefs += `[FAILED TO LOAD REFERENCE: ${e}]`;
                Logger.log(`[REFERENCES] Failed to load reference ${refId}: ${e}`);
            }
        }
    }
    // Cache ONLY the text payload so we don't blow up the script limits
    if (cache && !isTextCached && payload.textRefs.trim().length > 0) {
        cache.put(cacheKey, payload.textRefs, 60);
    }
    return payload;
}
