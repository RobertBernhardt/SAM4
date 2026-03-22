/**
 * tool_runner.ts — Safe mapping for local execution of SCRIPT tools.
 *
 * Provides a mapping from the string name returned by Gemini
 * to actual local TypeScript functions.
 */

function executeScriptTool(toolName: string, args: Record<string, any>): any {
    switch (toolName) {
        case 'calculator':
            return executeCalculator(args as any);
        case 'searchImageGems':
            return executeSearchImageGems(args as any);
        case 'searchContentGems':
            return executeSearchContentGems(args as any);
        case 'searchInteractiveGems':
            return executeSearchInteractiveGems(args as any);
        case 'log_issue':
            return executeIssueLogger(args as any);
        default:
            return { error: `Script tool execution failed: unmapped tool '${toolName}'` };
    }
}
