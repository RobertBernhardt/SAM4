/**
 * tool_runner.ts — Safe mapping for local execution of SCRIPT tools.
 *
 * Provides a mapping from the string name returned by Gemini
 * to actual local TypeScript functions.
 */
function executeScriptTool(toolName, args) {
    switch (toolName) {
        case 'calculator':
            return executeCalculator(args);
        case 'searchImageGems':
            return executeSearchImageGems(args);
        case 'searchContentGems':
            return executeSearchContentGems(args);
        case 'searchInteractiveGems':
            return executeSearchInteractiveGems(args);
        default:
            return { error: `Script tool execution failed: unmapped tool '${toolName}'` };
    }
}
