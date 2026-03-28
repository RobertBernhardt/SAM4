/**
 * agent_tools.ts — SCRIPT tools for agent self-improvement.
 */

interface AppendExperienceArgs {
    lesson: string;
    _caller_agent_id?: string; // Auto-injected by engine.ts
}

/**
 * Agents call this to append a lesson to their own experience doc.
 * The agent_id is auto-injected by the engine — the agent doesn't need to provide it.
 * The experience doc is auto-created if it doesn't exist yet.
 */
function executeAppendExperience(args: AppendExperienceArgs): any {
    if (!args.lesson) {
        return { error: "Missing 'lesson' parameter." };
    }

    const agentId = args._caller_agent_id || 'unknown';

    try {
        // Ensure the experience doc exists (auto-creates if needed)
        const docUrl = ensureExperienceDoc_(agentId);
        if (!docUrl) {
            return { error: `Could not find or create experience doc for agent "${agentId}".` };
        }

        const timestamp = new Date().toISOString();
        const entry = `\n[${timestamp}] ${args.lesson}`;
        const result = appendToDoc(docUrl, entry);

        return { success: result === 'SUCCESS', message: `Experience logged for ${agentId}` };
    } catch (e) {
        return { error: `Failed to append experience: ${String(e)}` };
    }
}
