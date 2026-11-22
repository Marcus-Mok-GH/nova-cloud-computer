import { AGENT_MODE_MESSAGE_PREFIX } from "@shared/const";
import {
  appendChatMessageForUser,
} from "./db";
import { planFileName } from "./ultraplan";
import type { WorkspaceAgentOptions } from "./workspace/workspaceAgentTypes";
import { latestAgentModeMarker } from "@shared/agentMode";
import type { AgentMode } from "@shared/agentMode";

export { AGENT_MODE_MESSAGE_PREFIX };
export type { AgentMode } from "@shared/agentMode";
export { latestAgentModeMarker as readAgentModeMarker } from "@shared/agentMode";

/**
 * The workflow modes a conversation moves through: chat is the default for a
 * new conversation and can only research; from there the model itself picks
 * the route when the user asks it to do something - start_planning enters plan
 * mode (the planning-only /ultraplan machinery) for anything sizeable, while
 * start_build enters build, the ordinary full-toolkit mode, directly for small
 * and unambiguous work. Acting is deliberately gated so a request is either
 * laid out for approval or plainly small enough to just do. The type and the
 * persisted-marker parsing are shared with the client in `@shared/agentMode`.
 */


/**
 * Internal bookkeeping rows recording a conversation's current mode (marker
 * constant shared with the client via `@shared/const`). They are persisted as
 * chat messages (like the specialist-acceptance markers), are filtered out of
 * the model's history and the client UI, and never shown to anyone.
 */

/**
 * The tool a chat-mode turn calls to hand an action request over to planning.
 * It is the only non-research tool chat mode is offered: calling it records
 * the task, flips the conversation into planning mode for the rest of the run,
 * and lets the planning turn draft the plan the user then approves.
 */
export const START_PLANNING_TOOL = "start_planning";

/**
 * The tool a chat-mode turn calls to skip planning and build right away. The
 * model uses it when the first request is small and unambiguous - one file,
 * one command, a rename - so trivial work does not wait for plan approval.
 * Calling it flips the rest of this run into build mode with the full toolkit;
 * the conversation keeps the build marker like any approved plan.
 */
export const START_BUILD_TOOL = "start_build";

/**
 * The tools a chat-mode turn may use: read-only research, the two transition
 * tools (plan-first or build-now), and generate_image. Every other tool that
 * changes anything - files and
 * folders, the editor, run_bash / run_vm_task, deploys, Telegram sends, project
 * scaffolding, memory writes, connectors, the wallet and agent email - is
 * withheld by name. New tools are excluded by default, exactly like the
 * ultraplan and inbound-email allowlists.
 *
 * generate_image is the one deliberate exception: asking for a picture is the
 * whole request, not a step in a larger piece of work, and making the user go
 * through plan approval to get one would be pure friction. It stays bounded by
 * its own daily allowance and touches nothing but a new workspace file.
 */
const CHAT_MODE_TOOL_ALLOWLIST = new Set([
  "end_turn",
  // Suggesting next actions changes nothing - it only records chips for the
  // web client to show under the reply.
  "follow_up",
  "list_workspace",
  "read_file",
  "search_memories",
  "read_memory",
  // A skill's instructions are read-only research: reading one changes
  // nothing, and chat mode should be able to answer "how do we do X?" from
  // the procedure the workspace saved for it.
  "read_skill",
  "solve_equation",
  "research_web",
  "thinker",
  START_PLANNING_TOOL,
  START_BUILD_TOOL,
  "generate_image",
]);

/** True when a tool may run inside a chat-mode turn. */
export function chatModeAllowsTool(name: string): boolean {
  return CHAT_MODE_TOOL_ALLOWLIST.has(name);
}

/**
 * Resolves the workflow mode a run should use. A recorded marker wins; "plan"
 * means a plan was drafted and the user has now replied, which enters build.
 * With no marker, a chat that already has an assistant turn is an existing
 * conversation and keeps the full toolkit (build); a chat with no assistant
 * turn yet is new, so it starts in chat mode.
 */
export function resolveAgentMode(
  messages: Array<{ role: string; content: string }>
): { mode: "chat" | "build"; isNewChat: boolean; fromPlan: boolean } {
  const marker = latestAgentModeMarker(messages);
  if (marker === "plan")
    return { mode: "build", isNewChat: false, fromPlan: true };
  if (marker === "chat" || marker === "build")
    return { mode: marker, isNewChat: false, fromPlan: false };
  const hasAssistant = messages.some(message => message.role === "assistant");
  return { mode: hasAssistant ? "build" : "chat", isNewChat: !hasAssistant, fromPlan: false };
}

/** Appends a mode marker row so the mode survives across turns. */
export async function recordAgentMode(
  ownerId: number,
  chatId: string,
  mode: AgentMode
): Promise<void> {
  await appendChatMessageForUser(ownerId, {
    chatId,
    role: "assistant",
    content: `${AGENT_MODE_MESSAGE_PREFIX}${mode}`,
  });
}

/**
 * The chat-mode block appended to the system prompt. It deliberately overrides
 * the prompt's "never reply with only a plan" and "bias to action" rules for
 * this mode: chat mode answers and researches, and the model chooses between
 * the two transition tools when the user asks it to do something - planning
 * first for anything sizeable or hard to reverse, building right away for a
 * small and unambiguous request.
 */
export function buildChatModePromptBlock(): string {
  return (
    `\n\n[CHAT MODE] This conversation is in CHAT mode: answer questions, explain, research, and discuss - but do NOT perform any action on the user's workspace. File and folder tools, the editor, run_bash / run_vm_task, deploys, sends, project scaffolding, memory writes, and connectors are NOT available in this mode, so never attempt a change and never claim one was made. ` +
    `The one exception is generate_image: when the user asks you for a picture, call it directly instead of planning - generating an image is the request itself. ` +
    `When the user asks you to DO anything else, decide which route fits and do not attempt the action yourself:` +
    `- Small, unambiguous, low risk (one file, one command, a rename, a quick fix): call ${START_BUILD_TOOL} with the concrete task. That switches this conversation into build mode, and you carry the work out immediately with the full toolkit.` +
    `- Bigger, multi-step, hard to reverse, or touching deploys, messages, money or outside accounts: call ${START_PLANNING_TOOL} with the concrete task. That switches this conversation into planning mode, where the task is researched and a plan is drafted for the user's approval before anything changes. ` +
    `Never refuse a request, and never attempt either kind of action while still in chat mode. ` +
    `Answer a pure question, greeting, explanation, or research request directly with end_turn as usual.`
  );
}

/**
 * The turn instruction that enters build mode after the user approves a plan.
 * It is added to the model's user turn only (the visible bubble keeps the
 * user's clean reply).
 */
export function buildBuildModeInstruction(
  chatId: string | number | undefined,
  channel: WorkspaceAgentOptions["channel"] = "web"
): string {
  const planFile = planFileName(chatId);
  const formatting =
    channel === "telegram"
      ? "This request arrived over Telegram, so keep your final reply as plain text."
      : "This request arrived in the Nova web app.";
  return `[BUILD mode]\nThe user has reviewed the plan you drafted and their reply approves it. Implement the plan now, end-to-end, using the full toolkit, and verify the work before you finish. Read ${planFile} from the workspace root first with read_file when it exists and follow it; if their reply instead asked to change the plan, treat the changed version as the plan and implement that. ${formatting}`;
}
