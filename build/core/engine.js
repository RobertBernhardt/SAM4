/**
 * engine.ts — The Universal SAM4 Engine.
 *
 * Runs an algorithm defined in the SAM registry.
 * 1. Fetches config from registry_loader.
 * 2. Iterates tool calls (Gemini function calling).
 * 3. Resolves Tool calls (SCRIPT = execute local GAS function, AGENT = recursive runAlgo).
 * 4. Logs execution and returns the final string or array of strings.
 */
/**
 * Universally runs an algorithm by iterating through Gemini model outputs and tool responses.
 *
 * @param algoId The ID of the algorithm from the SAM registry (e.g., 'masteralgo').
 * @param uid The unique run identifier for state persistence.
 * @param input The prompt or input to the algorithm.
 * @returns Array of strings containing the final response(s) from the algorithm.
 */
function runAlgo(algoId, uid, input) {
    let state = null;
    try {
        const config = getAlgoConfig(algoId);
        state = readState(uid);
        if (!state) {
            state = createState(uid, algoId, { history: [] });
        }
        if (!state.data.history)
            state.data.history = [];
        if (!state.data.logs)
            state.data.logs = [];
        // Push the new user input
        state.data.history.push(userMessage(input));
        updateState(uid, { data: state.data, status: 'running' });
        Logger.log(`[ENGINE] runAlgo started: algo=${algoId}, uid=${uid}, model=${config.model}`);
        if (typeof isModelOverBudget === 'function' && isModelOverBudget(config.model)) {
            const errMsg = `❌ Error: Budget limit of 1,000,000 tokens reached for model ${config.model} today. System is paused.`;
            updateState(uid, { status: 'error' });
            return [errMsg];
        }
        let loopCount = 0;
        while (loopCount < config.maxToolCalls) {
            loopCount++;
            const toolsDef = getTools(algoId);
            Logger.log(`[ENGINE] Loop ${loopCount}: ${toolsDef.length} tool(s) loaded`);
            // Convert to Gemini format
            const geminiTools = toolsDef.length > 0 ? [{
                    functionDeclarations: toolsDef.map(t => ({
                        name: t.name,
                        description: t.schema.description || '',
                        parameters: t.schema.parameters || { type: 'object', properties: {} }
                    }))
                }] : [];
            // Inject the current time, agent identity, experience, AND any dynamic references
            const currentTimeStr = new Date().toString();
            const refs = typeof getReferencesPayload === 'function' ? getReferencesPayload(algoId) : { textRefs: '', imageRefs: [] };
            // Auto-create experience doc on first run if missing
            let experienceContent = '';
            if (!config.experienceDocUrl && typeof ensureExperienceDoc_ === 'function') {
                config.experienceDocUrl = ensureExperienceDoc_(algoId);
            }
            if (config.experienceDocUrl) {
                experienceContent = typeof readDocContent === 'function' ? readDocContent(config.experienceDocUrl) : '';
            }
            let injectedSystemPrompt = config.systemPrompt + '\n\n';
            injectedSystemPrompt += `[AGENT IDENTITY: You are agent "${algoId}". Use this ID when logging issues or experience.]\n\n`;
            if (experienceContent) {
                injectedSystemPrompt += `[AGENT EXPERIENCE]\n${experienceContent}\n\n`;
            }
            if (refs.textRefs) {
                injectedSystemPrompt += `[KNOWLEDGE BASE]\n${refs.textRefs}\n\n`;
            }
            injectedSystemPrompt += `[SYSTEM CLOCK: The current real-world time is ${currentTimeStr}]`;
            // Reconstruct the message payload. We safely inject heavy Image Base64 blobs 
            // into the current turn without modifying state.data.history! This saves our Sheet quotas.
            const finalMessages = [...state.data.history];
            if (refs.imageRefs && refs.imageRefs.length > 0) {
                const lastMsg = finalMessages[finalMessages.length - 1];
                if (lastMsg && lastMsg.role === 'user') {
                    finalMessages[finalMessages.length - 1] = {
                        role: 'user',
                        parts: [...lastMsg.parts, ...refs.imageRefs]
                    };
                }
            }
            const options = {
                model: config.model,
                systemPrompt: injectedSystemPrompt,
                messages: finalMessages,
                temperature: config.temperature,
                thinkingBudget: config.thinkingBudget,
            };
            if (geminiTools.length > 0) {
                options.tools = geminiTools;
            }
            Logger.log(`[ENGINE] Calling Gemini with model=${config.model}, history=${state.data.history.length} messages`);
            const response = callGemini(options);
            const usage = getUsageMetadata(response);
            // state_manager.ts logging requirement
            state.data.logs.push({ step: `Call ${loopCount} (${algoId})`, tokenUsage: usage });
            const finalAns = getTextFromResponse(response);
            const fCalls = getFunctionCallsFromResponse(response);
            if (fCalls.length > 0) {
                Logger.log(`[ENGINE] ${fCalls.length} function call(s): ${fCalls.map(f => f.name).join(', ')}`);
                // Push the model's functional call intent
                const parts = response.candidates && response.candidates[0].content.parts;
                if (parts) {
                    state.data.history.push({ role: 'model', parts: parts });
                }
                for (const fCall of fCalls) {
                    const tDef = toolsDef.find(t => t.name === fCall.name);
                    let resultObj;
                    if (!tDef) {
                        resultObj = { error: `Tool ${fCall.name} not defined for ${algoId}` };
                    }
                    else if (tDef.type === 'SCRIPT') {
                        // Execute local GAS tool — auto-inject caller agent ID
                        const argsWithCaller = { ...fCall.args, _caller_agent_id: algoId };
                        resultObj = executeScriptTool(fCall.name, argsWithCaller);
                    }
                    else if (tDef.type === 'AGENT') {
                        // Recursive call to run another algo
                        // Treat args as stringified input to sub-agent
                        const childInput = JSON.stringify(fCall.args);
                        const childUid = uid + '-' + fCall.name;
                        try {
                            const childOutput = runAlgo(fCall.name, childUid, childInput);
                            resultObj = { output: childOutput };
                        }
                        catch (e) {
                            resultObj = { error: `Agent tool failure: ${e}` };
                        }
                    }
                    else {
                        resultObj = { error: `Unknown tool type: ${tDef.type}` };
                    }
                    state.data.history.push(functionResponseMessage(fCall.name, resultObj));
                }
                // After evaluating all parallel tool calls from this message, 
                // continue loop so Gemini can analyze the newly added function responses
                updateState(uid, { data: state.data });
                continue;
            }
            else if (finalAns) {
                state.data.history.push(modelMessage(finalAns));
                updateState(uid, { data: state.data, status: 'completed' });
                // --- METRICS CALCULATION ---
                let totalTokens = 0;
                let toolLogTracker = '';
                if (state.data.logs && Array.isArray(state.data.logs)) {
                    for (const log of state.data.logs) {
                        if (log.tokenUsage && log.tokenUsage.totalTokenCount) {
                            totalTokens += log.tokenUsage.totalTokenCount;
                        }
                        if (log.step)
                            toolLogTracker += `[${log.step}] `;
                    }
                }
                // Append the fully accounted conversation to the Logs Tab
                if (typeof logConversation === 'function') {
                    logConversation(uid, algoId, input, toolLogTracker, finalAns, totalTokens, config.model);
                }
                Logger.log(`[ENGINE] Completed: algo=${algoId}, uid=${uid}. Final Token Cost: ${totalTokens}`);
                return [finalAns]; // Final conversational output
            }
            else {
                updateState(uid, { status: 'error' });
                return [`❌ Error (${algoId}): Model returned empty response or invalid format.`];
            }
        }
        updateState(uid, { status: 'error' });
        return [`❌ Error (${algoId}): Max tool iterations reached (${config.maxToolCalls}).`];
    }
    catch (err) {
        Logger.log(`[ENGINE] CRASH in runAlgo(${algoId}): ${err}`);
        // Mark state as error so it doesn't stay stuck on "running"
        try {
            updateState(uid, { status: 'error' });
        }
        catch (_) { /* ignore */ }
        // Re-throw so doPost can also send the error via Telegram
        throw err;
    }
}
