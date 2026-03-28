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
        case 'logissue':
            return executeIssueLogger(args);
        case 'suggestsubquest':
            return executeSuggestSubquest(args);
        case 'appendquestdoc':
            return executeAppendQuestDoc(args);
        case 'appendexperience':
            return executeAppendExperience(args);
        default:
            return { error: `Script tool execution failed: unmapped tool '${toolName}'` };
    }
}
