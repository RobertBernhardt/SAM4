/**
 * tool_runner.ts — Safe mapping for local execution of SCRIPT tools.
 *
 * Provides a mapping from the string name returned by Gemini
 * to actual local TypeScript functions.
 */

function executeScriptTool(toolName: string, args: Record<string, any>): any {
    const normalizedTool = toolName.toLowerCase().replace(/_/g, '');

    switch (normalizedTool) {
        case 'calculator':
            return executeCalculator(args as any);
        case 'searchimagegems':
            return executeSearchImageGems(args as any);
        case 'searchcontentgems':
            return executeSearchContentGems(args as any);
        case 'searchinteractivegems':
            return executeSearchInteractiveGems(args as any);
        case 'logissue':
            return executeIssueLogger(args as any);
        case 'suggestsubquest':
            return executeSuggestSubquest(args as any);
        case 'appendquestdoc':
            return executeAppendQuestDoc(args as any);
        case 'appendexperience':
            return executeAppendExperience(args as any);
        default:
            return { error: `Script tool execution failed: unmapped tool '${toolName}'` };
    }
}
