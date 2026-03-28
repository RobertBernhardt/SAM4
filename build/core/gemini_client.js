/**
 * gemini_client.ts — Robust wrapper around the Gemini REST API.
 *
 * Uses UrlFetchApp to call the Gemini generateContent endpoint.
 * Supports:
 *  - System instructions
 *  - Function declarations (tool calling)
 *  - Thinking budget (thinking_level)
 *  - Per-call model override
 *  - Usage metadata extraction & DAILY_TOKENS tracking
 *  - Hard stop when daily token budget is exceeded
 *  - UrlFetchApp.fetchAll() for parallel tool execution
 */
// ─── Daily Token Tracking ───────────────────────────────────
/**
 * Reads the current DAILY_TOKENS count from Script Properties.
 * Resets to 0 if the stored date is not today.
 */
function getDailyTokens_() {
    const props = PropertiesService.getScriptProperties();
    const storedDate = props.getProperty('DAILY_TOKENS_DATE') || '';
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (storedDate !== today) {
        // New day — reset counter
        props.setProperty('DAILY_TOKENS_DATE', today);
        props.setProperty('DAILY_TOKENS', '0');
        return { count: 0, date: today };
    }
    const count = parseInt(props.getProperty('DAILY_TOKENS') || '0', 10);
    return { count, date: today };
}
/**
 * Adds token usage to the daily counter.
 */
function addDailyTokens_(tokens) {
    const props = PropertiesService.getScriptProperties();
    const current = getDailyTokens_();
    const newTotal = current.count + tokens;
    props.setProperty('DAILY_TOKENS', String(newTotal));
    Logger.log(`[GEMINI_CLIENT] Daily tokens: ${newTotal} / ${DAILY_TOKEN_LIMIT}`);
    return newTotal;
}
/**
 * Throws if daily token budget is exceeded.
 */
function enforceDailyTokenLimit_() {
    const { count } = getDailyTokens_();
    if (count >= DAILY_TOKEN_LIMIT) {
        throw new Error(`[GEMINI_CLIENT] HARD STOP — Daily token limit reached (${count} / ${DAILY_TOKEN_LIMIT}). ` +
            'No further model calls allowed today.');
    }
}
// ─── Core Call ──────────────────────────────────────────────
/**
 * Calls the Gemini API and returns the raw response object.
 * Handles headers, payload construction, error logging,
 * usage tracking, and daily limit enforcement.
 */
function callGemini(options) {
    // Enforce daily limit BEFORE making the call
    enforceDailyTokenLimit_();
    const model = options.model || DEFAULT_MODEL;
    const apiKey = getGeminiApiKey();
    // Ensure model string uses models/ prefix in the URL
    const modelPath = model.startsWith('models/') ? model : `models/${model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`;
    // Build request payload
    const payload = {
        contents: options.messages,
    };
    // System instruction
    if (options.systemPrompt) {
        payload.systemInstruction = {
            parts: [{ text: options.systemPrompt }],
        };
    }
    // Tools (function calling)
    if (options.tools && options.tools.length > 0) {
        payload.tools = options.tools;
    }
    // Generation config
    const genConfig = {};
    if (options.temperature !== undefined) {
        genConfig.temperature = options.temperature;
    }
    if (options.maxOutputTokens !== undefined) {
        genConfig.maxOutputTokens = options.maxOutputTokens;
    }
    if (options.thinkingBudget !== undefined && options.thinkingBudget > 0) {
        if (!options.tools || options.tools.length === 0) {
            genConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
        }
        else {
            Logger.log(`[GEMINI_CLIENT] Stripping thinkingBudget because function calling (tools) is active. The Gemini API does not support both simultaneously and may hang.`);
        }
    }
    if (Object.keys(genConfig).length > 0) {
        payload.generationConfig = genConfig;
    }
    // Make the request
    const fetchOptions = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
    };
    try {
        const response = UrlFetchApp.fetch(url, fetchOptions);
        const statusCode = response.getResponseCode();
        const body = response.getContentText();
        if (statusCode !== 200) {
            Logger.log(`[GEMINI_CLIENT] HTTP ${statusCode}: ${body}`);
            // If it's a 404, the model name might be invalid
            if (statusCode === 404) {
                throw new Error(`Gemini API returned HTTP 404. This usually means the model ID is invalid. Model requested: "${modelPath}"`);
            }
            throw new Error(`Gemini API returned HTTP ${statusCode}`);
        }
        const parsed = JSON.parse(body);
        if (parsed.error) {
            Logger.log(`[GEMINI_CLIENT] API Error: ${parsed.error.message}`);
            throw new Error(`Gemini API error: ${parsed.error.message}`);
        }
        // Track usage metadata
        if (parsed.usageMetadata?.totalTokenCount) {
            addDailyTokens_(parsed.usageMetadata.totalTokenCount);
        }
        return parsed;
    }
    catch (error) {
        Logger.log(`[GEMINI_CLIENT] Request failed: ${error}`);
        throw error;
    }
}
// ─── Parallel Tool Execution ────────────────────────────────
/**
 * Executes multiple tool calls in parallel using UrlFetchApp.fetchAll().
 * Each request is a separate fetch; results are returned in order.
 *
 * This is used when Gemini returns multiple functionCalls in one
 * response and the tools happen to be HTTP-based.
 *
 * @param requests - Array of { url, options } for each tool call.
 * @returns Array of parsed JSON responses (or error objects).
 */
function fetchAllParallel_(requests) {
    const fetchRequests = requests.map((r) => ({
        url: r.url,
        ...r.options,
        muteHttpExceptions: true,
    }));
    const responses = UrlFetchApp.fetchAll(fetchRequests);
    return responses.map((resp, i) => {
        try {
            const code = resp.getResponseCode();
            const body = resp.getContentText();
            if (code !== 200) {
                Logger.log(`[GEMINI_CLIENT] fetchAll[${i}] HTTP ${code}: ${body}`);
                return { error: `HTTP ${code}` };
            }
            return JSON.parse(body);
        }
        catch (err) {
            Logger.log(`[GEMINI_CLIENT] fetchAll[${i}] parse error: ${err}`);
            return { error: String(err) };
        }
    });
}
// ─── Helpers ────────────────────────────────────────────────
/**
 * Extracts the text response from a GeminiResponse.
 * Returns null if the response contains a function call instead.
 */
function getTextFromResponse(response) {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!parts)
        return null;
    const textParts = parts.filter((p) => p.text !== undefined);
    if (textParts.length === 0)
        return null;
    return textParts.map((p) => p.text).join('');
}
/**
 * Extracts function call(s) from a GeminiResponse.
 * Returns an empty array if no function calls are present.
 */
function getFunctionCallsFromResponse(response) {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!parts)
        return [];
    return parts
        .filter((p) => p.functionCall !== undefined)
        .map((p) => ({
        name: p.functionCall.name,
        args: p.functionCall.args,
    }));
}
/**
 * Extracts usage metadata from a GeminiResponse.
 */
function getUsageMetadata(response) {
    return response.usageMetadata || null;
}
/**
 * Builds a user message from plain text.
 */
function userMessage(text) {
    return { role: 'user', parts: [{ text }] };
}
/**
 * Builds a model message from plain text.
 */
function modelMessage(text) {
    return { role: 'model', parts: [{ text }] };
}
/**
 * Builds a function response message to return tool results to Gemini.
 */
function functionResponseMessage(functionName, result) {
    return {
        role: 'user',
        parts: [
            {
                functionResponse: {
                    name: functionName,
                    response: result,
                },
            },
        ],
    };
}
