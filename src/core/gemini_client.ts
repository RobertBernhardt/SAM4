/**
 * gemini_client.ts — Robust wrapper around the Gemini REST API.
 *
 * Uses UrlFetchApp to call the Gemini generateContent endpoint.
 * Supports:
 *  - System instructions
 *  - Function declarations (tool calling)
 *  - Thinking budget (thinking_level)
 *  - Per-call model override
 */

// ─── Types ──────────────────────────────────────────────────

interface GeminiTool {
    functionDeclarations: GeminiFunctionDeclaration[];
}

interface GeminiFunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, { type: string; description: string; enum?: string[] }>;
        required: string[];
    };
}

interface GeminiMessage {
    role: 'user' | 'model';
    parts: GeminiPart[];
}

interface GeminiPart {
    text?: string;
    functionCall?: { name: string; args: Record<string, any> };
    functionResponse?: { name: string; response: Record<string, any> };
}

interface GeminiRequest {
    systemInstruction?: { parts: { text: string }[] };
    contents: GeminiMessage[];
    tools?: GeminiTool[];
    generationConfig?: Record<string, any>;
}

interface GeminiResponse {
    candidates?: {
        content: {
            parts: GeminiPart[];
            role: string;
        };
        finishReason: string;
    }[];
    error?: { code: number; message: string; status: string };
}

// ─── Options ────────────────────────────────────────────────

interface CallGeminiOptions {
    /** Override the default model for this call. */
    model?: string;
    /** System prompt / instruction. */
    systemPrompt?: string;
    /** Conversation history + user message. */
    messages: GeminiMessage[];
    /** Tool declarations for function calling. */
    tools?: GeminiTool[];
    /** Thinking budget (0 = disabled). */
    thinkingBudget?: number;
    /** Temperature (0-2). */
    temperature?: number;
    /** Max output tokens. */
    maxOutputTokens?: number;
}

// ─── Core Call ──────────────────────────────────────────────

/**
 * Calls the Gemini API and returns the raw response object.
 * Handles headers, payload construction, and error logging.
 */
function callGemini(options: CallGeminiOptions): GeminiResponse {
    const model = options.model || DEFAULT_MODEL;
    const apiKey = getGeminiApiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Build request payload
    const payload: GeminiRequest = {
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
    const genConfig: Record<string, any> = {};
    if (options.temperature !== undefined) {
        genConfig.temperature = options.temperature;
    }
    if (options.maxOutputTokens !== undefined) {
        genConfig.maxOutputTokens = options.maxOutputTokens;
    }
    if (options.thinkingBudget !== undefined && options.thinkingBudget > 0) {
        genConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
    }
    if (Object.keys(genConfig).length > 0) {
        payload.generationConfig = genConfig;
    }

    // Make the request
    const fetchOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
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
            throw new Error(`Gemini API returned HTTP ${statusCode}`);
        }

        const parsed: GeminiResponse = JSON.parse(body);

        if (parsed.error) {
            Logger.log(`[GEMINI_CLIENT] API Error: ${parsed.error.message}`);
            throw new Error(`Gemini API error: ${parsed.error.message}`);
        }

        return parsed;
    } catch (error) {
        Logger.log(`[GEMINI_CLIENT] Request failed: ${error}`);
        throw error;
    }
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Extracts the text response from a GeminiResponse.
 * Returns null if the response contains a function call instead.
 */
function getTextFromResponse(response: GeminiResponse): string | null {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!parts) return null;

    const textParts = parts.filter((p) => p.text !== undefined);
    if (textParts.length === 0) return null;

    return textParts.map((p) => p.text).join('');
}

/**
 * Extracts function call(s) from a GeminiResponse.
 * Returns an empty array if no function calls are present.
 */
function getFunctionCallsFromResponse(
    response: GeminiResponse
): { name: string; args: Record<string, any> }[] {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!parts) return [];

    return parts
        .filter((p) => p.functionCall !== undefined)
        .map((p) => ({
            name: p.functionCall!.name,
            args: p.functionCall!.args,
        }));
}

/**
 * Builds a user message from plain text.
 */
function userMessage(text: string): GeminiMessage {
    return { role: 'user', parts: [{ text }] };
}

/**
 * Builds a model message from plain text.
 */
function modelMessage(text: string): GeminiMessage {
    return { role: 'model', parts: [{ text }] };
}

/**
 * Builds a function response message to return tool results to Gemini.
 */
function functionResponseMessage(
    functionName: string,
    result: any
): GeminiMessage {
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
