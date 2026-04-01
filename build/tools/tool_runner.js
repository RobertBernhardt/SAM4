/**
 * tool_runner.ts — Safe mapping for local execution of SCRIPT tools.
 *
 * Provides a mapping from the string name returned by Gemini
 * to actual local TypeScript functions.
 */
function executeScriptTool(toolName, args) {
    const normalizedTool = toolName.toLowerCase().replace(/_/g, '');
    switch (normalizedTool) {
        case 'calculator':
            return executeCalculator(args);
        case 'searchimagegems':
            return executeSearchImageGems(args);
        case 'searchcontentgems':
            return executeSearchContentGems(args);
        case 'searchinteractivegems':
            return executeSearchInteractiveGems(args);
        case 'marginallogexecution':
            return executeMarginalLogExecution(args);
        case 'marginallogextra':
            return executeMarginalLogExtra(args);
        case 'marginalcreatetask':
            return executeMarginalCreateTask(args);
        case 'marginalkillskip':
            return executeMarginalKillSkip(args);
        case 'marginalgeteval':
            return executeMarginalGetEval();
        default:
            return { error: `Script tool execution failed: unmapped tool '${toolName}'` };
    }
}
