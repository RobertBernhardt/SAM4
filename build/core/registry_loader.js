/**
 * registry_loader.ts — Loads algo configs and tools from the SAM Google Sheet.
 */
const CACHE_TTL = 21600; // 6 hours
function getSamSpreadsheet_() {
    return SpreadsheetApp.openById(getSamSheetId());
}
function getAlgoConfig(algoId) {
    const cache = CacheService.getScriptCache();
    const cacheKey = `SAM_ALGO_V3_${algoId}`; // V2 forces cache refresh
    if (cache) {
        const cached = cache.get(cacheKey);
        if (cached)
            return JSON.parse(cached);
    }
    const ss = getSamSpreadsheet_();
    const sheet = ss.getSheetByName('AgentManifest');
    if (!sheet)
        throw new Error('[REGISTRY] AgentManifest tab not found in SAM sheet.');
    const data = sheet.getDataRange().getValues();
    let config = null;
    // Columns: 0:agent_id, 1:model, 2:system_prompt, 3:temperature, 4:max_tool_calls, 5:thinking_budget
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (String(row[0]).trim() === algoId) {
            config = {
                algoId: String(row[0]).trim(),
                model: String(row[1] || DEFAULT_MODEL).trim(),
                systemPrompt: String(row[2] || '').trim(),
                temperature: Number(row[3]) || 0.5,
                maxToolCalls: Number(row[4]) || 5,
                thinkingBudget: Number(row[5]) || 0
            };
            break;
        }
    }
    if (!config)
        throw new Error(`[REGISTRY] Algo "${algoId}" not found in AgentManifest.`);
    if (!config.model.startsWith('models/')) {
        config.model = `models/${config.model}`;
    }
    if (cache)
        cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
    Logger.log(`[REGISTRY] Loaded config for algo: ${algoId}`);
    return config;
}
function getTools(algoId) {
    const cache = CacheService.getScriptCache();
    const cacheKey = `SAM_TOOLS_V3_${algoId}`;
    if (cache) {
        const cached = cache.get(cacheKey);
        if (cached)
            return JSON.parse(cached);
    }
    const ss = getSamSpreadsheet_();
    const connSheet = ss.getSheetByName('Connections');
    const registrySheet = ss.getSheetByName('ToolRegistry');
    if (!connSheet || !registrySheet) {
        throw new Error('[REGISTRY] Connections or ToolRegistry tab missing.');
    }
    const connData = connSheet.getDataRange().getValues();
    const toolNames = [];
    for (let i = 1; i < connData.length; i++) {
        if (String(connData[i][0]).trim() === algoId && connData[i][1]) {
            toolNames.push(String(connData[i][1]).trim());
        }
    }
    const regData = registrySheet.getDataRange().getValues();
    const tools = [];
    for (const tName of toolNames) {
        for (let j = 1; j < regData.length; j++) {
            if (String(regData[j][0]).trim() === tName) {
                const typeRaw = String(regData[j][1]).trim().toUpperCase();
                const type = (typeRaw === 'AGENT' || typeRaw === 'SCRIPT') ? typeRaw : 'SCRIPT';
                let schema = {};
                try {
                    // JSON schema is in column D (index 3)
                    const rawSchema = String(regData[j][3]).trim();
                    if (rawSchema)
                        schema = JSON.parse(rawSchema);
                }
                catch (e) {
                    Logger.log(`[REGISTRY] Error parsing schema for tool ${tName}: ${e}`);
                }
                // inject description so engine.ts finds it
                schema.description = String(regData[j][2]).trim();
                tools.push({
                    name: tName,
                    type: type,
                    schema: schema
                });
                break;
            }
        }
    }
    if (cache)
        cache.put(cacheKey, JSON.stringify(tools), CACHE_TTL);
    Logger.log(`[REGISTRY] Loaded ${tools.length} tool(s) for algo: ${algoId}`);
    return tools;
}
