/**
 * registry_loader.ts — Loads algo configs and tools from the SAM Google Sheet.
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

const CACHE_TTL = 60; // 60 seconds (better for development)

function getSamSpreadsheet_(): GoogleAppsScript.Spreadsheet.Spreadsheet {
    return SpreadsheetApp.openById(getSamSheetId());
}

function getAlgoConfig(algoId: string): AlgoConfig {
    const cache = CacheService.getScriptCache();
    const cacheKey = `SAM_ALGO_V6_${algoId}`;
    if (cache) {
        const cached = cache.get(cacheKey);
        if (cached) return JSON.parse(cached);
    }

    const ss = getSamSpreadsheet_();
    const sheet = ss.getSheetByName('AgentManifest');
    if (!sheet) throw new Error('[REGISTRY] AgentManifest tab not found in SAM sheet.');

    const data = sheet.getDataRange().getValues();
    let config: AlgoConfig | null = null;

    // Actual columns: A:agent_id, B:system_prompt, C:model_id, D:temperature, E:thinking_level, F:requires_critique, G:critic_id
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (String(row[0]).trim() === algoId) {
            // Map thinking_level string (e.g. "MEDIUM") to a token budget number
            const thinkingLevel = String(row[4] || '').trim().toUpperCase();
            let thinkingBudget = 0;
            if (thinkingLevel === 'LOW') thinkingBudget = 1024;
            else if (thinkingLevel === 'MEDIUM') thinkingBudget = 8192;
            else if (thinkingLevel === 'HIGH') thinkingBudget = 24576;

            let systemPromptRaw = String(row[1] || '').trim();
            
            // If the cell contains a Google Doc URL, dynamically read the entire document!
            const docMatch = systemPromptRaw.match(/\/d\/([-\w]{25,})/);
            if (docMatch && docMatch[1]) {
                try {
                    systemPromptRaw = DocumentApp.openById(docMatch[1]).getBody().getText();
                    Logger.log(`[REGISTRY] Successfully loaded system prompt from private Google Doc for ${String(row[0]).trim()}`);
                } catch (e) {
                    Logger.log(`[REGISTRY] Error fetching Google Doc for ${String(row[0]).trim()}: ${e}. Falling back to raw text.`);
                }
            }

            config = {
                algoId: String(row[0]).trim(),
                systemPrompt: systemPromptRaw,
                model: String(row[2] || DEFAULT_MODEL).trim(),
                temperature: Number(row[3]) || 0.5,
                maxToolCalls: 5,
                thinkingBudget: thinkingBudget
            };
            break;
        }
    }

    if (!config) throw new Error(`[REGISTRY] Algo "${algoId}" not found in AgentManifest.`);

    if (!config.model.startsWith('models/')) {
        config.model = `models/${config.model}`;
    }

    if (cache) cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
    Logger.log(`[REGISTRY] Loaded config for algo: ${algoId}, model: ${config.model}`);
    return config;
}

function getTools(algoId: string): ToolDefinition[] {
    const cache = CacheService.getScriptCache();
    const cacheKey = `SAM_TOOLS_V5_${algoId}`;
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

    const connData = connSheet.getDataRange().getValues();
    const toolNames: string[] = [];
    for (let i = 1; i < connData.length; i++) {
        if (String(connData[i][0]).trim() === algoId && connData[i][1]) {
            toolNames.push(String(connData[i][1]).trim());
        }
    }

    const regData = registrySheet.getDataRange().getValues();
    const tools: ToolDefinition[] = [];

    for (const tName of toolNames) {
        for (let j = 1; j < regData.length; j++) {
            if (String(regData[j][0]).trim() === tName) {
                const typeRaw = String(regData[j][1]).trim().toUpperCase();
                const type = (typeRaw === 'AGENT' || typeRaw === 'SCRIPT') ? typeRaw : 'SCRIPT';
                let schema: any = {};
                
                try {
                    // JSON schema is in column D (index 3)
                    const rawSchema = String(regData[j][3]).trim();
                    if (rawSchema) schema = JSON.parse(rawSchema);
                } catch (e) {
                    Logger.log(`[REGISTRY] Error parsing schema for tool ${tName}: ${e}`);
                }

                // inject description so engine.ts finds it
                schema.description = String(regData[j][2]).trim();

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