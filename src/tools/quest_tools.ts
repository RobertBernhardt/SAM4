/**
 * quest_tools.ts — SCRIPT tools for the Quest Engine.
 */

// ─── suggest_subquest ───────────────────────────────────────

interface SuggestSubquestArgs {
    parent_quest_id: string;
    suggested_subquest_id: string;
    suggested_weight: number;
    description: string;
}

function executeSuggestSubquest(args: SuggestSubquestArgs): any {
    if (!args.parent_quest_id || !args.suggested_subquest_id || !args.suggested_weight || !args.description) {
        return { error: "Missing required parameters." };
    }

    try {
        const result = suggestSubquest(
            args.parent_quest_id,
            args.suggested_subquest_id,
            args.suggested_weight,
            args.description
        );
        return { success: true, message: result };
    } catch (e) {
        return { error: `Failed to propose subquest: ${String(e)}` };
    }
}

// ─── append_quest_doc ───────────────────────────────────────

interface AppendQuestDocArgs {
    quest_id?: string;
    run_number?: number;
    content: string;
    _caller_agent_id?: string;
    _uid?: string;
}

function executeAppendQuestDoc(args: AppendQuestDocArgs): any {
    let qId = args.quest_id;
    let rNum = args.run_number;

    // Auto-detect missing context from the execution UID
    if (args._uid && args._uid.startsWith('quest_')) {
        const match = args._uid.match(/^quest_(.+)_run(\d+)_/);
        if (match) {
            if (!qId) qId = match[1];
            if (!rNum) rNum = parseInt(match[2], 10);
        }
    }

    if (!qId || !args.content) {
        return { error: "Missing quest_id or content. Please update your json payload to include quest_id." };
    }

    try {
        // Find the quest's state doc URL
        const sheet = getQuestsSheet_();
        const data = sheet.getDataRange().getValues();
        let docUrl = '';

        for (let i = 1; i < data.length; i++) {
            if (String(data[i][0]).trim() === qId) {
                docUrl = String(data[i][8] || '').trim(); // Col I = state_doc_url
                break;
            }
        }

        if (!docUrl) {
            return { error: `No state doc found for quest "${qId}". It may not have been created yet.` };
        }

        const timestamp = new Date().toISOString();
        const structured = [
            ``,
            `--- Run #${rNum || '?'} (${timestamp}) ---`,
            args.content
        ].join('\n');

        const result = appendToDoc(docUrl, structured);
        return { success: result === 'SUCCESS', message: result, doc_url: docUrl };
    } catch (e) {
        return { error: `Failed to append to quest doc: ${String(e)}` };
    }
}
