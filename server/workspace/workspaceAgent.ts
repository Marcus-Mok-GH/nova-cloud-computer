import {
  AI_UNAVAILABLE_PREFIX,
  GOAL_MESSAGE_PREFIX,
  INTERNAL_MESSAGE_PREFIXES,
  TOOL_ACTIVITY_MESSAGE_PREFIX,
} from "@shared/const";
import { sleep } from "@shared/timing";
import { isE2BConfigured, type E2BSandboxLike } from "../e2b";
import {
  pauseAgentSandbox,
  prepareAgentSandbox,
  syncAgentSandbox,
} from "../sandboxWorkspace";
import { getDatabaseTime, hasAgentStopAfter } from "../db";
import { hasLocalAgentStopAfter } from "../agentStopSignals";
import {
  appendConversationTurn,
  listRecentMemoriesForPrompt,
} from "../memories";
import { listSkillsForPrompt } from "../skills";
import {
  agentAddressFor,
  describeApprovalsForPrompt,
} from "../agents";
import {
  appendChatMessageForUser,
  getChatForUser,
  getCommunicationStyleForUser,
  getPersonalisationForUser,
  getUserIdentityForUser,
  getWorkspaceComputer,
  listChatMessagesForUser,
  renameChatIfDefaultForUser,
  type PersonalisationDetail,
  type PersonalisationExpertise,
  type PersonalisationProactiveness,
  type PersonalisationSettings,
} from "../db";
import {
  getAiGatewayStatus,
  chatWithAiGateway,
  type GatewayChatMessage,
  type GatewayChatMessageContentPart,
  type GatewayToolCall,
  type GatewayToolDefinition,
  AiGatewayClientError,
} from "../aiGateway";
import type { DesktopCapture } from "../desktopBrowser";
import {
  modelFailureDetail,
  redactModelCredentials,
} from "../modelFailureDetail";
import {
  completeWithWorkspaceModel,
  getActiveCustomModel,
} from "../byokGateway";
import type { CustomModel } from "../../drizzle/schema";
import { recordNovaApiError } from "../novaApiErrors";
import {
  COMPOSIO_TOOLKITS,
  type ComposioToolkit,
  getComposioConnectionStatus,
  toolkitLabel,
} from "../composio";
import {
  isCodeFileName,
  isSubstantialCode,
} from "./workspaceEdits";
import {
  FOLLOW_UP_MESSAGE_PREFIX,
  buildFollowUpMessage,
  normalizeFollowUps,
} from "../followUps";
import { WORKSPACE_TOOLS } from "./workspaceToolSchemas";
import {
  buildUltraplanInstruction,
  isPlanTool,
  parseUltraplanCommand,
  ultraplanAllowsTool,
  ULTRAPLAN_USAGE,
} from "../ultraplan";
import {
  AGENT_MODE_MESSAGE_PREFIX,
  START_PLANNING_TOOL,
  type AgentMode,
  buildBuildModeInstruction,
  buildChatModePromptBlock,
  chatModeAllowsTool,
  recordAgentMode,
  resolveAgentMode,
} from "../agentMode";
import {
  buildGoalContinuationPrompt,
  buildGoalInstruction,
  GOAL_CLEARED_MESSAGE,
  GOAL_USAGE,
  parseGoalCommand,
  recordGoalState,
  REPORT_GOAL_TOOL,
  type GoalOutcome,
} from "../goal";
import {
  latestGoalState,
  MAX_GOAL_CONTINUATIONS,
  MAX_GOAL_SEGMENTS,
  type GoalState,
} from "@shared/goal";
import {
  type AgentAction,
  type AgentChatRunOptions,
  type WorkspaceAgentOptions,
  type WorkspaceToolActivity,
  SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX,
  readSpecialistAcceptance,
  recordSpecialistAcceptance,
} from "./workspaceAgentTypes";
import {
  type OwnCodingGate,
  type ToolExecution,
  executeWorkspaceTool,
} from "./workspaceToolExecutor";
import { describeDeploymentsForUser } from "../siteDeploy";
import { describeWorkspaceEnvVarsForUser } from "../db";
import { launchPreparingNextTurn } from "../agentsInit";
import { RunCitations, citationStyleFor } from "../citations";
// Re-exported so existing importers of this module keep working.
export { isCodeFileName, isSubstantialCode, unifiedDiff } from "./workspaceEdits";
export type {
  AgentAction,
  AgentChatRunOptions,
  WorkspaceAgentOptions,
  WorkspaceToolActivity,
} from "./workspaceAgentTypes";
export { SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX } from "./workspaceAgentTypes";
export { AGENT_MODE_MESSAGE_PREFIX, START_PLANNING_TOOL } from "../agentMode";


/** Identity + team context for one personal-agent run. */

/**
 * Vercel caps functions at 300s; leave a safety margin so the closing reply
 * is persisted well before the instance can be frozen or killed. The webhook
 * anchors the deadline to when the Telegram update ARRIVED, not when the
 * agent run starts - pre-run work (upload download, voice transcription)
 * would otherwise push the closing reply past the hard runtime limit.
 */
export const MAX_RUN_BUDGET_MS = 285_000;
/** Race cap for the model-written closing status; falls back to the template. */
const DEADLINE_CLOSE_MODEL_CAP_MS = 8_000;
/** Skip the final model round when less than this remains. */
const FINAL_ROUND_MIN_REMAINING_MS = 45_000;
/**
 * Thinking-block streaming cadence: reasoning-capable models emit their
 * private reasoning as reasoning_content deltas, which are shown live as a
 * collapsible thinking block (like the tool blocks). Deltas are coalesced -
 * a persisted activity update goes out at most every 2s and only once a
 * meaningful amount of new reasoning arrived - so watching the model think
 * never floods the event stream or the chat ledger.
 */
const THINKING_EMIT_INTERVAL_MS = 2_000;
const THINKING_MIN_DELTA_CHARS = 240;
/** Cap on the reasoning text kept in a thinking block (reasoning can be long). */
const THINKING_DETAIL_LIMIT = 20_000;
/**
 * How often a streaming run asks the database whether someone pressed /stop.
 * A stop served by this same instance is seen on the next chunk without a
 * query (see agentStopSignals); this cadence only covers stops served
 * elsewhere, where a second or two of delay is acceptable.
 */
const STOP_DB_POLL_MS = 2_000;

// Re-exported so existing importers of this module keep working.
export { TOOL_ACTIVITY_MESSAGE_PREFIX };
export { GOAL_COMMAND, REPORT_GOAL_TOOL } from "../goal";
export {
  CODER_NUDGE_PREFIX,
  FAILURE_NUDGE_PREFIX,
} from "./workspacePrompt";
export { setGatewayRetryBackoffForTests } from "./workspaceRetry";

import {
  END_TURN_NUDGE_PREFIX,
  REPEATED_FAILURE_PREFIX,
  failureNudgeFor,
  coderNudgeFor,
  formatPersonalisationForPrompt,
  WORKSPACE_AGENT_PROMPT,
  agentIdentityPromptBlock,
} from "./workspacePrompt";
import {
  getConnectedConnectorToolkits,
  workspaceToolsForConnectors,
  emailReplyAllowsTool,
  connectorStatusLine,
} from "./workspaceConnectors";
import {
  toolCallWrittenAsText,
  errorChainText,
  toolSummary,
} from "./workspaceActivity";
import {
  RunDeadlineExceeded,
  raceToolDeadline,
  chatWithGatewayRetry,
  type GatewayRetryState,
} from "./workspaceRetry";

export {
  END_TURN_NUDGE_PREFIX,
  REPEATED_FAILURE_PREFIX,
  failureNudgeFor,
  coderNudgeFor,
  agentIdentityPromptBlock,
  getConnectedConnectorToolkits,
  workspaceToolsForConnectors,
  emailReplyAllowsTool,
  connectorStatusLine,
};

const DEFAULT_CHAT_TITLES = new Set([
  "New workspace conversation",
  "New conversation",
  "Telegram Chat",
]);

/** Generates a concise title for a chat based on its first user and assistant messages, but only when the title is still a default placeholder. */
export async function autoTitleChatForUser(
  ownerId: number,
  chatId: string
): Promise<void> {
  try {
    const chat = await getChatForUser(ownerId, chatId);
    if (!chat || !DEFAULT_CHAT_TITLES.has(chat.title)) return;
    const messages = await listChatMessagesForUser(ownerId, chatId);
    const firstUser = messages?.find(m => m.role === "user");
    // The LAST assistant text row, not the first: a run also persists the
    // lines it says before each tool call, and the closing reply is what the
    // turn was actually about.
    const lastAssistant = messages?.findLast(
      m =>
        m.role === "assistant" &&
        !m.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX) &&
        !m.content.startsWith(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX) &&
        !m.content.startsWith(AGENT_MODE_MESSAGE_PREFIX) &&
        !m.content.startsWith(FOLLOW_UP_MESSAGE_PREFIX) &&
        !m.content.startsWith(GOAL_MESSAGE_PREFIX)
    );
    if (!firstUser || !lastAssistant) return;
    const prompt = [
      "Generate a concise 3-6 word title for this conversation. Reply with the title only - no quotes, no trailing punctuation.",
      firstUser.content,
      lastAssistant.content,
    ].join("\n");
    const result = await completeWithWorkspaceModel(
      ownerId,
      prompt.slice(0, 2000)
    );
    const raw = String(result.text ?? "")
      .trim()
      .split("\n")[0]
      .replace(/^["']+|["']+$/g, "")
      .trim()
      .slice(0, 60);
    if (raw)
      await renameChatIfDefaultForUser(
        ownerId,
        chatId,
        raw,
        Array.from(DEFAULT_CHAT_TITLES)
      );
  } catch (error) {
    console.error("[Chat title] auto-title failed", error);
  }
}

/**
 * Runs the workspace agent for a message: a tool-calling loop over the AI
 * gateway. Every message goes through the model with workspace tools
 * (create/read/edit/rename/move/delete files and folders, Telegram, VM runs);
 * the loop executes requested tools and continues until the model produces a
 * final text reply (or the round cap is hit).
 */
export async function runWorkspaceAgent(
  ownerId: number,
  chatId: string,
  content: string,
  options: WorkspaceAgentOptions = {}
) {
  const emitTool = async (tool: WorkspaceToolActivity) => {
    try {
      await options.onEvent?.({ type: "tool", tool });
    } catch {}

    // Persist every state (including "running") so a conversation opened in
    // the web app can show the task as it happens; the client renders the
    // latest row per activity id.
    try {
      await appendChatMessageForUser(ownerId, {
        chatId,
        role: "assistant",
        content: `${TOOL_ACTIVITY_MESSAGE_PREFIX}${JSON.stringify(tool)}`,
      });
    } catch (error) {
      console.error("[Tool activity] failed to persist", error);
    }
  };
  /**
   * In a team chat every reply is attributed to the agent that wrote it;
   * personal and ordinary chats keep unattributed replies.
   */
  const authorPrefix = options.agentChat?.team
    ? `[${options.agentChat.profile.name}] `
    : "";
  /**
   * Appends the assistant's reply to the chat and returns the persisted
   * message. Every call is an end-of-run reply, so the completed turn is
   * also captured into the chat's conversation memory (the record the
   * search_memories / read_memory tools serve). appendConversationTurn
   * never throws - a memory failure must not break the run.
   */
  /**
   * Model output is not trusted to open with an internal ledger marker. Read
   * back from the chat, a row that begins with one is indistinguishable from
   * state the server recorded itself (the goal, the workflow mode, the follow-up
   * chips, tool activity), and the run loop acts on that state unattended - so
   * text the model merely read (an email, a fetched page, a file, connector
   * data) must not be able to leave one behind. A zero-width space keeps the
   * text the user reads intact while stopping it from parsing as a marker.
   */
  const defuseInternalMarker = (text: string): string =>
    INTERNAL_MESSAGE_PREFIXES.some(prefix => text.startsWith(prefix))
      ? `\u200b${text}`
      : text;
  const persistAssistant = async (reply: string) => {
    const message = await appendChatMessageForUser(ownerId, {
      chatId,
      role: "assistant",
      content: `${authorPrefix}${defuseInternalMarker(reply)}`,
    });
    const turn = { userText: content, assistantText: reply };
    if (options.agentChat) {
      await appendConversationTurn(ownerId, chatId, turn, {
        agentId: options.agentChat.profile.id,
      });
    } else {
      await appendConversationTurn(ownerId, chatId, turn);
    }
    return message;
  };
  /**
   * Persists the text a round streamed before its tool calls as its own
   * assistant row, written ahead of the tool rows those calls append. Without
   * this the ledger only ever held the final reply, so a line like "let me
   * check that" disappeared from the chat the moment the run settled even
   * though the user watched it stream in. This is interim narration, not the
   * turn's reply, so it is deliberately not captured into conversation memory.
   */
  const persistRoundText = async (text: string) => {
    try {
      await appendChatMessageForUser(ownerId, {
        chatId,
        role: "assistant",
        content: `${authorPrefix}${defuseInternalMarker(text)}`,
      });
    } catch (error) {
      console.error("[Chat] failed to persist interim reply text", error);
    }
  };

  const actions: AgentAction[] = [];
  const deadlineAtMs = options.deadlineAtMs ?? Date.now() + MAX_RUN_BUDGET_MS;
  const retryState: GatewayRetryState = { rateLimitRetriesUsed: 0 };
  // Summaries of the tool calls in the current round - they brief the model
  // on the closing reply when the run runs out of time before the final round.
  let lastRoundSummaries: string[] = [];
  // The run ends ONLY when the model calls end_turn. A text-only round is
  // kept as the running draft reply and nudged, so the final answer is never
  // lost if the model forgets the explicit end. The chars companion records
  // how much of that draft already streamed to the client.
  let draftReply = "";
  let draftStreamedChars = 0;
  let endTurnCalled = false;
  /**
   * Closing reply for a run that hits its time budget: the last round's
   * completed tool summaries brief the model that writes it, so the user still
   * hears where things
   * stand, and naming the step that was cut short - skipped or interrupted -
   * instead of counting it among the completed work.
   */
  /** The closing status when the run budget runs out is written by the model
   * - honest, specific, in Nova's own words. There is deliberately no canned
   * fallback: if the gateway will not answer in time, the run falls through
   * to the ordinary empty-reply handling instead of pretending with template
   * text. The race cap keeps the closing reply inside the request budget. */
  const composeDeadlineClose = async (
    unfinishedTool: string | null = null,
    unfinishedToolStarted = true
  ): Promise<string> => {
    const summaries = lastRoundSummaries
      .map(summary => `- ${summary}`)
      .join("\n");
    try {
      const completion = (await Promise.race([
        completeWithWorkspaceModel(
          ownerId,
          `You are Nova, an AI assistant working inside the user's personal cloud workspace. You just hit the end of the time you may spend on this single message; your work so far stops here but the conversation continues.

Completed steps:
${summaries || "(none recorded yet)"}
${unfinishedTool ? `\nThe \`${unfinishedTool}\` step was ${unfinishedToolStarted ? "still running when time ran out and was interrupted, not finished" : "skipped because time ran out before it could start"}.` : ""}

${
  options.continuationPlanned
    ? `Write a short progress status (2-4 sentences): what got done so far and what is still left. The work continues automatically in a few seconds without any user action. Do not ask the user to reply or wait, and do not mention time budgets, segments, or limits. Output only that message.`
    : `Write a short, honest status message to the user (2-4 sentences): what got done, what is unfinished, and that they can send "continue" so you pick up exactly where you left off. Output only that message.`
}`
        ).catch(() => null),
        sleep(DEADLINE_CLOSE_MODEL_CAP_MS),
      ])) as { text?: unknown } | null | undefined;
      const text =
        typeof completion?.text === "string" ? completion.text.trim() : "";
      return text && text.length <= 800 ? text : "";
    } catch {
      return "";
    }
  };
  // Everything streamed to the client during this run - needed by the catch
  // below to keep the partial reply when the gateway fails mid-run.
  let streamedRunText = "";
  // Failure disclosure: every failed tool call of the run, and how many
  // times each exact call (name + arguments) has failed. Declared outside
  // the try so the catch can still disclose them. The list feeds the
  // one-per-run failure nudge and the error-path close-out note; the map
  // intercepts a model stuck repeating an identical failing call.
  const failedSteps: string[] = [];
  // Whether this run routes to the workspace's own provider (BYOK).
  // Declared outside the try so the catch below can surface the provider's
  // raw error instead of the built-in service's sanitized notice.
  let byok = false;
  // Whether the failure that ends the run came from the model call itself
  // (a gateway round) rather than from a setup, database, or sandbox step.
  // Only model-call failures are recorded to the admin notification tab -
  // `!byok` alone would also capture errors like a failed sandbox wake.
  let modelCallFailed = false;
  const failedAttempts = new Map<
    string,
    { count: number; firstFailure: string }
  >();
  let failureNudgeSent = false;

  // A team hand-off turn is context for the next teammate only: the user's
  // real message was already persisted by the first teammate's run.
  // `persistedUserMessage` is the mirror case: the run does own the write, but
  // the caller has already framed `content` with instructions the user never
  // typed (an inbound email), so the ledger gets what was actually sent while
  // the model still reads the framed version.
  if (options.persistUserMessage !== false) {
    await appendChatMessageForUser(ownerId, {
      chatId,
      role: "user",
      content: options.persistedUserMessage ?? content,
    });
  }

  // `/ultraplan <task>` turns this turn into a deep, planning-only pass. The
  // typed command stays the persisted user bubble; the planning directive is
  // added to the model's turn only. Inbound-email runs are untrusted input and
  // never get the mode.
  const ultraplan = options.emailReply
    ? null
    : parseUltraplanCommand(content);

  // `/goal <objective>` starts an autonomous chase - the agent works round after
  // round toward the objective, and the chained segments of a long run continue
  // it - until it reports the goal met or blocked. Like /ultraplan, the typed
  // command stays the persisted user bubble and the directive is added to the
  // model's turn only, and inbound-email runs never get it.
  const goalCommand = options.emailReply ? null : parseGoalCommand(content);

  // The workspace sandbox wakes in parallel with every run: `sandboxWake`
  // resolves to the live machine (or undefined when E2B is not configured or
  // the wake failed). It stays a resolved-undefined promise until the wake is
  // actually kicked off, so an early return (a usage answer, an unreachable
  // gateway) shares the same binding as the finally block below, which awaits
  // it before syncing the live filesystem back into the durable Neon/S3 store
  // and pausing the machine, no matter how the run ends.
  let sandboxWake: Promise<E2BSandboxLike | undefined> =
    Promise.resolve(undefined);
  let sandboxWorkspaceId: number | undefined;

  try {
    // `/ultraplan` with no task plans nothing: answer with usage instead of
    // waking the sandbox or spending an agent run.
    if (ultraplan && !ultraplan.task) {
      await options.onChunk?.(ULTRAPLAN_USAGE);
      const message = await persistAssistant(ULTRAPLAN_USAGE);
      return { message, actions: [], outOfBudget: false };
    }
    // `/goal` with nothing to aim at, and `/goal clear`, are answered here too:
    // neither spends an agent run, and clearing must record the goal's end so
    // the next run does not pick the chase back up.
    if (goalCommand?.kind === "usage") {
      await options.onChunk?.(GOAL_USAGE);
      const message = await persistAssistant(GOAL_USAGE);
      return { message, actions: [], outOfBudget: false };
    }
    if (goalCommand?.kind === "clear") {
      await recordGoalState(ownerId, chatId, {
        objective: "",
        status: "cleared",
        segments: 0,
      });
      await options.onChunk?.(GOAL_CLEARED_MESSAGE);
      const message = await persistAssistant(GOAL_CLEARED_MESSAGE);
      return { message, actions: [], outOfBudget: false };
    }
    // A workspace with its own provider (BYOK) never depends on the built-in
    // gateway, so its health flags do not gate the run. The flag also lets
    // the catch below surface the provider's raw error instead of the
    // built-in service's sanitized notice.
    const customModel = await getActiveCustomModel(ownerId);
    byok = Boolean(customModel);
    // The chat's selected model, read once per run: rounds and transient
    // retries reuse it, so switching models mid-conversation cannot change
    // the model serving a run that is already in flight. The gateway
    // re-checks the plan on every request, so this is routing only.
    const chatModel = (await getChatForUser(ownerId, chatId))?.model ?? undefined;
    if (!customModel) {
      const status = await getAiGatewayStatus(ownerId);
      if (!status.configured) {
        const reply =
          "Nova's AI is not connected on this workspace yet. An administrator must finish setting it up before chat is available.";
        await options.onChunk?.(reply);
        const message = await persistAssistant(reply);
        return { message, actions: [], outOfBudget: false };
      }
      if (
        !status.reachable ||
        (status.providerConfigurationKnown && !status.providerConfigured)
      ) {
        const reply =
          "Nova's AI service is temporarily unreachable. Please try again shortly.";
        await options.onChunk?.(reply);
        const message = await persistAssistant(reply);
        return { message, actions: [], outOfBudget: false };
      }
      if (status.allowance.exhausted) {
        const reply = `Nova's shared request allowance is exhausted (${status.allowance.usedRequests}/${status.allowance.maxRequests} requests used). Please try again later or contact an administrator to raise the cap.`;
        await options.onChunk?.(reply);
        const message = await persistAssistant(reply);
        return { message, actions: [], outOfBudget: false };
      }
    }

    let computer = await getWorkspaceComputer(ownerId);
    // The sandbox wake is started here but never awaited on the run's
    // critical path: E2B connects (or boots) the machine and the durable
    // store's files sync into it while the prompt is built and the first
    // model round streams, so a slow wake can no longer delay the reply's
    // first tokens. Any tool that needs the live filesystem awaits the
    // promise first (see the tool loop below); the finally block awaits it
    // before syncing and pausing, so a wake that outlives its run still
    // settles and never leaks a machine. A failed wake resolves to undefined
    // and degrades the run to direct database tools, exactly as before.
    const wakeComputer = computer;
    sandboxWorkspaceId = wakeComputer.workspace.id;
    sandboxWake = (async () => {
      if (!isE2BConfigured()) return undefined;
      // Start the wake before the activity row: the row is bookkeeping and
      // must not stand between the run and E2B.
      const wake = prepareAgentSandbox(ownerId, wakeComputer);
      await emitTool({
        id: "sandbox-wake",
        name: "wake_sandbox",
        state: "running",
        args: {},
      });
      const sandbox = await wake;
      // Flip the row as soon as the wake lands, wherever the run has got to
      // by then: completed with the live machine, failed when the run fell
      // back to direct database tools.
      await emitTool({
        id: "sandbox-wake",
        name: "wake_sandbox",
        state: sandbox ? "completed" : "failed",
        args: {},
        summary: sandbox
          ? "Woke the workspace sandbox and synced the files into it."
          : "The workspace sandbox could not be woken this run; continuing with direct workspace storage.",
      });
      return sandbox;
    })();
    const connectedConnectors = await getConnectedConnectorToolkits(ownerId);
    const identity = await getUserIdentityForUser(ownerId);
    const communicationStyle = await getCommunicationStyleForUser(ownerId);
    const personalisation = await getPersonalisationForUser(ownerId);
    // The deployment registry - every site's ID, URL and description - rides
    // along in the system prompt so targeting deployments stays explicit
    // across every chat.
    const deploymentsLine = await describeDeploymentsForUser(ownerId);
    // The workspace's environment variables, by NAME only - values never
    // enter the prompt. deploy_website attaches them to a deployment by name.
    const environmentVarsLine = await describeWorkspaceEnvVarsForUser(ownerId);
    const userLine = identity.username
      ? `@${identity.username}${identity.name ? ` (${identity.name})` : ""}`
      : identity.name || identity.email || "the user";
    // present_file and send_progress_update are Telegram-only: over Telegram
    // the user sees none of the tool activity, so interim notes are needed -
    // in the web app the user watches the tool activity live, and offering
    // the tool there only produces stray Telegram pings.
    // This conversation's workflow mode (chat -> plan -> build). Only ordinary
    // assistant chats participate; ultraplan, inbound-email, and personal-agent
    // runs keep their own tool rules unchanged. The mode is recorded as an
    // internal marker row, and the rows are read once here and reused for the
    // model history below.
    const modesEnabled = !ultraplan && !options.emailReply && !options.agentChat;
    const priorMessages =
      (await listChatMessagesForUser(ownerId, chatId)) ?? [];
    const resolvedMode = modesEnabled
      ? resolveAgentMode(priorMessages)
      : { mode: "build" as const, isNewChat: false, fromPlan: false };
    let agentMode: AgentMode = resolvedMode.mode;
    // A brand-new conversation starts in chat mode; record it so the mode
    // survives the turn. A "plan" marker means a plan was drafted and the user
    // has now replied, which enters build for this run.
    if (modesEnabled && resolvedMode.isNewChat)
      await recordAgentMode(ownerId, chatId, "chat");
    if (modesEnabled && resolvedMode.fromPlan)
      await recordAgentMode(ownerId, chatId, "build");

    /**
     * The goal chase this run is part of, or null when it is an ordinary run.
     *
     * A `/goal <objective>` message starts one; a conversation whose last goal
     * row is still `active` carries it on - which is what makes the chase
     * survive the chained segments of a long run, and a user who left it
     * unfinished. Every run that chases spends one of the goal's segment
     * allowance, so an unmet goal cannot be pursued forever.
     */
    let goal: GoalState | null = null;
    // A chase is a single-agent pursuit, so the runs that keep their own rules
    // never pick the conversation's goal up, even when one is running. An
    // inbound-email run is untrusted input from a stranger; an /ultraplan turn
    // is read-only by contract and cannot report an outcome; and a team
    // member's turn is one contribution to a discussion, not a run of its own.
    // The user's next ordinary message resumes the chase.
    if (!options.emailReply && !ultraplan && !options.agentChat?.team) {
      if (goalCommand?.kind === "set") {
        goal = {
          objective: goalCommand.objective,
          status: "active",
          segments: 1,
        };
      } else {
        const existing = latestGoalState(priorMessages);
        if (
          existing?.status === "active" &&
          existing.segments < MAX_GOAL_SEGMENTS
        )
          goal = { ...existing, segments: existing.segments + 1 };
        else if (existing?.status === "active") {
          // The chase has spent its allowance. Stop, and record that it did -
          // the alternative is an unmet goal quietly spending credits forever.
          await recordGoalState(ownerId, chatId, {
            ...existing,
            status: "unfinished",
          });
        }
      }
    }
    if (goal) await recordGoalState(ownerId, chatId, goal);
    const goalRun = goal !== null;
    // A chase is work, not a question: it runs in build mode whatever the
    // conversation's stage was. Chat mode is research-only and plan mode is
    // read-only, and neither offers report_goal - a chase there could neither
    // change anything nor report that it was done. Setting a goal is the user
    // saying to get on with it, which is what entering build mode means.
    if (goalRun && modesEnabled && agentMode !== "build") {
      agentMode = "build";
      await recordAgentMode(ownerId, chatId, "build");
    }

    // Follow-up chips are a web-app affordance: follow_up proposes tappable
    // next actions that sit under the reply, which Telegram cannot render, so
    // the tool is withheld from every Telegram run (mode allowlists included).
    // Inbound-email runs drop it through their own strict allowlist below.
    const allTools = workspaceToolsForConnectors(connectedConnectors).filter(
      tool =>
        !(options.channel === "telegram" && tool.function.name === "follow_up")
    );
    // The full toolkit an ordinary build turn gets: everything the previous
    // filter allowed, minus the plan-writing tools and the chat transition tool.
    const buildTools = allTools.filter(tool => {
      const { name } = tool.function;
      if (isPlanTool(name) || name === START_PLANNING_TOOL) return false;
      // Ending a chase only means something while one is running; an ordinary
      // run must not be able to report a goal it is not chasing.
      if (name === REPORT_GOAL_TOOL && !goalRun) return false;
      // An inbound-email run is untrusted input from a stranger, so it gets
      // a strict allowlist instead of the full workspace toolkit.
      if (options.emailReply) return emailReplyAllowsTool(name);
      if (
        options.channel !== "telegram" &&
        (name === "present_file" || name === "send_progress_update")
      )
        return false;
      // The gated identity tools belong to personal agents only.
      if (
        !options.agentChat &&
        (name === "request_purchase" || name === "send_agent_email")
      )
        return false;
      return true;
    });
    // Chat mode is research-only: no tool that can change anything, plus the
    // single transition tool that hands an action request to planning.
    const chatTools = allTools.filter(tool =>
      chatModeAllowsTool(tool.function.name)
    );
    // The planning phase reuses the /ultraplan allowlist: read-only research
    // plus the two plan-writing tools. This is also the strict allowlist an
    // explicit /ultraplan turn gets, so the plan can never change anything.
    const planTools = allTools.filter(tool =>
      ultraplanAllowsTool(tool.function.name)
    );
    const toolsForMode = (): GatewayToolDefinition[] => {
      if (ultraplan) return planTools;
      if (!modesEnabled) return buildTools;
      if (agentMode === "chat") return chatTools;
      if (agentMode === "plan") return planTools;
      return buildTools;
    };
    let agentTools = toolsForMode();
    const memoriesLine = await listRecentMemoriesForPrompt(
      ownerId,
      8,
      options.agentChat ? { agentId: options.agentChat.profile.id } : undefined
    );
    // Skills by name and description only - the body of a skill stays out of
    // the prompt and is loaded on demand through read_skill, so a library of
    // a dozen skills costs a dozen short lines until one is actually needed.
    const skillsLine = await listSkillsForPrompt(ownerId);
    // Personal agents see their own approval state (what of theirs is still
    // waiting on the user, and how the last few were decided) and get the
    // identity block; the default assistant's prompt stays unchanged.
    const agentIdentityLine = options.agentChat
      ? agentIdentityPromptBlock(
          options.agentChat,
          await describeApprovalsForPrompt(
            ownerId,
            options.agentChat.profile.id
          )
        )
      : "";
    const systemMessage = (): GatewayChatMessage => {
      return {
        role: "system",
        content: WORKSPACE_AGENT_PROMPT.replace("{{memories}}", memoriesLine)
          .replace("{{skills}}", skillsLine)
          .replace("{{agent_identity}}", agentIdentityLine)
          .replace(
            "{{mode}}",
            agentMode === "chat" ? buildChatModePromptBlock() : ""
          )
          .replace("{{connectors}}", connectorStatusLine(connectedConnectors))
          .replace("{{deployments}}", deploymentsLine)
          .replace("{{environment_variables}}", environmentVarsLine)
          .replace(
            "{{style}}",
            communicationStyle
              ? `The user's saved preferred communication style: "${communicationStyle}" - follow it in every reply.`
              : ""
          )
          .replace(
            "{{personalisation}}",
            formatPersonalisationForPrompt(personalisation)
          )
          .replace("{{user}}", userLine)
          .replace(
            "{{channel}}",
            options.channel === "telegram"
              ? "Telegram - the user only sees the messages you send, not your tool activity. Telegram renders plain text only: never use markdown formatting of any kind (no headings, bold, italics, strikethrough, code blocks, tables, or [label](url) links) - write plain sentences, paste raw URLs, and use plain hyphens or numbers when a list helps"
              : "the Nova web app - the user sees your tool activity live as you work"
          )
          .replace(
            "{{progress_updates}}",
            options.channel === "telegram"
              ? `- Keep the user posted on Telegram, and own the ETA while you work. Over Telegram the user sees only the messages you send - none of your tool activity. No confirmation is sent for you automatically anymore: when the task will take more than a few seconds, your first send_progress_update should be a brief acknowledgment with an honest time estimate, then go straight to work - but for a quick question or greeting, just answer it directly. From then on the estimate is yours to maintain: keep sending short updates at a steady rhythm as you work - after each meaningful step completes, and never let more than a minute or so pass in silence on a long run - and whenever reality diverges from your estimate, say so and send the revised range ("taking longer than expected - about 2 more minutes", "nearly there, ~20 seconds"). Tell the user immediately when you hit a blocker - saying whether you are solving it yourself or need something from them - and whether it changes the ETA. Use send_progress_update for every note, keep each one brief, and never send a "done" summary until the work actually is done. When you create or meaningfully update a file worth showing - not only ones the user explicitly asked for - present it with present_file on your own initiative so they can view or download it right in the chat.`
              : "- In the web app the user watches your tool activity live as you work, so skip interim progress notes and just do the work - send_progress_update and present_file are Telegram-only and are not available here. Tell the user about a blocker or a revised expectation in your final reply instead of pinging mid-run, and deliver the finished work with end_turn as usual."
          ),
      };
    };

    const imageParts = (options.imageAttachments ?? []).filter(uri =>
      uri.startsWith("data:image/")
    );
    let visionActive = imageParts.length > 0;
    // False once a model has rejected images: the browse tool then stops
    // attaching its desktop screenshots, and the workspace files it saves
    // become the only record of what the agent saw.
    let visionSupported = true;
    // The model sees the attachment note; the persisted user bubble keeps the
    // clean text the user actually typed (Telegram concatenates its note into
    // the text instead, which is fine there since the user turn is not shown).
    // `/ultraplan` adds its planning directive to the model's turn only - the
    // persisted user bubble keeps the clean command the user typed.
    const modelInput = goal
      ? `${content}\n\n${buildGoalInstruction(goal.objective, options.channel, {
          segments: goal.segments,
          maxSegments: MAX_GOAL_SEGMENTS,
        })}`
      : ultraplan
        ? `${content}\n\n${buildUltraplanInstruction(ultraplan.task, options.channel)}`
        : resolvedMode.fromPlan
          ? `${content}\n\n${buildBuildModeInstruction(chatId, options.channel)}`
          : content;
    const modelContent = options.uploadContext
      ? `${modelInput}${options.uploadContext}`
      : modelInput;
    const currentTurn: GatewayChatMessage = {
      role: "user",
      content: visionActive
        ? [
            { type: "text" as const, text: modelContent },
            ...imageParts.map(uri => ({
              type: "image_url" as const,
              image_url: { url: uri },
            })),
          ]
        : modelInput,
    };
    /**
     * Give the model the conversation so far. Without this, every incoming
     * message started a brand-new chat from the model's point of view - no
     * memory of anything said a moment earlier, only whatever it could infer
     * by re-reading the workspace. The current turn's user message was
     * already persisted above, so history already ends with it as the last
     * row; that last row is swapped out below for the vision-aware version
     * when images are attached. Tool-activity rows are internal bookkeeping
     * (raw JSON, re-emitted per state change) and are never real turns, so
     * they're filtered out; the count is capped so very long chats don't
     * blow the model's context window.
     */
    const MAX_HISTORY_MESSAGES = 60;
    // A run also persists the narration it writes before each tool call, so a
    // settled turn can be several assistant rows in a row ("let me check" then
    // the reply). Merge consecutive same-role rows back into one turn: the
    // gateway validates role alternation and rejects two assistant messages
    // back to back, and joined they read as the single reply they were.
    const historyTurns: GatewayChatMessage[] = [];
    for (const message of priorMessages
      .filter(
        m =>
          !m.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX) &&
          !m.content.startsWith(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX) &&
          !m.content.startsWith(AGENT_MODE_MESSAGE_PREFIX) &&
          !m.content.startsWith(FOLLOW_UP_MESSAGE_PREFIX) &&
          !m.content.startsWith(GOAL_MESSAGE_PREFIX)
      )
      .slice(-MAX_HISTORY_MESSAGES)) {
      const turn: GatewayChatMessage = {
        role: message.role as "user" | "assistant",
        content: message.content,
      };
      const previous = historyTurns[historyTurns.length - 1];
      if (previous && previous.role === turn.role)
        previous.content = `${previous.content}\n\n${turn.content}`;
      else historyTurns.push(turn);
    }
    // On a team hand-off turn the user's message is NOT the last persisted
    // row (a teammate's reply is), so the internal note is added as its own
    // model-visible turn instead of overwriting history; role alternation is
    // kept by folding it into a trailing user row when one exists.
    // A caller that passed `persistedUserMessage` did write this turn's row
    // itself - an inbound email writes the mail - so history ends with this
    // turn and the model-facing version replaces it. Appending there would
    // send the same content twice: the mail row, plus a prompt that already
    // carries that mail.
    if (
      historyTurns.length &&
      (options.persistUserMessage !== false ||
        options.persistedUserMessage !== undefined)
    )
      historyTurns[historyTurns.length - 1] = currentTurn;
    else if (
      historyTurns.length &&
      historyTurns[historyTurns.length - 1].role === "user" &&
      typeof currentTurn.content === "string"
    ) {
      const lastTurn = historyTurns[historyTurns.length - 1];
      lastTurn.content = `${lastTurn.content}\n\n${currentTurn.content}`;
    } else historyTurns.push(currentTurn);
    const messages: GatewayChatMessage[] = [systemMessage(), ...historyTurns];

    /**
     * Goal-chase state for this run. `goalOutcome` is set once the model says
     * how the chase ended (through report_goal) - until then an end_turn is a
     * round report, and the chase continues. `goalContinuations` counts how
     * many times this run has been sent back to work, which is what bounds a
     * model that keeps trying to stop.
     */
    let goalOutcome: GoalOutcome | null = null;
    let goalContinuations = 0;
    const handledGoalOutcomes = new Set<string>();

    // /stop support: a stop request recorded after the run started aborts the
    // run at the next safe point (round boundary or between tool calls).
    const runStartedAt = await getDatabaseTime();
    const stopRun = async () => {
      const stoppedReply =
        "⏹️ Stopped - this run was cancelled at your request.";
      // Stopping ends the chase, not just this run: recording the goal as
      // unfinished keeps the user's next message from silently resuming work
      // they just cancelled.
      if (goalRun && goal && !goalOutcome)
        await recordGoalState(ownerId, chatId, {
          ...goal,
          status: "unfinished",
        });
      await options.onChunk?.(stoppedReply);
      const message = await persistAssistant(stoppedReply);
      return { message, actions: [], outOfBudget: false };
    };

    // /stop must be able to end a run mid-response, not only between rounds:
    // the chunk stream is polled for stop requests and aborts the in-flight
    // completion so a long reply stops almost immediately.
    // A stop served by this instance is answered from memory; anything else is
    // left to the database poll.
    const stopRequested = async () =>
      hasLocalAgentStopAfter(ownerId, chatId, runStartedAt) ||
      hasAgentStopAfter(ownerId, chatId, runStartedAt).catch(() => false);

    const stopController = new AbortController();
    let lastStopCheckMs = 0;
    let lastStopDbCheckMs = 0;
    const checkStopMidStream = () => {
      if (stopController.signal.aborted) return;
      const now = Date.now();
      if (hasLocalAgentStopAfter(ownerId, chatId, runStartedAt)) {
        stopController.abort();
        return;
      }
      if (now - lastStopCheckMs < 250) return;
      lastStopCheckMs = now;
      if (now - lastStopDbCheckMs < STOP_DB_POLL_MS) return;
      lastStopDbCheckMs = now;
      void hasAgentStopAfter(ownerId, chatId, runStartedAt)
        .then(stop => {
          if (stop) stopController.abort();
        })
        .catch(() => {});
    };

    let reply = "";
    let streamedReplyChars = 0;
    let recoveredCallCount = 0;
    // The follow_up tool's accepted suggestions for this run - the latest
    // call wins. They are persisted beneath the closing reply further down
    // as an internal ledger row the web client renders as tappable chips.
    let suggestedFollowUps: string[] = [];
    // The web sources this run consulted (research reports, pages opened with
    // browse), collected as the tools run and rendered as one citation list
    // at the bottom of the reply delivered below.
    const citations = new RunCitations();
    // Coder-delegation guard: one nudge per run when the agent writes
    // substantial code itself without ever calling the editor.
    let codeTaskUsed = false;
    let coderNudgeSent = false;
    let specialistDown = false;
    let coderNudgePending = false;
    let coderNudgeFile = "";
    // Specialist-down self-coding gate: a run that ends with the editor down
    // leaves a pending acceptance marker; until the user accepts in a LATER
    // turn (recorded via accept_own_coding), non-trivial create_file and
    // edit_file calls are blocked by the tool executor itself.
    const ownCodingGate: OwnCodingGate = {
      chatId,
      blocked: false,
      awaitingAcceptance: false,
      specialistDownThisRun: false,
    };
    const priorAcceptance = await readSpecialistAcceptance(ownerId, chatId);
    if (priorAcceptance === "pending") {
      ownCodingGate.blocked = true;
      ownCodingGate.awaitingAcceptance = true;
    }
    // Set when a tool call outlasts the deadline mid-round: the round loop
    // must stop without refreshing state or starting another gateway round.
    let closedByDeadline = false;
    // follow_up call ids already processed this run: end_turn breaks the call
    // loop, and the scan after it re-walks the round's calls, so a call must
    // never be recorded twice.
    const handledFollowUps = new Set<string>();
    /**
     * Handles a follow_up call: normalizes the proposed next actions and
     * stores them to be persisted under the closing reply. Like end_turn it
     * is a local control call - no side effects and no budget cost. A call
     * with nothing usable is answered with a correction instead of storing
     * an empty list, and the latest usable call of the run wins.
     */
    const recordFollowUps = async (call: GatewayToolCall) => {
      if (call.name !== "follow_up" || handledFollowUps.has(call.id)) return;
      handledFollowUps.add(call.id);
      let followUps: string[] = [];
      try {
        const parsed = JSON.parse(call.arguments || "{}") as {
          follow_ups?: unknown;
        };
        followUps = normalizeFollowUps(parsed?.follow_ups);
      } catch {
        // Malformed arguments propose nothing.
      }
      if (!followUps.length) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            "No follow-up suggestions were stored from this call: follow_ups was empty or unusable. Call follow_up again with one to three short next actions, or skip it and finish with end_turn.",
        });
        return;
      }
      suggestedFollowUps = followUps;
      await emitTool({
        id: call.id,
        name: call.name,
        state: "completed",
        args: { arguments: call.arguments.slice(0, 500) },
        summary: `Suggested ${followUps.length} follow-up${
          followUps.length === 1 ? "" : "s"
        } for the user to tap.`,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `Stored these follow-up suggestions to show as tappable buttons under your reply: ${followUps.join(
          "; "
        )}. Do not list them again in your end_turn reply.`,
      });
    };
    /**
     * Records how a goal chase ended. Like follow_up and end_turn it is a local
     * control call - no side effects in the workspace and no budget cost - and
     * the round is scanned for it before the calls are dispatched, so the order
     * the model wrote it in relative to end_turn cannot decide whether the
     * chase closes. The ledger row it writes is what stops the next run from
     * picking the goal back up.
     */
    const recordGoalOutcome = async (call: GatewayToolCall) => {
      if (
        !goalRun ||
        !goal ||
        call.name !== REPORT_GOAL_TOOL ||
        handledGoalOutcomes.has(call.id)
      )
        return;
      handledGoalOutcomes.add(call.id);
      let outcome: GoalOutcome = "blocked";
      let detail = "";
      try {
        const parsed = JSON.parse(call.arguments || "{}") as {
          outcome?: unknown;
          detail?: unknown;
        };
        if (parsed?.outcome === "met") outcome = "met";
        if (typeof parsed?.detail === "string") detail = parsed.detail.trim();
      } catch {
        // Malformed arguments end the chase as blocked: the model did not give
        // usable evidence that the goal was reached.
      }
      goalOutcome = outcome;
      await recordGoalState(ownerId, chatId, {
        ...goal,
        status: outcome === "met" ? "met" : "unfinished",
      });
      await emitTool({
        id: call.id,
        name: call.name,
        state: "completed",
        args: { arguments: call.arguments.slice(0, 500) },
        summary:
          outcome === "met"
            ? `Goal met${detail ? `: ${detail}` : "."}`
            : `Goal could not be finished unaided${detail ? `: ${detail}` : "."}`,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content:
          outcome === "met"
            ? "Recorded: the goal is met and the chase is over. Finish with end_turn and your final report."
            : "Recorded: the chase is over and the user will be told you are blocked. Finish with end_turn and say plainly what you need from them.",
      });
    };
    for (let round = 0; ; round += 1) {
      if (round > 0 && (await stopRequested())) return stopRun();
      // A deploy or long research can consume nearly the whole request
      // budget. Starting another gateway round this close to the maxDuration
      // limit risks the function being killed before the reply persists -
      // close the run with a model-written status instead.
      if (
        round > 0 &&
        Date.now() + FINAL_ROUND_MIN_REMAINING_MS > deadlineAtMs
      ) {
        reply = await composeDeadlineClose();
        streamedReplyChars = 0;
        // The run stops because a follow-up round would not fit - the task is
        // unfinished (the model never called end_turn), not complete. Mark it
        // out of budget so the runner chains the continuation the closing
        // status promises; without this the run closed as "completed" and the
        // work silently stopped here instead of resuming in a fresh segment.
        closedByDeadline = true;
        break;
      }
      let streamedThisRound = 0;
      // The desktop captures this round's browse calls took, attached to the
      // model's next round as vision input.
      const screenshotsThisRound: DesktopCapture[] = [];
      const emitChunk = options.onChunk
        ? (chunk: string) => {
            streamedThisRound += chunk.length;
            streamedRunText += chunk;
            options.onChunk?.(chunk);
            checkStopMidStream();
          }
        : undefined;
      let result: Awaited<ReturnType<typeof chatWithGatewayRetry>>;
      // This round's thinking block: reasoning-capable models stream their
      // private reasoning (reasoning_content) before the answer or tool
      // calls. It surfaces live as a collapsible "Thinking" block via the
      // tool-activity pipeline (persisted like any activity, so a page
      // reload replays it), and closes when the round settles.
      let reasoningThisRound = "";
      let reasoningEmittedChars = 0;
      let reasoningLastEmitAt = 0;
      // Serialize the emissions for this round's thinking block: each update
      // chains after the previous one, so a slow "running" persist can never
      // land after the final "completed" state and regress the activity.
      let thinkingEmissions: Promise<unknown> = Promise.resolve();
      const flushThinking = (state: "running" | "completed") => {
        if (!reasoningThisRound) return;
        if (state === "running") {
          const now = Date.now();
          if (
            now - reasoningLastEmitAt < THINKING_EMIT_INTERVAL_MS ||
            reasoningThisRound.length - reasoningEmittedChars <
              THINKING_MIN_DELTA_CHARS
          )
            return;
          reasoningLastEmitAt = now;
        }
        reasoningEmittedChars = reasoningThisRound.length;
        thinkingEmissions = thinkingEmissions.then(() =>
          emitTool({
            id: `thinking-${round}`,
            name: "thinking",
            state,
            args: {},
            detail: reasoningThisRound.slice(0, THINKING_DETAIL_LIMIT),
            ...(state === "completed"
              ? { summary: "The model's thinking for this step." }
              : {}),
          })
        );
      };
      const onReasoning = (chunk: string) => {
        reasoningThisRound += chunk;
        flushThinking("running");
        // Thinking is streamed generation too: poll here as well, so a stop
        // pressed during a long reasoning phase ends it just as promptly as
        // one pressed mid-reply.
        checkStopMidStream();
      };
      const runChatRound = () =>
        chatWithGatewayRetry(ownerId, messages, {
          tools: agentTools,
          ...(emitChunk ? { onChunk: emitChunk } : {}),
          onReasoning,
          signal: stopController.signal,
          deadlineAtMs,
          retryState,
          ...(visionActive ? { visionActive: true } : {}),
          // The route was resolved once before the loop: rounds and retries
          // reuse it instead of hitting the database again.
          customModel,
          // The chat's selected model; the gateway gates premium ids on the
          // owner's plan and maps them to their upstream model id.
          ...(chatModel ? { model: chatModel } : {}),
        });
      // Rounds after the first are raced against the deadline: a slow LLM
      // round can take up to the client's own 120s timeout, which used to
      // run past the budget between the round-level checks until Vercel
      // killed the whole task with no reply. Round 0 is bounded by the
      // gateway client's own request timeouts and may still need to run
      // with a nearly-expired budget so its tool calls can be skipped and
      // reported rather than vanishing.
      try {
        // Round 0 with the budget already gone still runs directly so its
        // tool calls can be reported as skipped; otherwise every round is
        // raced, bounding slow or retrying gateway rounds by the deadline.
        result =
          round === 0 && deadlineAtMs - Date.now() <= 0
            ? await runChatRound()
            : await raceToolDeadline(runChatRound, deadlineAtMs);
      } catch (error) {
        if (error instanceof RunDeadlineExceeded) {
          flushThinking("completed");
          await thinkingEmissions;
          reply = await composeDeadlineClose();
          streamedReplyChars = 0;
          closedByDeadline = true;
          break;
        }
        if (stopController.signal.aborted && (await stopRequested())) {
          flushThinking("completed");
          await thinkingEmissions;
          return stopRun();
        }
        if (!visionActive) {
          // A terminal gateway error must not leave the thinking block
          // stuck in its running state.
          flushThinking("completed");
          await thinkingEmissions;
          modelCallFailed = true;
          throw error;
        }
        // A model without vision rejects image parts outright: drop the
        // attachment instead of failing the run, and let the model say so.
        // Nothing more may be attached for the rest of the run either - a
        // browse screenshot the model cannot read would just fail every
        // later round the same way.
        visionActive = false;
        visionSupported = false;
        // The message carrying the images is not necessarily messages[1] any
        // more - prior chat history adds earlier "user" rows, and a browse
        // capture rides in as a user turn of its own - so target the *last*
        // user turn that actually has content parts. Rewriting a plain text
        // turn here would throw away a nudge instead of an image.
        const userIndex = messages.findLastIndex(
          m => m.role === "user" && Array.isArray(m.content)
        );
        if (userIndex >= 0) {
          const parts = messages[userIndex]
            .content as GatewayChatMessageContentPart[];
          const text = parts
            .filter(part => part.type === "text")
            .map(part => part.text)
            .join("\n\n");
          messages[userIndex] = {
            role: "user",
            content: `${text || modelContent}\n\n⚠️ (This model cannot view image attachments, so the uploaded image is not visible here - it is still saved in the workspace. Say so plainly and work from what the user says.)`,
          };
        }
        try {
          result =
            round === 0 && deadlineAtMs - Date.now() <= 0
              ? await runChatRound()
              : await raceToolDeadline(runChatRound, deadlineAtMs);
        } catch (error) {
          if (error instanceof RunDeadlineExceeded) {
            flushThinking("completed");
            await thinkingEmissions;
            reply = await composeDeadlineClose();
            streamedReplyChars = 0;
            closedByDeadline = true;
            break;
          }
          modelCallFailed = true;
          throw error;
        }
      }
      // Drain the queue before the round's tool calls or reply so the
      // settled thinking block is persisted before anything follows it.
      flushThinking("completed");
      await thinkingEmissions;
      // Recover a tool call the model wrote out as text: run it as a real
      // call so the action executes instead of dumping raw JSON on the user.
      const recoveredCall =
        result.toolCalls.length === 0 && recoveredCallCount < 2
          ? toolCallWrittenAsText(result.text, agentTools)
          : undefined;
      if (recoveredCall) {
        recoveredCallCount += 1;
        console.info(
          "[Workspace agent] recovered a tool call written as text:",
          recoveredCall.name
        );
      }
      if (result.toolCalls.length === 0 && !recoveredCall) {
        // A plain reply does NOT end the run - only end_turn does. Keep the
        // text as the running draft (it may still become the final reply if
        // the model ends without one) and nudge the model to either finish
        // explicitly or keep working.
        reply = result.text || "";
        streamedReplyChars = streamedThisRound;
        draftReply = result.text || "";
        draftStreamedChars = streamedThisRound;
        messages.push({ role: "assistant", content: result.text || null });
        messages.push({
          role: "user",
          content: `${END_TURN_NUDGE_PREFIX} Your turn has not ended: a plain reply does not finish this run. If the user's request is fully complete, call end_turn now with your complete final reply in the 'reply' argument. Otherwise continue the work with your next tool call - do not repeat your previous answer.`,
        });
        continue;
      }
      const calls =
        result.toolCalls.length > 0
          ? result.toolCalls
          : [
              {
                id: `recovered-${Date.now()}`,
                name: recoveredCall!.name,
                arguments: recoveredCall!.arguments,
              },
            ];
      messages.push({
        role: "assistant",
        content: result.text || null,
        tool_calls: calls.map(call => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      lastRoundSummaries = [];
      // Keep the ledger in the order the user watched: the line that announced
      // the tools, then the tools themselves. A round that ends the turn
      // (end_turn) persists its text as the turn's reply further down, and a
      // recovered call is the model's malformed JSON rather than chat text -
      // neither of those is narration.
      if (
        !calls.some(call => call.name === "end_turn") &&
        !recoveredCall &&
        result.text.trim()
      )
        await persistRoundText(result.text);
      // report_goal may be written before or after end_turn in the same round,
      // and the end_turn branch below breaks the call loop - so the round is
      // scanned for it first, and the order the model wrote the two calls in
      // cannot decide whether the chase closes.
      for (const call of calls) await recordGoalOutcome(call);
      for (const call of calls) {
        // The explicit end of the turn. It is a local control call - no side
        // effects, no budget cost - so it is honored even when the run
        // budget is gone; blocking it would lose the reply the model already
        // wrote. The final reply prefers the explicit 'reply' argument, then
        // the text of this round, then the last text-only draft.
        if (call.name === "end_turn") {
          let endTurnReply = "";
          try {
            const parsed = JSON.parse(call.arguments || "{}") as {
              reply?: unknown;
            };
            if (typeof parsed?.reply === "string")
              endTurnReply = parsed.reply.trim();
          } catch {
            // Malformed arguments fall through to the streamed/draft text.
          }
          const roundText = (result.text || "").trim();
          if (endTurnReply) {
            reply = endTurnReply;
            // The explicit reply may restate text that already streamed
            // token-by-token (the draft the model echoed into end_turn) -
            // re-emitting it would duplicate what the user watched appear.
            streamedReplyChars = streamedRunText.endsWith(endTurnReply)
              ? endTurnReply.length
              : 0;
          } else if (roundText) {
            reply = roundText;
            streamedReplyChars = streamedThisRound;
          } else if (draftReply) {
            reply = draftReply;
            streamedReplyChars = draftStreamedChars;
          } else {
            reply = "";
            streamedReplyChars = 0;
          }
          // A goal chase does not end on end_turn. Until the model reports a
          // goal outcome, this round's text is a progress report: it is
          // persisted as its own message - the user follows a long chase round
          // by round - and the run goes back to work instead of stopping.
          if (goalRun && !goalOutcome && goalContinuations < MAX_GOAL_CONTINUATIONS) {
            goalContinuations += 1;
            if (reply.trim()) await persistRoundText(reply);
            reply = "";
            streamedReplyChars = 0;
            draftReply = "";
            draftStreamedChars = 0;
            messages.push({
              role: "user",
              content: buildGoalContinuationPrompt(goal?.objective ?? ""),
            });
            break;
          }
          endTurnCalled = true;
          break;
        }
        // The model proposes the next actions to show under its reply. A
        // local control call like end_turn: no side effects and no budget
        // cost, so it is honored even when the run budget is gone.
        if (call.name === "follow_up") {
          await recordFollowUps(call);
          continue;
        }
        // report_goal was handled by the round's pre-scan, which runs before
        // this dispatch so the tool still counts when the model wrote it after
        // end_turn. Only the not-a-goal-run correction is left for here.
        if (call.name === REPORT_GOAL_TOOL) {
          if (!goalRun)
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: `${REPORT_GOAL_TOOL} is only available while this conversation is chasing a goal.`,
            });
          continue;
        }
        // The chat-mode model hands an action request over to planning. This is
        // a local control call like end_turn: no side effects and no budget
        // cost. It records the task, flips the rest of this run into planning
        // mode (the strict /ultraplan allowlist plus the plan-writing tools),
        // and tells the model to draft the plan; the user's reply to that plan
        // enters build on a later turn.
        if (call.name === START_PLANNING_TOOL) {
          let plannedTask = "";
          try {
            const parsed = JSON.parse(call.arguments || "{}") as {
              task?: unknown;
            };
            if (typeof parsed?.task === "string") plannedTask = parsed.task.trim();
          } catch {
            // Malformed arguments fall back to an empty task; the planning
            // instruction then still plans from the conversation.
          }
          if (modesEnabled && agentMode === "chat") {
            agentMode = "plan";
            agentTools = toolsForMode();
            await recordAgentMode(ownerId, chatId, "plan");
            await emitTool({
              id: call.id,
              name: call.name,
              state: "completed",
              args: { arguments: call.arguments.slice(0, 500) },
              summary:
                "Switching to planning mode to research the task and draft a plan.",
            });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content:
                "Planning mode is now active. Research the task with the read-only tools you now have and draft the plan with create_plan.",
            });
            messages.push({
              role: "user",
              content: buildUltraplanInstruction(plannedTask, options.channel, {
                auto: true,
              }),
            });
            continue;
          }
          // Defensive: the tool only exists in chat mode, but never leave a
          // tool call unanswered if it somehow arrives elsewhere.
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `${START_PLANNING_TOOL} is only available in chat mode.`,
          });
          continue;
        }
        if (await stopRequested()) return stopRun();
        // The budget is already gone: starting the call would begin its side
        // effects (a file write, a deploy) after the run has effectively
        // ended. Skip it, record why, and close the run instead.
        if (Date.now() >= deadlineAtMs) {
          const skipped = `${call.name} was skipped because the request budget ran out before it could start.`;
          await emitTool({
            id: call.id,
            name: call.name,
            state: "failed",
            args: { arguments: call.arguments.slice(0, 500) },
            summary: skipped,
          });
          reply = await composeDeadlineClose(call.name, false);
          streamedReplyChars = 0;
          closedByDeadline = true;
          break;
        }
        // A third identical failing call is the model stuck in a loop, not
        // recovery: the identical call is guaranteed to fail the same way,
        // burning rounds (and, in the screenshot case, the whole run budget)
        // without moving the task forward. Refuse to execute it and hand
        // back the original failure text so the model either changes the
        // call to address the actual cause or ends the turn and tells the
        // user what failed.
        const attemptKey = `${call.name}:${call.arguments.slice(0, 2000)}`;
        const priorAttempt = failedAttempts.get(attemptKey);
        if (priorAttempt !== undefined && priorAttempt.count >= 2) {
          const refusal =
            `${REPEATED_FAILURE_PREFIX} This exact ${call.name} call has already failed twice in this run: ${priorAttempt.firstFailure} ` +
            `Repeating the identical call cannot change the outcome. Diagnose the actual cause from that failure text, change the call accordingly, or call end_turn now and tell the user plainly what failed, why, and what was completed.`;
          await emitTool({
            id: call.id,
            name: call.name,
            state: "failed",
            args: { arguments: call.arguments.slice(0, 500) },
            summary:
              "Refused: this identical call already failed twice in this run.",
          });
          lastRoundSummaries.push(
            `Failed: ${call.name} - refused, the identical call already failed twice.`
          );
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: refusal,
          });
          continue;
        }
        await emitTool({
          id: call.id,
          name: call.name,
          state: "running",
          args: { arguments: call.arguments.slice(0, 500) },
        });
        let execution: ToolExecution;
        try {
          execution = await raceToolDeadline(async () => {
            // The wake has been running in parallel since the run started:
            // wait for it only now, when a tool actually needs the live
            // filesystem, so a slow E2B boot never delays the reply. A
            // failed wake resolves to undefined and the tool degrades to
            // direct database execution.
            const sandbox = await sandboxWake;
            return executeWorkspaceTool(
              ownerId,
              computer,
              call,
              detail => {
                // Progress updates stream live to the open chat only - they are
                // not persisted, so long research runs don't flood the archive.
                Promise.resolve(
                  options.onEvent?.({
                    type: "tool",
                    tool: {
                      id: call.id,
                      name: call.name,
                      state: "running",
                      args: { arguments: call.arguments.slice(0, 500) },
                      detail,
                    },
                  })
                ).catch(() => {});
              },
              sandbox,
              ownCodingGate,
              options.channel,
              deadlineAtMs,
              chatId,
              // The editor specialist's own tool calls stream as real
              // activity rows: emitted live to the open chat AND persisted
              // through emitTool, so they read back from the ledger exactly
              // like the agent's own tool calls.
              subTool => emitTool(subTool),
              options.agentChat
            );
          }, deadlineAtMs);
        } catch (error) {
          if (error instanceof RunDeadlineExceeded) {
            // A VM task or deploy outlasted the request budget between the
            // round-level checks: stop waiting, record the interruption, and
            // close the run so the reply persists inside the remaining
            // maxDuration margin. The interrupted step is reported as
            // unfinished, not counted among the completed summaries.
            await emitTool({
              id: call.id,
              name: call.name,
              state: "failed",
              args: { arguments: call.arguments.slice(0, 500) },
              summary: `${call.name} was still running when the request budget ran out and was interrupted mid-flight.`,
            });
            reply = await composeDeadlineClose(call.name, true);
            streamedReplyChars = 0;
            closedByDeadline = true;
            break;
          }
          console.error("[Workspace tool] failed", call.name, error);
          // Say what actually failed - the real error with its cause chain,
          // not a canned line - capped at 500 chars like inference errors so
          // a runaway error body cannot flood the context.
          const failureDetail = errorChainText(error) || String(error);
          execution = {
            ok: false,
            result: `The tool call failed unexpectedly: ${
              failureDetail.length > 500
                ? `${failureDetail.slice(0, 500)}…`
                : failureDetail
            }`,
          };
        }
        // Remember the web sources this call consulted so the reply can list
        // them at the bottom - the research report's own source list and the
        // page a browse call opened both count, failed calls do not.
        citations.record(call.name, call.arguments, execution);
        if (execution.action) actions.push(execution.action);
        lastRoundSummaries.push(toolSummary(call, execution));
        if (!execution.ok) {
          const failureText =
            execution.result.length > 240
              ? `${execution.result.slice(0, 240)}…`
              : execution.result;
          failedSteps.push(`${call.name} - ${failureText}`);
          const attempt = failedAttempts.get(attemptKey);
          if (attempt) attempt.count += 1;
          else
            failedAttempts.set(attemptKey, {
              count: 1,
              firstFailure: failureText,
            });
        }
        await emitTool({
          id: call.id,
          name: call.name,
          state: execution.ok ? "completed" : "failed",
          args: { arguments: call.arguments.slice(0, 500) },
          summary: toolSummary(call, execution),
          ...(execution.detail
            ? { detail: execution.detail.slice(0, 16000) }
            : {}),
          ...(execution.diff ? { diff: execution.diff } : {}),
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: execution.result,
        });
        if (execution.screenshot) screenshotsThisRound.push(execution.screenshot);
        // Coder-delegation guard: remember specialist use, and flag a round
        // where the agent wrote substantial code itself without it. The
        // nudge is queued and delivered once, after the round's tool
        // results, so it never breaks the tool-call message chain.
        if (execution.specialistDown) {
          specialistDown = true;
          ownCodingGate.specialistDownThisRun = true;
          ownCodingGate.blocked = true;
          ownCodingGate.awaitingAcceptance = false;
        }
        if (call.name === "editor") {
          codeTaskUsed = true;
          coderNudgePending = false;
          // A working specialist clears any lingering acceptance question:
          // self-coding rules return to the normal mandatory-delegation mode.
          if (
            execution.ok &&
            (ownCodingGate.awaitingAcceptance || priorAcceptance !== "none")
          ) {
            ownCodingGate.awaitingAcceptance = false;
            ownCodingGate.blocked = false;
            ownCodingGate.specialistDownThisRun = false;
            specialistDown = false;
            await recordSpecialistAcceptance(ownerId, chatId, "cleared");
          }
        }
        if (call.name === "accept_own_coding" && execution.ok) {
          codeTaskUsed = true;
        } else if (
          execution.ok &&
          !codeTaskUsed &&
          !coderNudgeSent &&
          !coderNudgePending &&
          (call.name === "create_file" || call.name === "edit_file") &&
          typeof execution.action?.name === "string"
        ) {
          let written = "";
          try {
            const parsed = JSON.parse(call.arguments || "{}") as {
              content?: unknown;
            };
            if (typeof parsed?.content === "string") written = parsed.content;
          } catch {
            // Malformed arguments: no nudge, the tool already reported it.
          }
          if (
            isCodeFileName(execution.action.name) &&
            isSubstantialCode(written)
          ) {
            coderNudgePending = true;
            coderNudgeFile = execution.action.name;
          }
        }
      }
      // end_turn breaks the call loop above, so a follow_up call the model
      // wrote after it in the same round never reached its branch. Re-walk
      // the round's calls so the order the model wrote them in cannot decide
      // whether the suggestions appear (handled calls are skipped inside).
      if (endTurnCalled)
        for (const call of calls) await recordFollowUps(call);
      // Coder-delegation guard: deliver the queued nudge once, only when the
      // run is continuing anyway - never on the closing or end_turn exits.
      // With the specialist confirmed down, self-coding is disclosed
      // degraded mode - nudging back toward the editor would be noise.
      if (
        coderNudgePending &&
        !closedByDeadline &&
        !endTurnCalled &&
        !specialistDown
      ) {
        coderNudgePending = false;
        coderNudgeSent = true;
        messages.push({ role: "user", content: coderNudgeFor(coderNudgeFile) });
      }
      // Failure disclosure: one nudge per run, queued the first time a
      // round's tool calls fail and delivered after the round's results
      // (never on the closing or end_turn exits, where the reply is already
      // final and the error-path note below carries the failures instead).
      if (
        failedSteps.length > 0 &&
        !failureNudgeSent &&
        !closedByDeadline &&
        !endTurnCalled
      ) {
        failureNudgeSent = true;
        messages.push({ role: "user", content: failureNudgeFor(failedSteps) });
      }
      // The browse tool's desktop screenshot. A GUI agent steers by looking,
      // so the freshest capture of the round rides back as vision input - and
      // only the freshest one, since it is the current state of the screen and
      // a round that browsed repeatedly would otherwise pay for every
      // intermediate frame. Never on the closing or end_turn exits, where no
      // further round will read it.
      if (
        screenshotsThisRound.length > 0 &&
        visionSupported &&
        !closedByDeadline &&
        !endTurnCalled
      ) {
        const latest = screenshotsThisRound[screenshotsThisRound.length - 1];
        messages.push({
          role: "user",
          content: [
            {
              type: "text" as const,
              text: "Screenshot of the browser desktop, taken right after your last browse command: this is the screen as it is now. Read the positions you need off it for your next click, scroll or keypress, and tell the user in words what the page shows - they cannot see this image.",
            },
            { type: "image_url" as const, image_url: { url: latest.dataUri } },
          ],
        });
        visionActive = true;
      }
      // The deadline hit mid-tool: the closing reply is already set - leave
      // the round loop without refreshing state or starting a new round.
      if (closedByDeadline) break;
      // The model explicitly ended its turn: the reply is final - persist it
      // without refreshing state or starting another round.
      if (endTurnCalled) break;
      // Refresh workspace state so later rounds resolve names/ids created
      // or removed by this round's tools.
      computer = await getWorkspaceComputer(ownerId);
      messages[0] = systemMessage();
    }

    if (specialistDown) {
      // The run ends with the acceptance question the model asked: mark the
      // chat pending so the NEXT user turn can accept (and only that turn,
      // via accept_own_coding, unlocks Nova's own coding).
      await recordSpecialistAcceptance(ownerId, chatId, "pending");
    }
    // Citations sit at the bottom of the message the reader gets: every web
    // source this run consulted that the reply does not already link. It is
    // appended here - after the run has settled - so every way a run can end
    // (end_turn, a deadline close) delivers the same list, and a reply with
    // nothing cited stays exactly as the model wrote it.
    const citationBlock = reply.trim()
      ? citations.block(reply, citationStyleFor(options.channel))
      : "";
    if (citationBlock) reply += citationBlock;
    // A run that closes with no visible reply text no longer gets the canned
    // "I could not complete that request" notice. It repeated on every
    // textless close even though a failed step already gets its own retry
    // nudge inside the model's context (failureNudgeFor above), so the line
    // was noise rather than information. Nothing is streamed and nothing is
    // persisted now - the tool rows that ran still show what happened - and
    // every caller already treats a missing reply as "no text": the web
    // client polls the ledger, Telegram sends nothing either (its own canned
    // empty-reply note is gone too), an automation run reports no report,
    // and auto-title skips the chat.
    const hasReply = Boolean(reply.trim());
    // The reply already streamed to the client token-by-token: re-sending the
    // full text would duplicate what the user watched appear. Only the
    // citation block is new in that case, so that is all that gets sent.
    if (hasReply && streamedReplyChars === 0) await options.onChunk?.(reply);
    else if (hasReply && citationBlock && streamedReplyChars > 0)
      await options.onChunk?.(citationBlock);
    const message = hasReply ? await persistAssistant(reply) : undefined;
    // The turn's follow-up suggestions ride directly beneath the reply they
    // belong to as an internal ledger row the web client renders as tappable
    // chips. A deadline close is not a settled turn - the continuation runs
    // next - so its suggestions are dropped with the closing status. A
    // persistence failure must not break the run: the reply is already saved.
    if (hasReply && !closedByDeadline && suggestedFollowUps.length > 0) {
      try {
        await appendChatMessageForUser(ownerId, {
          chatId,
          role: "assistant",
          content: buildFollowUpMessage(suggestedFollowUps),
        });
      } catch (error) {
        console.error("[Chat] failed to persist follow-up suggestions", error);
      }
    }
    // Preparing the next turn: after a settled run that actually changed the
    // workspace (created/edited/renamed/moved/deleted files or folders), a
    // background subagent spins up with the /init prompt and keeps AGENTS.md
    // current so future sessions inherit the project's house rules. The user
    // sees only one `preparing_next_turn` activity run and settle. Awaited
    // before returning (see launchPreparingNextTurn) so the sandbox is kept
    // warm until the subagent has written.
    if (
      !closedByDeadline &&
      options.channel === "web" &&
      actions.some(
        (action: AgentAction) =>
          (action.kind === "file" || action.kind === "folder") &&
          action.name &&
          action.name !== "AGENTS.md"
      )
    ) {
      await launchPreparingNextTurn({
        ownerId,
        chatId,
        sandbox: await sandboxWake,
        workspaceId: sandboxWorkspaceId,
        deadlineAtMs,
        // The run's persisting emitter: the preparing_next_turn rows are
        // streamed AND appended to the chat ledger like every other tool
        // activity, so a page reload still shows them and a client that
        // loses the stream sees the settled state on its next poll.
        emitTool,
        onEvent: options.onEvent,
      });
    }
    return { message, actions, outOfBudget: closedByDeadline };
  } catch (error) {
    console.error("[Chat] AI gateway chat failed", error);
    // Record built-in Nova-model failures for the admin notification tab.
    // Only failures from the model call itself are logged: setup, database
    // and sandbox errors are not Nova-model failures. BYOK failures stay
    // with the workspace's own provider and are never logged, matching the
    // inference API and peak-queue paths.
    if (!byok && modelCallFailed) {
      void recordNovaApiError({ ownerId, error, isNovaModel: true }).catch(() => {});
    }
    const kind =
      error instanceof AiGatewayClientError ? error.kind : "unavailable";
    const failureNote =
      "\n\nNova lost the connection to its AI service before this reply finished. Everything so far is saved - send another message and I will continue from here.";
    // A run that dies mid-flight on an inference error must still disclose
    // the tool steps that failed before it died: without this, the error
    // reply read as "everything so far is saved" while the steps behind
    // "so far" had failed invisibly (e.g. the project scaffold that never
    // landed, followed by reads of files that could never exist).
    const failedStepsNote = failedSteps.length
      ? `\n\nSteps that failed during this run (not completed):\n${failedSteps
          .slice(-5)
          .map((step, index) => `${index + 1}. ${step}`)
          .join("\n")}`
      : "";
    // Every failure keeps an actionable, user-facing lead (each kind below
    // says what happened and what to do). On top of the lead, an
    // AiGatewayClientError IS the model's own error message - nova-pro's
    // provider error, the user's key, their quota, their model id - so it is
    // disclosed in full via modelFailureDetail below: the generic copy would
    // hide the one clue that explains the failure, and the same text is what
    // Telegram delivers (it renders this reply). Deployment-internal kinds
    // (a missing or rejected credential) and errors that did not come from
    // the model path (internal failures such as drizzle query wrappers) keep
    // the sanitized notice alone: they can expose Nova internals such as
    // database causes, config names and endpoints, which stay in the server
    // log the catch above already wrote.
    let reply: string;
    if (byok && error instanceof AiGatewayClientError) {
      const detail = redactModelCredentials(error.message.trim());
      reply = detail
        ? `Your provider returned an error: ${detail}`
        : AI_UNAVAILABLE_PREFIX + "Your provider could not be reached. Please try again shortly.";
    } else if (kind === "configuration") {
      reply =
        "Nova's AI is not connected on this workspace yet. An administrator must finish setting it up before chat is available.";
    } else if (kind === "allowance_reached") {
      reply =
        "Nova's shared request allowance has been reached. New requests are blocked until an administrator raises the cap.";
    } else if (kind === "credits_exhausted") {
      reply =
        "Your daily Nova credits are used up (1 credit = 1¢). They reset tomorrow; everything so far is saved.";
    } else if (kind === "rate_limit") {
      reply =
        "Too many requests right now. Everything so far is saved - please try again in a little while.";
    } else if (kind === "client_error") {
      reply =
        "Nova's AI service rejected this request (for example an unsupported model or an oversized prompt). Retrying cannot fix that, so I stopped. Please adjust the request and try again; everything so far is saved.";
    } else {
      // A long tool-calling run often streams part of the reply to the client
      // (the Telegram placeholder, the web stream) before the gateway fails
      // mid-run. Keep what the user already watched instead of throwing it
      // away and replacing it with an error notice.
      const partial = streamedRunText.trim();
      if (partial) {
        reply = partial + failureNote;
      } else if (kind === "invalid_response") {
        reply =
          "Nova's AI service returned an invalid response. Please try again shortly.";
      } else {
        // Only a failure that never came from the model call lands here
        // without an error to disclose (a database cause, a sandbox
        // internal): it stays in the server log above and the chat gets a
        // fixed generic notice. An AiGatewayClientError still has its own
        // message appended below, after this lead.
        reply =
          AI_UNAVAILABLE_PREFIX +
          "Nova hit an unexpected error and could not finish this reply. Everything so far is saved - please try again shortly.";
      }
    }
    // Disclose the model's own error text next to the lead, in the reply the
    // user actually sees (web stream, chat ledger, Telegram). The BYOK branch
    // above already quoted its provider's error verbatim, so only the
    // built-in nova-pro path adds the detail here.
    const detailNote = byok
      ? ""
      : modelFailureDetail(error, reply, "nova-pro");
    if (detailNote) reply += detailNote;
    // Only emit what the client has not already seen streamed live.
    await options.onChunk?.(
      streamedRunText.trim()
        ? failureNote + detailNote
        : reply + failedStepsNote
    );
    const message = await persistAssistant(reply + failedStepsNote);
    return { message, actions, outOfBudget: false };
  } finally {
    // End of run, on every exit path (completed, stopped, deadline, error):
    // sync the live sandbox filesystem - files created or changed by bash,
    // VM tasks, or mirrored tool ops - back into the durable Neon/S3 store,
    // then pause the persistent machine so it is not billed while idle.
    // A run that ended before any tool needed the sandbox (a text-only
    // reply, an early stop) may still have the wake in flight: settle it
    // first so the machine lands in the same synced-and-paused state
    // instead of being left running.
    const sandbox = await sandboxWake;
    if (sandbox && sandboxWorkspaceId !== undefined) {
      await syncAgentSandbox(ownerId, sandboxWorkspaceId, sandbox);
      // A run chaining straight into its next segment resumes within seconds:
      // pausing it would add a cold resume to every continuation, so it is
      // left warm. Every other exit path pauses. The next run reconnects and
      // E2B auto-resumes the paused machine.
      if (!options.continuationPlanned)
        await pauseAgentSandbox(ownerId, sandboxWorkspaceId, sandbox);
    }
  }
}
