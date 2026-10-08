/**
 * Shared domain types and the specialist-acceptance bookkeeping for the
 * workspace agent. They live here rather than in workspaceAgent.ts so the
 * run loop and the tool executor can both depend on them without a cycle.
 */
import type { AgentProfileContext } from "./agents";
import {
  appendChatMessageForUser,
  listChatMessagesForUser,
} from "./db";

export type AgentAction = {
  kind:
    | "folder"
    | "file"
    | "telegram"
    | "vm"
    | "browser"
    | "connector"
    | "research"
    | "deployment"
    | "project"
    | "tool";
  name: string;
  operation?:
    | "created"
    | "updated"
    | "renamed"
    | "moved"
    | "deleted"
    | "sent"
    | "presented"
    | "completed"
    | "disabled"
    | "listed"
    | "executed"
    | "deployed"
    | "failed";
};
export type WorkspaceToolActivity = {
  id: string;
  name: string;
  state: "running" | "completed" | "failed";
  args: Record<string, string>;
  summary?: string;
  /** Live progress note while running, or the full tool response once done. */
  detail?: string;
  /**
   * Unified diff of what an edit_file call changed (before -> after), so the
   * client can show the actual change in the edit's dropdown instead of only
   * the file name. Absent for tools that do not rewrite whole files.
   */
  diff?: string;
};
export type WorkspaceAgentOptions = {
  onEvent?: (event: {
    type: "tool";
    tool: WorkspaceToolActivity;
  }) => void | Promise<void>;
  onChunk?: (chunk: string) => void | Promise<void>;
  /** Where the request came from - shapes how the model keeps the user posted. */
  channel?: "telegram" | "web";
  /** Data-URI images attached to this turn, sent to the model as vision input. */
  imageAttachments?: string[];
  /**
   * Attachment context appended to the model's user turn but not persisted to
   * the chat, so the visible bubble stays the clean user text.
   */
  uploadContext?: string;
  /**
   * When this run must be finished by (epoch ms). Defaults to a budget just
   * under the Vercel maxDuration so the final reply is always persisted -
   * a gateway round started too close to the limit would be killed with the
   * function before the reply could be saved.
   */
  deadlineAtMs?: number;
  /**
   * True when a segmented run will automatically continue in the next
   * segment (serverless invocation) once this segment's budget ends. The
   * deadline closing status then reads as a progress note the user does not
   * have to act on, instead of asking them to send "continue".
   */
  continuationPlanned?: boolean;
  /**
   * Personal-agent context: which agent is speaking (identity, wallet,
   * memory scope) and, on team chats, the shared goal and roster. Absent on
   * ordinary Nova conversations, which behave exactly as before.
   */
  agentChat?: AgentChatRunOptions;
  /**
   * False when the caller already persisted the user's message - a team
   * hand-off turn. The run then keeps it out of the ledger and injects it
   * into the model's context only.
   */
  persistUserMessage?: boolean;
  /**
   * True when an inbound email triggered this run. The caller delivers the
   * final end_turn reply as the email reply, so send_agent_email is withheld
   * - otherwise the agent could queue a second, approval-gated copy of a mail
   * that is already being answered.
   */
  emailReply?: boolean;
};
export type AgentChatRunOptions = {
  profile: AgentProfileContext;
  /** Present only in team chats: shared goal, roster, and whether this agent delivers the final reply. */
  team?: {
    goal: string;
    roster: Array<{ id: number; name: string; role: string | null }>;
    finalMember: boolean;
  };
};
/**
 * Internal bookkeeping rows recording the specialist-down acceptance state
 * ("pending" after a run whose editor call failed, "accepted" once the user
 * OK'd Nova's own coding in a later turn, "cleared" when the editor next
 * succeeds). They are persisted as chat messages, filtered out of the
 * model's history and the client UI, and never shown to anyone.
 */
export const SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX =
  "__nova_specialist_acceptance__:";

type SpecialistAcceptanceState = "pending" | "accepted" | "none";

/** Reads the latest specialist acceptance marker for a chat. */
export async function readSpecialistAcceptance(
  ownerId: number,
  chatId: string
): Promise<SpecialistAcceptanceState> {
  const rows = (await listChatMessagesForUser(ownerId, chatId)) ?? [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const content = rows[index].content;
    if (content.startsWith(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX)) {
      const state = content.slice(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX.length);
      if (state === "pending" || state === "accepted") return state;
      return "none";
    }
  }
  return "none";
}

/** Appends a specialist acceptance marker row. */
export async function recordSpecialistAcceptance(
  ownerId: number,
  chatId: string,
  state: "pending" | "accepted" | "cleared"
): Promise<void> {
  await appendChatMessageForUser(ownerId, {
    chatId,
    role: "assistant",
    content: `${SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX}${state}`,
  });
}
