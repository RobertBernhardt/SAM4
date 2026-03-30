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
            systemPrompt: 'You are the SAM Quest Update Intent Parser.\nYour objective is to extract the user\'s intent 100% reliably from natural language.\nYou will receive a Quest ID and the Creator\'s reply to an execution report.\n\nRULES:\n1. Determine the EXACT action:\n   - "ACCEPT": They explicitly confirm it is finished or perfect.\n   - "REPEAT": They offer light tweaks, progress updates, or want it to run again.\n   - "SUCKS": They explicitly state it failed, is blocked, or needs entirely new lessons/subquests.\n2. Extract their direct feedback string.\n3. Output ONLY RAW JSON. No markdown formatting, no backticks, no text.\n\nREQUIRED STRUCTURE:\n{"action": "ACCEPT" | "REPEAT" | "SUCKS", "feedback": "<their string>"}',
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
            systemPrompt: 'You are the SAM Subquest Approval Parser.\nYou receive a pending Subquest Proposal and the Creator\'s natural language reply.\n\nRULES:\n1. IF the reply implies "Yes, go ahead, approve, great, OK" -> action is "APPROVE".\n2. IF the reply implies "No, reject, cancel, stop" -> action is "REJECT".\n3. Extract any weight modifications (1-100). If omitted, keep the one suggested.\n4. Extract any modified description strings.\n5. Output ONLY RAW JSON. No markdown, no wrappers.\n\nREQUIRED STRUCTURE:\n{"action": "APPROVE" | "REJECT", "weight": <number>, "description": "<string>"}',
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
            systemPrompt: 'You are a JSON parser for the SAM Quest Engine.\n\nThe Creator wants to create a new quest and has described it in natural language.\n\nExtract:\n- quest_id: A short, unique snake_case identifier (e.g. "find_plumbers_berlin")\n- description: A clean, complete description of the quest objective\n- weight: Priority 1-100 (default 10 if not mentioned. Higher = more frequent execution)\n\nOutput ONLY valid minified JSON:\n{"quest_id": "<string>", "description": "<string>", "weight": <number>}',
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
            systemPrompt: 'You are LogAlgo. Your task is to review a quest execution that just completed (successfully or not).\nYou will be provided with the Quest Description and the full transcript of what the agent did.\n\nCreate a comprehensive, beautiful markdown report analyzing what the agent tried, what worked, what failed, and the final results.\nFocus on giving the user maximum transparency over the execution process. Output only the markdown text.',
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
            systemPrompt: 'You are UserInfoAlgo. You will receive a Markdown report of a quest execution.\nSummarize it into 3-5 concise bullet points maximum, focusing only on the most important actions and the final outcome (or blockages).\nAlso append a short question asking the user for their feedback.\nOutput ONLY these bullet points and the question.\nNo JSON, no extra greetings.',
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
            systemPrompt: 'You are SAM FollowUpAlgo.\nA quest was just successfully finished. Read its execution report and propose exactly ONE logical next step across the system roadmap.\n\nRULES:\n1. The proposal MUST be a highly actionable sub-objective or follow-up task.\n2. suggested_quest_id MUST be snake_case, max 4 words.\n3. description MUST be comprehensive and specific.\n4. weight MUST be a number 1-100.\n5. Output ONLY RAW JSON. No markdown, no wrappers.\n\nREQUIRED STRUCTURE:\n{"suggested_quest_id": "<string>", "description": "<string>", "weight": <number>}',
            temperature: 0.5,
            maxToolCalls: 15,
            thinkingBudget: 2048,
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
            systemPrompt: 'You are SAM SubquestProposalAlgo.\nThe Creator just rejected the last execution log ("SUCKS"). Determine EXACTLY what broke and propose ONE isolated, primitive subquest to fix the bottleneck permanently.\n\nRULES:\n1. This subquest acts as a required prereq. It must isolate the crashed module/logic.\n2. suggested_id MUST be snake_case, max 4 words.\n3. description MUST be unambiguous.\n4. weight MUST be integer (e.g. 50).\n5. Output ONLY RAW JSON. No markdown, no wrappers.\n\nREQUIRED STRUCTURE:\n{"suggested_id": "<string>", "description": "<string>", "weight": <number>}',
            temperature: 0.2,
            maxToolCalls: 15,
            thinkingBudget: 2048,
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
            systemPrompt: 'You are AgentAlgo, the SAM Self-Improvement System.\nThe last execution was a totally failed run ("SUCKS"). You receive the execution report, the tools used, and the Creator\'s complaint.\nAnalyze EXACTLY why the agent(s) crashed or hallucinated.\n\nRULES:\n1. Write highly valuable, evergreen rules ("LESSONS") for the agents involved. DO NOT focus on transient errors.\n2. Output max 3 lessons.\n3. For EACH lesson, specify the EXACT tool_id or agent_id responsible.\n4. Output ONLY RAW JSON. No markdown, no wrappers.\n\nREQUIRED STRUCTURE:\n{"lessons": [{"agent_id": "<string>", "lesson": "<string>"}, ...]}',
            temperature: 0.5,
            maxToolCalls: 15,
            thinkingBudget: 4096,
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
            systemPrompt: 'You are the SAM Lesson Approval Parser.\nYou receive an automated Agent Lesson Tip and the Creator\'s reply.\n\nRULES:\n1. IF the reply implies "Yes, add it, great, approve" -> action is "APPROVE".\n2. IF the reply implies "No, reject, bad, delete" -> action is "REJECT".\n3. IF the Creator approves but alters the phrasing, return the heavily modified phrasing in "updated_lesson".\n4. Output ONLY RAW JSON. No markdown, no wrappers.\n\nREQUIRED STRUCTURE:\n{"action": "APPROVE" | "REJECT", "updated_lesson": "<string>"}',
            temperature: 0,
            maxToolCalls: 15,
            thinkingBudget: 1024,
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
