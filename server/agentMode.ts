import { appendChatMessageForUser } from "./db";
import { planFileName } from "./ultraplan";
import type { WorkspaceAgentOptions } from "./workspaceAgentTypes";

/**
 * The workflow modes a conversation moves through: chat is the default for a
 * new conversation and can only research; an action request flips it into
 * plan (the planning-only /ultraplan machinery); the user's approval flips it
 * into build, the ordinary full-toolkit mode. Acting is deliberately gated
 * behind planning so a request is researched and laid out before anything in
 * the workspace is touched.
 */
export type AgentMode = "chat" | "plan" | "build";

/**
 * Internal bookkeeping rows recording a conversation's current mode. They are
 * persisted as chat messages (like the specialist-acceptance markers), are
 * filtered out of the model's history and the client UI, and never shown to
 * anyone.
 */
export const AGENT_MODE_MESSAGE_PREFIX = "__nova_agent_mode__:";

/**
 * The tool a chat-mode turn calls to hand an action request over to planning.
 * It is the only non-research tool chat mode is offered: calling it records
 * the task, flips the conversation into planning mode for the rest of the run,
 * and lets the planning turn draft the plan the user then approves.
 */
export const START_PLANNING_TOOL = "start_planning";

/**
 * The tools a chat-mode turn may use: read-only research plus the transition
 * tool. Every tool that changes anything - files and folders, the editor,
 * run_bash / run_vm_task, deploys, Telegram sends, project scaffolding,
 * memory writes, connectors, the wallet and agent email - is withheld by
 * name. New tools are excluded by default, exactly like the ultraplan and
 * inbound-email allowlists.
 */
const CHAT_MODE_TOOL_ALLOWLIST = new Set([
  "end_turn",
  "list_workspace",
  "read_file",
  "search_memories",
  "read_memory",
  "solve_equation",
  "research_web",
  "thinker",
  START_PLANNING_TOOL,
]);

/** True when a tool may run inside a chat-mode turn. */
export function chatModeAllowsTool(name: string): boolean {
  return CHAT_MODE_TOOL_ALLOWLIST.has(name);
}

/**
 * Reads the latest persisted mode marker from a conversation's rows. Returns
 * null when the chat has never recorded a mode (an older chat, or a brand-new
 * one), so the caller can decide the default.
 */
export function readAgentModeMarker(
  messages: Array<{ role: string; content: string }>
): AgentMode | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messages[index].content;
    if (content.startsWith(AGENT_MODE_MESSAGE_PREFIX)) {
      const mode = content.slice(AGENT_MODE_MESSAGE_PREFIX.length);
      if (mode === "chat" || mode === "plan" || mode === "build") return mode;
      return "chat";
    }
  }
  return null;
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
  const marker = readAgentModeMarker(messages);
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
 * this mode: chat mode answers and researches, and hands any action request to
 * start_planning instead of attempting it.
 */
export function buildChatModePromptBlock(): string {
  return (
    `\n\n[CHAT MODE] This conversation is in CHAT mode: answer questions, explain, research, and discuss - but do NOT perform any action on the user's workspace. File and folder tools, the editor, run_bash / run_vm_task, deploys, sends, project scaffolding, memory writes, and connectors are NOT available in this mode, so never attempt a change and never claim one was made. ` +
    `When the user asks you to DO something - create, edit, move, rename, or delete files or folders, build or scaffold a project or site, run code or commands, deploy or delete a website, send a message, or any other change to their workspace or outside services - do not attempt it and do not refuse it: call ${START_PLANNING_TOOL} with the concrete task to carry out. That switches this conversation into planning mode, where the task is researched and a plan is drafted for the user's approval before anything changes. ` +
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
