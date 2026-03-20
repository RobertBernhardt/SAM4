/**
 * calculator.ts — A simple script tool (no LLM) for basic arithmetic.
 *
 * This tool is registered with Analgo via Gemini function calling.
 * When Gemini returns a `functionCall` for "calculator", the
 * execution loop dispatches to `executeCalculator()`.
 */
// ─── Tool Declaration ───────────────────────────────────────
/**
 * Gemini function declaration for the calculator tool.
 * Used when registering tools with an algo.
 */
const CALCULATOR_TOOL_DECLARATION = {
    name: 'calculator',
    description: 'Performs basic arithmetic operations: add, subtract, multiply, divide. ' +
        'Use this tool when the user asks for a mathematical calculation.',
    parameters: {
        type: 'OBJECT',
        properties: {
            operation: {
                type: 'STRING',
                description: 'The arithmetic operation to perform.',
                enum: ['add', 'subtract', 'multiply', 'divide'],
            },
            a: {
                type: 'NUMBER',
                description: 'The first operand.',
            },
            b: {
                type: 'NUMBER',
                description: 'The second operand.',
            },
        },
        required: ['operation', 'a', 'b'],
    },
};
// ─── Executor ───────────────────────────────────────────────
/**
 * Executes a calculator operation. Pure logic, no LLM.
 */
function executeCalculator(args) {
    const { operation, a, b } = args;
    switch (operation) {
        case 'add':
            return { result: a + b };
        case 'subtract':
            return { result: a - b };
        case 'multiply':
            return { result: a * b };
        case 'divide':
            if (b === 0) {
                return { error: 'Division by zero is not allowed.' };
            }
            return { result: a / b };
        default:
            return { error: `Unknown operation: "${operation}". Use add, subtract, multiply, or divide.` };
    }
}
