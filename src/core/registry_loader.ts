/**
 * registry_loader.ts — Loads algo configs and tools from the SAM Google Sheet.
 *
 * Uses CacheService for efficient reads.
 * Sheets used:
 *  - AgentManifest: Algo definitions (model, prompt, etc.)
 *  - Connections: Maps Algos to Tools
 *  - ToolRegistry: Tool definitions and schemas
 */

interface AlgoConfig {
    algoId: string;
    model: string;
    systemPrompt: string;
    temperature: number;
    maxToolCalls: number;
    thinkingBudget: number;
}

interface ToolDefinition {
    name: string;
    type: 'SCRIPT' | 'AGENT';
    schema: any;
}

const CACHE_TTL = 21600; // 6 hours

// Helper to open SAM sheet using PropertiesService
function getSamSpreadsheet_(): GoogleAppsScript.Spreadsheet.Spreadsheet {
    return SpreadsheetApp.openById(getSamSheetId());
}

/**
 * Fetches the Algo configuration from AgentManifest tab.
 */
function getAlgoConfig(algoId: string): AlgoConfig {
    const cache = CacheService.getScriptCache();
    const cacheKey = `SAM_ALGO_${algoId}`;
    if (cache) {
        const cached = cache.get(cacheKey);
        if (cached) return JSON.parse(cached);
    }

    const ss = getSamSpreadsheet_();
    const sheet = ss.getSheetByName('AgentManifest');
    if (!sheet) throw new Error('[REGISTRY] AgentManifest tab not found in SAM sheet.');

    const data = sheet.getDataRange().getValues();
    let config: AlgoConfig | null = null;

    // Assuming columns:
    // A: algoId, B: model, C: systemPrompt, D: temperature, E: maxToolCalls, F: thinkingBudget
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row[0] === algoId) {
            config = {
                algoId: String(row[0]).trim(),
                model: String(row[1] || DEFAULT_MODEL).trim(),
                systemPrompt: String(row[2] || '').trim(),
                temperature: Number(row[3]) || 0.7,
                maxToolCalls: Number(row[4]) || 5,
                thinkingBudget: Number(row[5]) || 0
            };
            break;
        }
    }

    if (!config) throw new Error(`[REGISTRY] Algo "${algoId}" not found in AgentManifest.`);

    if (!config.model.startsWith('models/')) {
        config.model = `models/${config.model}`;
    }

    if (cache) cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
    Logger.log(`[REGISTRY] Loaded config for algo: ${algoId}`);
    return config;
}

/**
 * Looks up the Connections tab, then fetches raw JSON schemas from ToolRegistry tab.
 */
function getTools(algoId: string): ToolDefinition[] {
    const cache = CacheService.getScriptCache();
    const cacheKey = `SAM_TOOLS_${algoId}`;
    if (cache) {
        const cached = cache.get(cacheKey);
        if (cached) return JSON.parse(cached);
    }

    const ss = getSamSpreadsheet_();
    const connSheet = ss.getSheetByName('Connections');
    const registrySheet = ss.getSheetByName('ToolRegistry');

    if (!connSheet || !registrySheet) {
        throw new Error('[REGISTRY] Connections or ToolRegistry tab missing.');
    }

    // 1. Get tool names for algoId from Connections (A: algoId, B: toolName)
    const connData = connSheet.getDataRange().getValues();
    const toolNames: string[] = [];
    for (let i = 1; i < connData.length; i++) {
        if (connData[i][0] === algoId && connData[i][1]) {
            toolNames.push(String(connData[i][1]).trim());
        }
    }

    // 2. Resolve schemas from ToolRegistry (A: toolName, B: type, C: schemaJSON)
    const regData = registrySheet.getDataRange().getValues();
    const tools: ToolDefinition[] = [];

    for (const tName of toolNames) {
        for (let j = 1; j < regData.length; j++) {
            if (regData[j][0] === tName) {
                const typeRaw = String(regData[j][1]).trim().toUpperCase();
                const type = (typeRaw === 'AGENT' || typeRaw === 'SCRIPT') ? typeRaw : 'SCRIPT';
                let schema = {};
                try {
                    schema = JSON.parse(String(regData[j][2]));
                } catch (e) {
                    Logger.log(`[REGISTRY] Error parsing schema for tool ${tName}: ${e}`);
                }
                tools.push({
                    name: tName,
                    type: type as 'SCRIPT' | 'AGENT',
                    schema: schema
                });
                break;
            }
        }
    }

    if (cache) cache.put(cacheKey, JSON.stringify(tools), CACHE_TTL);
    Logger.log(`[REGISTRY] Loaded ${tools.length} tool(s) for algo: ${algoId}`);
    return tools;
}
