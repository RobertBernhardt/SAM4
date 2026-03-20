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
    const config = getAlgoConfig(algoId);
    let state = readState(uid);
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
    let loopCount = 0;
    while (loopCount < config.maxToolCalls) {
        loopCount++;
        const toolsDef = getTools(algoId);
        // Convert to Gemini format
        const geminiTools = toolsDef.length > 0 ? [{
                functionDeclarations: toolsDef.map(t => ({
                    name: t.name,
                    description: t.schema.description || '',
                    parameters: t.schema.parameters || { type: 'object', properties: {} }
                }))
            }] : [];
        const options = {
            model: config.model,
            systemPrompt: config.systemPrompt,
            messages: state.data.history,
            temperature: config.temperature,
            thinkingBudget: config.thinkingBudget,
        };
        if (geminiTools.length > 0) {
            options.tools = geminiTools;
        }
        const response = callGemini(options);
        const usage = getUsageMetadata(response);
        // state_manager.ts logging requirement
        state.data.logs.push({ step: `Call ${loopCount} (${algoId})`, tokenUsage: usage });
        const finalAns = getTextFromResponse(response);
        const fCalls = getFunctionCallsFromResponse(response);
        if (fCalls.length > 0) {
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
                    // Execute local GAS tool explicitly mapped manually
                    resultObj = executeScriptTool(fCall.name, fCall.args);
                }
                else if (tDef.type === 'AGENT') {
                    // Recursive call to run another algo
                    // Treat args as stringified input to sub-agent
                    const childInput = JSON.stringify(fCall.args);
                    const childUid = uid + '-' + fCall.name; // Could use generateUid() but keeping same root is nice
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
