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
    experienceDocUrl: string;
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

    // Load Models mapping
    const modelsSheet = ss.getSheetByName('Models');
    let modelsMap: Record<string, string> = { 'system': 'models/gemini-2.0-flash', 'bots': 'models/gemini-2.0-flash', 'simple': 'models/gemini-2.0-flash-lite', 'intermediate': 'models/gemini-2.0-flash', 'thinking': 'models/gemini-2.0-pro-exp', 'wild': 'models/gemini-2.0-flash', 'images': 'models/gemini-2.0-flash' };
    if (modelsSheet) {
        try {
            const mData = modelsSheet.getDataRange().getValues();
            for (let i = 1; i < mData.length; i++) {
                const cat = String(mData[i][0]).trim();
                const mod = String(mData[i][1]).trim();
                if (cat && mod) modelsMap[cat] = mod;
            }
        } catch (e) {
            Logger.log('[REGISTRY] Error reading Models tab: ' + e);
        }
    }

    function resolveModel(categoryOrModel: string): string {
        let mod = modelsMap[categoryOrModel] || categoryOrModel;
        if (!mod.startsWith('models/')) mod = `models/${mod}`;
        return mod;
    }

    // Hardcoded agents
    if (algoId === 'quest_update_algo') {
        const config: AlgoConfig = {
            algoId: 'quest_update_algo',
            model: resolveModel('system'),
            systemPrompt: 'You are a JSON parser for the SAM Quest Engine.\n\nYou receive a Quest ID, its current progress %, and the Creator\'s natural language reply.\n\nExtract the Creator\'s intended new progress percentage and their feedback.\n\nRules:\n- If they state a number explicitly (e.g. "35%"), use it.\n- If they say "looks good, continue", add +10 to the current progress.\n- If they say "done" or "finished" or "perfect", set progress to 100.\n- If they express dissatisfaction without a number, keep the current progress unchanged.\n- Always extract the full feedback as a clean sentence.\n\nOutput ONLY valid minified JSON:\n{"progress": <number>, "feedback": "<string>"}',
            temperature: 0,
            maxToolCalls: 5,
            thinkingBudget: 1024,
            experienceDocUrl: ''
        };
        if (cache) cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'subquest_approval_algo') {
        const config: AlgoConfig = {
            algoId: 'subquest_approval_algo',
            model: resolveModel('system'),
            systemPrompt: 'You are a JSON parser for the SAM Quest Engine.\n\nYou receive a pending Subquest Proposal and the Creator\'s natural language reply.\n\nDetermine if the Creator APPROVED or REJECTED this subquest.\n\nRules:\n- Words like "yes", "approve", "ok", "go ahead" -> APPROVE\n- Words like "no", "reject", "don\'t", "skip" -> REJECT\n- If they mention a weight number, use it. Otherwise keep the suggested weight.\n- If they modify the description, output the modified version.\n\nOutput ONLY valid minified JSON:\n{"action": "APPROVE", "weight": <number>, "description": "<string>"}\nor\n{"action": "REJECT", "weight": 0, "description": ""}',
            temperature: 0,
            maxToolCalls: 5,
            thinkingBudget: 1024,
            experienceDocUrl: ''
        };
        if (cache) cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'experience_algo') {
        const config: AlgoConfig = {
            algoId: 'experience_algo',
            model: resolveModel('system'),
            systemPrompt: 'You are the Experience Document Reviewer for the SAM agent system.\n\nYou receive the full contents of an agent\'s experience log.\n\nYour task:\n1. Remove outdated or redundant lessons.\n2. Merge duplicate insights into concise entries.\n3. Remove stale advice about things that have been fixed.\n4. Keep only actionable, specific advice.\n5. Maintain chronological order for recent entries.\n\nOutput the COMPLETE cleaned document content, ready to replace the original. Keep the header intact.',
            temperature: 0,
            maxToolCalls: 5,
            thinkingBudget: 8192,
            experienceDocUrl: ''
        };
        if (cache) cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'new_quest_algo') {
        const config: AlgoConfig = {
            algoId: 'new_quest_algo',
            model: resolveModel('system'),
            systemPrompt: 'You are a JSON parser for the SAM Quest Engine.\n\nThe Creator wants to create a new quest and has described it in natural language.\n\nExtract:\n- quest_id: A short, unique snake_case identifier (e.g. "find_plumbers_berlin")\n- description: A clean, complete description of the quest objective\n- weight: Priority 1-100 (default 10 if not mentioned. Higher = more frequent execution)\n\nOutput ONLY valid minified JSON:\n{"quest_id": "<string>", "description": "<string>", "weight": <number>}',
            temperature: 0,
            maxToolCalls: 5,
            thinkingBudget: 1024,
            experienceDocUrl: ''
        };
        if (cache) cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }

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

            const capabilityAddon = "\n\nyou have two special capabilities: 1) you have an attached personal experience doc in which you can add new entries. you should also read this before you start with your task. in this doc you can add notes for future-you what they should know which would've helped you in solving your task better and more easily. don't add information which isn't really helpful or which you had known by yourself already. also, phrase the point in a way that it's useful as a general lesson for future-you, not specific content for a tiny special task you had. add the next point in a numbered list way 2) you can log issues. this means if you wanna inform the architect of you and your tools and subagents that something doesn't work as intended or that some tool or subagent is lacking or that you got an error message or that you think you lack proper references or examples how you should do it, you can log it there and the creator will look at it. be specific, though only log issues if you think if something would be different it would be easier for you to do a better job";
            systemPromptRaw += capabilityAddon;

            config = {
                algoId: String(row[0]).trim(),
                systemPrompt: systemPromptRaw,
                model: resolveModel(String(row[2] || 'system').trim()),
                temperature: Number(row[3]) || 0.5,
                maxToolCalls: 5,
                thinkingBudget: thinkingBudget,
                experienceDocUrl: String(row[8] || '').trim(), // Col I
            };
            break;
        }
    }

    if (!config) throw new Error(`[REGISTRY] Algo "${algoId}" not found in AgentManifest.`);

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

    // Wildcard connections: tools available to ALL agents (e.g. log_issue)
    for (let i = 1; i < connData.length; i++) {
        if (String(connData[i][0]).trim() === '*' && connData[i][1]) {
            const wildcardTool = String(connData[i][1]).trim();
            if (!toolNames.includes(wildcardTool)) {
                toolNames.push(wildcardTool);
            }
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