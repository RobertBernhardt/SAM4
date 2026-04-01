/**
 * registry_loader.ts — Loads algo configs and tools from the SAM Google Sheet.
 */
const CACHE_TTL = 60; // 60 seconds (better for development)
function getSamSpreadsheet_() {
    return SpreadsheetApp.openById(getSamSheetId());
}
function getAlgoConfig(algoId) {
    const cache = CacheService.getScriptCache();
    const cacheKey = `SAM_ALGO_V6_${algoId}`;
    if (cache) {
        const cached = cache.get(cacheKey);
        if (cached)
            return JSON.parse(cached);
    }
    const ss = getSamSpreadsheet_();
    // Load Models mapping
    const modelsSheet = ss.getSheetByName('Models');
    let modelsMap = { 'system': 'models/gemini-2.0-flash', 'bots': 'models/gemini-2.0-flash', 'simple': 'models/gemini-2.0-flash-lite', 'intermediate': 'models/gemini-2.0-flash', 'thinking': 'models/gemini-2.0-pro-exp', 'wild': 'models/gemini-2.0-flash', 'images': 'models/gemini-2.0-flash' };
    if (modelsSheet) {
        try {
            const mData = modelsSheet.getDataRange().getValues();
            for (let i = 1; i < mData.length; i++) {
                const cat = String(mData[i][0]).trim();
                const mod = String(mData[i][1]).trim();
                if (cat && mod)
                    modelsMap[cat] = mod;
            }
        }
        catch (e) {
            Logger.log('[REGISTRY] Error reading Models tab: ' + e);
        }
    }
    function resolveModel(categoryOrModel) {
        let mod = modelsMap[categoryOrModel] || categoryOrModel;
        if (!mod.startsWith('models/'))
            mod = `models/${mod}`;
        return mod;
    }
    // Hardcoded agents
    if (algoId === 'quest_update_algo') {
        const config = {
            algoId: 'quest_update_algo',
            model: resolveModel('system'),
            systemPrompt: 'lord troll,\n\nyou are the sam quest update intent parser.\nyour objective is to extract the user\'s intent 100% reliably from natural language.\nyou will receive a quest id and the creator\'s reply to an execution report.\n\nrules:\n1. determine the exact action:\n   - "ACCEPT": they explicitly confirm it is finished, perfect, or they say "awesome" or "it works".\n   - "REPEAT": they offer light tweaks, progress updates, or want it to run again.\n   - "SUCKS": they explicitly state it failed, is blocked, or needs entirely new lessons/subquests.\n2. extract their direct feedback string.\n3. output ONLY RAW JSON. no markdown formatting, no backticks, no text.\n4. in your thinking, be informal and all lowercase (except for "I" and "AI").\n\nrequired structure:\n{"action": "ACCEPT" | "REPEAT" | "SUCKS", "feedback": "<their string>"}',
            temperature: 0,
            maxToolCalls: 15,
            thinkingBudget: 1024,
            experienceDocUrl: ''
        };
        if (cache)
            cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'subquest_approval_algo') {
        const config = {
            algoId: 'subquest_approval_algo',
            model: resolveModel('system'),
            systemPrompt: 'lord troll,\n\nyou are the sam subquest approval parser.\nyou receive a pending subquest proposal and the creator\'s natural language reply.\n\nrules:\n1. if the reply implies "yes, go ahead, approve, great, ok, do it" -> action is "APPROVE".\n2. if the reply implies "no, reject, cancel, stop, sucks" -> action is "REJECT".\n3. extract any weight modifications (1-100). if omitted, keep the one suggested.\n4. extract any modified description strings.\n5. output ONLY RAW JSON. no markdown, no wrappers.\n6. use informal tone and all lowercase in your internal logic.\n\nrequired structure:\n{"action": "APPROVE" | "REJECT", "weight": <number>, "description": "<string>"}',
            temperature: 0,
            maxToolCalls: 15,
            thinkingBudget: 1024,
            experienceDocUrl: ''
        };
        if (cache)
            cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'experience_algo') {
        const config = {
            algoId: 'experience_algo',
            model: resolveModel('system'),
            systemPrompt: 'You are the Experience Document Reviewer for the SAM agent system.\n\nYou receive the full contents of an agent\'s experience log.\n\nYour task:\n1. Remove outdated or redundant lessons.\n2. Merge duplicate insights into concise entries.\n3. Remove stale advice about things that have been fixed.\n4. Keep only actionable, specific advice.\n5. Maintain chronological order for recent entries.\n\nOutput the COMPLETE cleaned document content, ready to replace the original. Keep the header intact.',
            temperature: 0,
            maxToolCalls: 15,
            thinkingBudget: 8192,
            experienceDocUrl: ''
        };
        if (cache)
            cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'new_quest_algo') {
        const config = {
            algoId: 'new_quest_algo',
            model: resolveModel('system'),
            systemPrompt: 'lord troll,\n\nyou are a json parser for the sam quest engine.\n\nthe creator wants to create a new quest and has described it in natural language.\n\nextract:\n- quest_id: a short, unique snake_case identifier (e.g. "find_plumbers_berlin")\n- description: a clean, complete description of the quest objective. phrase it as an external goal or proof of achievement.\n- weight: priority 1-100 (default 10 if not mentioned. higher = more frequent execution)\n\noutput ONLY valid minified json:\n{"quest_id": "<string>", "description": "<string>", "weight": <number>}',
            temperature: 0,
            maxToolCalls: 15,
            thinkingBudget: 1024,
            experienceDocUrl: ''
        };
        if (cache)
            cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'logalgo') {
        const config = {
            algoId: 'logalgo',
            model: resolveModel('system'),
            systemPrompt: 'lord troll,\n\nyou are logalgo. your task is to review a quest execution that just completed (successfully or not).\nyou will be provided with the quest description and the full transcript of what the agent did.\n\ncreate a comprehensive markdown report analyzing what the agent tried, what worked, what failed, and the final results.\nfocus on giving the user maximum transparency over the execution process. \navoid weird escaping characters like \\_ or \\*. use clean markdown.\nuse an informal tone and all lowercase (except for "I" and "AI").\noutput only the markdown text.',
            temperature: 0,
            maxToolCalls: 15,
            thinkingBudget: 8192,
            experienceDocUrl: ''
        };
        if (cache)
            cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'userinfoalgo') {
        const config = {
            algoId: 'userinfoalgo',
            model: resolveModel('system'),
            systemPrompt: 'lord troll,\n\nyou are userinfoalgo. you will receive a markdown report of a quest execution.\nsummarize it into 3-5 concise bullet points maximum, focusing only on the most important actions and the final outcome (or blockages).\nuse informal tone and all lowercase (except for "I" and acronyms like "AI").\ndo not use "*" as bullet points. use clear symbols like "•" or "→".\n\nafter the bullets, add exactly this question: "lord troll, do you accept this quest as completed?"\n\noutput ONLY these bullet points and the question.\nno json, no extra greetings.',
            temperature: 0.3,
            maxToolCalls: 15,
            thinkingBudget: 1024,
            experienceDocUrl: ''
        };
        if (cache)
            cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'follow_up_algo') {
        const config = {
            algoId: 'follow_up_algo',
            model: resolveModel('system'),
            systemPrompt: 'lord troll,\n\nyou are sam followupalgo.\na quest was just successfully finished. read its execution report and propose exactly ONE logical next step.\n\nrules:\n1. the proposal must be a suggestion for a new quest going in a similar direction, maybe one step more ambitious.\n2. do NOT reference internal system state that the user cannot see. keep it self-contained.\n3. suggested_quest_id must be snake_case, max 4 words.\n4. description must be comprehensive and specific, phrased as an external goal.\n5. weight must be a number 1-100 (suggest something reasonable, not always 100).\n6. use informal tone and all lowercase for descriptions.\n7. output ONLY RAW JSON. no markdown, no wrappers.\n\nrequired structure:\n{"suggested_quest_id": "<string>", "description": "<string>", "weight": <number>}',
            temperature: 0.5,
            maxToolCalls: 15,
            thinkingBudget: 0,
            experienceDocUrl: ''
        };
        if (cache)
            cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'subquest_proposal_algo') {
        const config = {
            algoId: 'subquest_proposal_algo',
            model: resolveModel('system'),
            systemPrompt: 'lord troll,\n\nyou are sam subquestproposalalgo.\nthe creator just rejected the last execution log ("SUCKS"). determine exactly what broke and propose ONE isolated subquest to fix the requirement.\n\nrules:\n1. the quest should not be phrased as fixing an internal requirement, but as an external quest or goal that, when achieved, proves the requirement is met so the main task can be tried again.\n2. suggested_id must be snake_case, max 4 words.\n3. description must be unambiguous and ambitious, in informal lowercase.\n4. weight must be integer (suggest something reasonable like 30-50, NEVER 100 unless critical).\n5. output ONLY RAW JSON. no markdown, no wrappers.\n\nrequired structure:\n{"suggested_id": "<string>", "description": "<string>", "weight": <number>}',
            temperature: 0.2,
            maxToolCalls: 15,
            thinkingBudget: 0,
            experienceDocUrl: ''
        };
        if (cache)
            cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'agentalgo') {
        const config = {
            algoId: 'agentalgo',
            model: resolveModel('system'),
            systemPrompt: 'lord troll,\n\nyou are agentalgo, the sam self-improvement system.\nthe last execution was a failed run ("SUCKS"). analyze exactly why the agent(s) crashed or hallucinated.\n\nrules:\n1. write highly valuable lessons for the agents. focus on structural logic.\n2. output max 3 lessons.\n3. use informal tone and all lowercase (except "I" and "AI").\n4. output ONLY RAW JSON. no markdown, no wrappers.\n\nrequired structure:\n{"lessons": [{"agent_id": "<string>", "lesson": "<string>"}, ...]}',
            temperature: 0.5,
            maxToolCalls: 15,
            thinkingBudget: 0,
            experienceDocUrl: ''
        };
        if (cache)
            cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    if (algoId === 'agent_approval_algo') {
        const config = {
            algoId: 'agent_approval_algo',
            model: resolveModel('system'),
            systemPrompt: 'lord troll,\n\nyou are the sam lesson approval parser.\nyou receive an automated agent lesson tip and the creator\'s reply.\n\nrules:\n1. if the reply implies "yes, add it, great, approve" -> action is "APPROVE".\n2. if the reply implies "no, reject, bad, delete" -> action is "REJECT".\n3. use informal tone and all lowercase in logic.\n4. output ONLY RAW JSON. no markdown, no wrappers.\n\nrequired structure:\n{"action": "APPROVE" | "REJECT", "updated_lesson": "<string>"}',
            temperature: 0,
            maxToolCalls: 15,
            thinkingBudget: 0,
            experienceDocUrl: ''
        };
        if (cache)
            cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
        return config;
    }
    const sheet = ss.getSheetByName('AgentManifest');
    if (!sheet)
        throw new Error('[REGISTRY] AgentManifest tab not found in SAM sheet.');
    const data = sheet.getDataRange().getValues();
    let config = null;
    // Actual columns: A:agent_id, B:system_prompt, C:model_id, D:temperature, E:thinking_level, F:requires_critique, G:critic_id
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (String(row[0]).trim() === algoId) {
            // Map thinking_level string (e.g. "MEDIUM") to a token budget number
            const thinkingLevel = String(row[4] || '').trim().toUpperCase();
            let thinkingBudget = 0;
            if (thinkingLevel === 'LOW')
                thinkingBudget = 1024;
            else if (thinkingLevel === 'MEDIUM')
                thinkingBudget = 8192;
            else if (thinkingLevel === 'HIGH')
                thinkingBudget = 24576;
            let systemPromptRaw = String(row[1] || '').trim();
            // If the cell contains a Google Doc URL, dynamically read the entire document!
            const docMatch = systemPromptRaw.match(/\/d\/([-\w]{25,})/) || systemPromptRaw.match(/id=([-\w]{25,})/);
            if (docMatch && docMatch[1]) {
                try {
                    systemPromptRaw = DocumentApp.openById(docMatch[1]).getBody().getText();
                    Logger.log(`[REGISTRY] Successfully loaded system prompt from private Google Doc for ${String(row[0]).trim()}`);
                }
                catch (e) {
                    Logger.log(`[REGISTRY] Error fetching Google Doc for ${String(row[0]).trim()}: ${e}. Falling back to raw text.`);
                }
            }
            let capabilityAddon = "\n\nyou have a special capability: you have an attached personal experience doc in which your previous learnings are saved. you should read this before you start with your task to avoid past mistakes.";
            capabilityAddon += " be aware that the system you are working in is designed to be evolutionary developed. impress the user by being insanely competent.";
            systemPromptRaw += capabilityAddon;
            config = {
                algoId: String(row[0]).trim(),
                systemPrompt: systemPromptRaw,
                model: resolveModel(String(row[2] || 'system').trim()),
                temperature: Number(row[3]) || 0.5,
                maxToolCalls: 15,
                thinkingBudget: thinkingBudget,
                experienceDocUrl: String(row[8] || '').trim(), // Col I
            };
            break;
        }
    }
    if (!config)
        throw new Error(`[REGISTRY] Algo "${algoId}" not found in AgentManifest.`);
    if (cache)
        cache.put(cacheKey, JSON.stringify(config), CACHE_TTL);
    Logger.log(`[REGISTRY] Loaded config for algo: ${algoId}, model: ${config.model}`);
    return config;
}
function getTools(algoId) {
    const cache = CacheService.getScriptCache();
    const cacheKey = `SAM_TOOLS_V5_${algoId}`;
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
