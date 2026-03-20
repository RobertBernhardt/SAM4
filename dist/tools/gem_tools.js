/**
 * gem_tools.ts — Script tools for the Gemalgo agent.
 *
 * Three search tools that query a "Gems" sheet in the state
 * spreadsheet. Gemalgo uses Gemini function calling to select
 * which tool to invoke.
 *
 * Gems Sheet Columns:
 *   A: gem_id       (string)
 *   B: type         (image | content | interactive)
 *   C: title        (string)
 *   D: description  (string)
 *   E: url          (string)
 *   F: tags         (comma-separated)
 */
// ─── Shared Gem Reader ──────────────────────────────────────
/**
 * Reads the Gems sheet and returns all rows matching a type
 * and whose title/description/tags contain the query string.
 */
function searchGems_(type, query) {
    const ss = SpreadsheetApp.openById(getStateSpreadsheetId());
    const sheet = ss.getSheetByName('Gems');
    if (!sheet) {
        Logger.log('[GEM_TOOLS] Gems sheet not found.');
        return [];
    }
    const data = sheet.getDataRange().getValues();
    const results = [];
    const q = query.toLowerCase();
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowType = String(row[1] || '').trim().toLowerCase();
        if (rowType !== type.toLowerCase())
            continue;
        const title = String(row[2] || '');
        const description = String(row[3] || '');
        const tagsRaw = String(row[5] || '');
        const searchable = `${title} ${description} ${tagsRaw}`.toLowerCase();
        if (searchable.includes(q)) {
            results.push({
                gemId: String(row[0]),
                type: rowType,
                title,
                description,
                url: String(row[4] || ''),
                tags: tagsRaw
                    .split(',')
                    .map((t) => t.trim())
                    .filter((t) => t.length > 0),
            });
        }
    }
    return results;
}
// ─── Tool Declarations ──────────────────────────────────────
const SEARCH_IMAGE_GEMS_DECLARATION = {
    name: 'searchImageGems',
    description: 'Searches the Gems database for image-type gems matching a query. ' +
        'Returns a list of image gems with titles, descriptions, and URLs.',
    parameters: {
        type: 'OBJECT',
        properties: {
            query: {
                type: 'STRING',
                description: 'The search query to match against gem titles, descriptions, and tags.',
            },
        },
        required: ['query'],
    },
};
const SEARCH_CONTENT_GEMS_DECLARATION = {
    name: 'searchContentGems',
    description: 'Searches the Gems database for content-type gems matching a query. ' +
        'Returns a list of content gems with titles, descriptions, and URLs.',
    parameters: {
        type: 'OBJECT',
        properties: {
            query: {
                type: 'STRING',
                description: 'The search query to match against gem titles, descriptions, and tags.',
            },
        },
        required: ['query'],
    },
};
const SEARCH_INTERACTIVE_GEMS_DECLARATION = {
    name: 'searchInteractiveGems',
    description: 'Searches the Gems database for interactive-type gems matching a query. ' +
        'Returns a list of interactive gems with titles, descriptions, and URLs.',
    parameters: {
        type: 'OBJECT',
        properties: {
            query: {
                type: 'STRING',
                description: 'The search query to match against gem titles, descriptions, and tags.',
            },
        },
        required: ['query'],
    },
};
// ─── Tool Executors ─────────────────────────────────────────
function executeSearchImageGems(args) {
    const results = searchGems_('image', args.query);
    Logger.log(`[GEM_TOOLS] searchImageGems("${args.query}") → ${results.length} result(s).`);
    return { results };
}
function executeSearchContentGems(args) {
    const results = searchGems_('content', args.query);
    Logger.log(`[GEM_TOOLS] searchContentGems("${args.query}") → ${results.length} result(s).`);
    return { results };
}
function executeSearchInteractiveGems(args) {
    const results = searchGems_('interactive', args.query);
    Logger.log(`[GEM_TOOLS] searchInteractiveGems("${args.query}") → ${results.length} result(s).`);
    return { results };
}
