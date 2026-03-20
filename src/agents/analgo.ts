/**
 * analgo.ts — The Analysis Algorithm (Analgo).
 *
 * The first agent in the hierarchy. Its purpose is to break down
 * complex user requests into logical steps. It has access to the
 * calculator tool via Gemini function calling.
 *
 * Flow:
 *  1. Receive user input + UID
 *  2. Call Gemini with system prompt + tools
 *  3. If Gemini returns a function call → dispatch to tool → feed result back
 *  4. Return final text response
 */

// ─── Config ─────────────────────────────────────────────────

const ANALGO_CONFIG = {
    id: 'analgo',
    /** Override default model if needed; set to null to use DEFAULT_MODEL. */
    model: null as string | null,
    systemPrompt: `You are the Analysis Algorithm (Analgo). Your job is to break down complex user requests into logical, actionable steps.

Rules:
- Think step-by-step before answering.
- If the user asks for a calculation, use the "calculator" tool instead of computing it yourself.
- Be concise and structured in your output.
- If a request is ambiguous, state your assumptions clearly.
- Format multi-step plans as numbered lists.`,
    /** Max tool-call loops to prevent infinite cycles. */
    maxToolCalls: 5,
};

// ─── Tool Registry ──────────────────────────────────────────

/**
 * Maps tool names → executor functions.
 * Add new tools here as the system grows.
 */
const ANALGO_TOOL_REGISTRY: Record<string, (args: any) => any> = {
    calculator: executeCalculator,
};

/** Gemini tools array for Analgo. */
const ANALGO_TOOLS: GeminiTool[] = [
    {
        functionDeclarations: [CALCULATOR_TOOL_DECLARATION],
    },
];

// ─── Main Entry ─────────────────────────────────────────────

/**
 * Runs the Analgo agent with a user message.
 * Handles the full tool-calling loop.
 *
 * @param uid   - Unique task identifier for state tracking.
 * @param input - The user's raw message.
 * @returns     - The final text response from Analgo.
 */
function runAnalgo(uid: string, input: string): string {
    // Initialise state
    createState(uid, ANALGO_CONFIG.id, {
        input,
        status: 'started',
    });

    // Build initial conversation
    const messages: GeminiMessage[] = [userMessage(input)];

    let loopCount = 0;

    while (loopCount < ANALGO_CONFIG.maxToolCalls) {
        // Call Gemini
        const response = callGemini({
            model: ANALGO_CONFIG.model || undefined,
            systemPrompt: ANALGO_CONFIG.systemPrompt,
            messages,
            tools: ANALGO_TOOLS,
            temperature: 0.7,
        });

        // Check for function calls
        const functionCalls = getFunctionCallsFromResponse(response);

        if (functionCalls.length === 0) {
            // No tool calls — we have the final answer
            const text = getTextFromResponse(response) || '[Analgo returned no response]';

            // Persist completed state
            updateState(uid, {
                status: 'completed',
                data: { response: text },
            });

            return text;
        }

        // Process each function call
        for (const fc of functionCalls) {
            Logger.log(`[ANALGO] Tool call: ${fc.name}(${JSON.stringify(fc.args)})`);

            const executor = ANALGO_TOOL_REGISTRY[fc.name];
            let toolResult: any;

            if (executor) {
                toolResult = executor(fc.args);
            } else {
                toolResult = { error: `Unknown tool: "${fc.name}"` };
                Logger.log(`[ANALGO] WARNING: Unknown tool "${fc.name}" requested.`);
            }

            // Append the model's function call to the conversation
            messages.push({
                role: 'model',
                parts: [{ functionCall: { name: fc.name, args: fc.args } }],
            });

            // Append the function result
            messages.push(functionResponseMessage(fc.name, toolResult));

            Logger.log(`[ANALGO] Tool result: ${JSON.stringify(toolResult)}`);
        }

        loopCount++;
    }

    // Safety: max loops exceeded
    const fallback = '[Analgo reached maximum tool-call depth]';
    updateState(uid, {
        status: 'error',
        data: { error: fallback },
    });

    return fallback;
}
