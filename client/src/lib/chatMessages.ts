// The internal-row markers are a byte-for-byte contract with the server's
// writers; both sides import the single definition in `@shared/const`.
import {
  CONTINUATION_PROMPT,
  TOOL_ACTIVITY_MESSAGE_PREFIX,
  SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX,
  AGENT_MODE_MESSAGE_PREFIX,
  FOLLOW_UP_MESSAGE_PREFIX,
  GOAL_MESSAGE_PREFIX,
  INTERNAL_MESSAGE_PREFIXES,
} from "@shared/const";
import { normalizeFollowUps } from "@shared/followUps";
import { latestAgentModeMarker } from "@shared/agentMode";

export {
  CONTINUATION_PROMPT,
  TOOL_ACTIVITY_MESSAGE_PREFIX,
  SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX,
  AGENT_MODE_MESSAGE_PREFIX,
  FOLLOW_UP_MESSAGE_PREFIX,
  GOAL_MESSAGE_PREFIX,
};

/** True for internal rows the UI must never show as chat bubbles. */
export const isInternalChatMessage = (content: string): boolean =>
  INTERNAL_MESSAGE_PREFIXES.some(prefix => content.startsWith(prefix));

/**
 * True for the automatic-continuation user turn the server persists when a
 * previous segment ran out of time. The user never typed it, so the chat
 * renders it as a resume divider - never as their bubble with copy/speak
 * actions, which read as if Nova was quoting its own instructions back.
 */
export const isContinuationPrompt = (content: string): boolean =>
  content.trim() === CONTINUATION_PROMPT;

type ChatRole = "user" | "assistant";
export type PersistedChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
  /**
   * When the row was written. The server ledger already carries it
   * (`chatMessages.createdAt`), so the thread can show a clock per message
   * with no schema change; older clients and test fixtures omit it.
   */
  createdAt?: string | Date | null;
};

/** Coerces a ledger timestamp (tRPC sends ISO strings) to a Date, or null. */
export function toMessageDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Short clock for a message header: "2:45 PM" today, "Mon 2:45 PM" within
 * the last week, "Mar 4, 2:45 PM" older. Null when the row has no usable
 * timestamp, so callers show no clock at all rather than a wrong one.
 */
export function formatMessageTime(
  value: unknown,
  now: Date = new Date()
): string | null {
  const date = toMessageDate(value);
  if (!date) return null;
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return formatClock(date);
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const ageMs = startOfToday.getTime() - date.getTime();
  if (ageMs >= 0 && ageMs < 7 * dayMs) {
    const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
    return `${weekday} ${formatClock(date)}`;
  }
  const label = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  return `${label}, ${formatClock(date)}`;
}

const formatClock = (date: Date): string =>
  date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * The plain-English turn label shown in the thread header: its number and
 * who it belongs to, so a long conversation reads as a numbered list of
 * turns instead of a wall of bubbles. `nova` labels the first assistant
 * step of a turn the same way - one header per turn covers both halves.
 */
export function turnLabel(turnNumber: number): string {
  return `turn ${turnNumber}`;
}

export type ChatWorkflowMode = "chat" | "plan" | "build";

/**
 * The workflow stage a conversation is in, derived from its persisted rows the
 * same way the server resolves it: the latest mode marker wins, a chat with no
 * marker and no assistant turn is new (chat mode), and any older conversation
 * without a marker is treated as build. Used to label the header badge.
 */
export function chatWorkflowMode(
  messages: PersistedChatMessage[]
): ChatWorkflowMode {
  const marker = latestAgentModeMarker(messages);
  if (marker) return marker;
  return messages.some(message => message.role === "assistant")
    ? "build"
    : "chat";
}

/**
 * Parses an internal follow-up row back into its suggestions; null when the
 * row is not a usable one. Shares the server's normalization core
 * (`@shared/followUps`); unlike the writer it only accepts the array form
 * the server persists, so a hand-edited bare string cannot render chips.
 */
export function parseFollowUpMessage(content: string): string[] | null {
  if (!content.startsWith(FOLLOW_UP_MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      content.slice(FOLLOW_UP_MESSAGE_PREFIX.length)
    ) as unknown;
    if (!Array.isArray(parsed)) return null;
    const followUps = normalizeFollowUps(parsed);
    return followUps.length ? followUps : null;
  } catch {
    return null;
  }
}

/**
 * The follow-up suggestions to show under the newest reply, or [] when there
 * are none. A marker row belongs to the reply written just above it, so the
 * walk starts at the end of the ledger: it skips the internal rows that can
 * land after the marker (the preparing-next-turn activity run), stops at the
 * first real message - the newest reply, or the user's next message - and
 * treats anything older as a previous turn. That is what makes chips go stale
 * the moment the reader replies, and keeps a reply that never offered
 * suggestions from borrowing the previous turn's.
 */
export function latestFollowUpSuggestions(
  messages: PersistedChatMessage[]
): string[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    // The user's next message invalidates the previous turn's chips no matter
    // what it says, even text that looks like an internal marker row.
    if (message.role === "user" || !isInternalChatMessage(message.content))
      return [];
    const followUps = parseFollowUpMessage(message.content);
    if (followUps) return followUps;
  }
  return [];
}

/** Who made a tool call: Nova itself, or the sub-agent it delegated to. */
export type ToolActivityOwner =
  | "nova"
  | "coding-specialist"
  | "research-agent"
  | "thinker-agent"
  | "vm-agent";

export type ToolActivity = {
  id: string;
  name: string;
  state: "running" | "completed" | "failed";
  args: Record<string, string>;
  summary?: string;
  /**
   * Who made the call. Persisted on every row the server writes now; rows
   * written before the field existed carry none and read as Nova's own
   * calls (which is how they were emitted).
   */
  owner?: ToolActivityOwner;
  /** When this row was written; read from the ledger row's createdAt. */
  createdAt?: string | Date | null;
  /** Live progress note while running, or the full tool response once done. */
  detail?: string;
  /**
   * Unified diff of what an edit_file call changed (before -> after), so the
   * edit's dropdown can show the actual change. Absent for tools that do not
   * rewrite a whole file.
   */
  diff?: string;
  /**
   * Live-only accumulation of every progress note a running tool streamed,
   * oldest first, so long-running sub-agents (research_web, editor) can
   * show their process as an append-only log. Never persisted: completed
   * activities drop it, and the server never stores it.
   */
  progressLog?: string[];
};

/**
 * Merges an incoming tool activity event into the current one: ordinary
 * fields overwrite, but a fresh progress note on a running tool is appended
 * to progressLog so the dropdown streams the process line by line instead
 * of replacing a single detail line. Final states (completed/failed) drop
 * the log - the finished panel shows the result, not the history.
 */
export function mergeToolActivity(
  current: ToolActivity,
  incoming: ToolActivity
): ToolActivity {
  const merged: ToolActivity = { ...current, ...incoming };
  // Thinking blocks carry the full accumulated reasoning in `detail` on
  // every update, so they overwrite it wholesale instead of appending to
  // the progress log like incremental tool progress notes do.
  if (incoming.name === "thinking") {
    merged.progressLog = undefined;
    return merged;
  }
  if (
    incoming.state === "running" &&
    incoming.detail &&
    incoming.detail !== current.detail
  ) {
    merged.progressLog = [...(current.progressLog ?? []), incoming.detail];
  } else if (incoming.state !== "running") {
    merged.progressLog = undefined;
  }
  return merged;
}

/**
 * One chronological entry in the live (un-persisted) transcript: either a
 * segment of streamed assistant text or a tool activity. Text that arrives
 * between tool calls starts a new segment, so the live view stacks events in
 * the order they actually happened - text first, then the tools it announced,
 * then more text - instead of lumping all text into one bubble after the tools.
 */
export type LiveChatEvent =
  | { kind: "text"; content: string }
  | { kind: "tool"; activity: ToolActivity };

/**
 * Appends a streamed text delta to the live transcript. Consecutive deltas
 * extend the trailing text segment; a delta that arrives after a tool event
 * starts a NEW segment, because a tool call separates the two text bursts.
 */
export function appendLiveTextDelta(
  events: LiveChatEvent[],
  delta: string
): LiveChatEvent[] {
  if (!delta) return events;
  const last = events[events.length - 1];
  if (last && last.kind === "text") {
    return [
      ...events.slice(0, -1),
      { kind: "text", content: last.content + delta },
    ];
  }
  return [...events, { kind: "text", content: delta }];
}

/**
 * Adds or updates a tool event in the live transcript. A state update for a
 * tool already in the list merges in place, keeping the tool at its original
 * chronological position; a first sighting appends after whatever text
 * preceded it. This is what keeps tool lines stacked below the intro text
 * that announced them.
 */
export function upsertLiveToolEvent(
  events: LiveChatEvent[],
  incoming: ToolActivity
): LiveChatEvent[] {
  const index = events.findIndex(
    event => event.kind === "tool" && event.activity.id === incoming.id
  );
  if (index === -1) {
    return [
      ...events,
      {
        kind: "tool",
        activity: mergeToolActivity(
          {
            id: incoming.id,
            name: incoming.name,
            state: "running",
            args: incoming.args ?? {},
          },
          incoming
        ),
      },
    ];
  }
  const current = events[index];
  if (current.kind !== "tool") return events;
  const next = events.slice();
  next[index] = {
    kind: "tool",
    activity: mergeToolActivity(current.activity, incoming),
  };
  return next;
}

/** One renderable entry of the live (un-persisted) transcript. */
type LiveChatItem =
  | { kind: "text"; content: string }
  | { kind: "toolRun"; activities: ToolActivity[] };

/**
 * Shared run/flush fold behind both groupers: consecutive tool activities
 * collapse into one `toolRun` item; everything else passes through in order.
 */
function groupActivityRuns<TInput, TItem>(
  inputs: TInput[],
  toActivity: (input: TInput) => ToolActivity | null,
  toItem: (input: TInput) => TItem
): Array<TItem | { kind: "toolRun"; activities: ToolActivity[] }> {
  const items: Array<TItem | { kind: "toolRun"; activities: ToolActivity[] }> =
    [];
  let run: ToolActivity[] = [];
  const flushRun = () => {
    if (run.length > 0) {
      items.push({ kind: "toolRun", activities: run });
      run = [];
    }
  };
  for (const input of inputs) {
    const activity = toActivity(input);
    if (activity) {
      run.push(activity);
      continue;
    }
    flushRun();
    items.push(toItem(input));
  }
  flushRun();
  return items;
}

/**
 * Folds the ordered live events into render items: each streamed text segment
 * stays exactly where it happened, and each consecutive stretch of tool events
 * collapses into one run so the live view keeps a single compact card per
 * stretch. This is what keeps a live turn in arrival order - an intro line
 * ("let me check that") stays above the tools it announced instead of being
 * left behind below them once those tools arrive.
 */
export function groupLiveChatItems(events: LiveChatEvent[]): LiveChatItem[] {
  return groupActivityRuns(
    events,
    event => (event.kind === "tool" ? event.activity : null),
    event => ({
      kind: "text" as const,
      content: event.kind === "text" ? event.content : "",
    })
  );
}

export function parsePersistedToolActivity(
  content: string,
  createdAt?: string | Date | null
): ToolActivity | null {
  if (!content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      content.slice(TOOL_ACTIVITY_MESSAGE_PREFIX.length)
    );
    if (
      !parsed ||
      typeof parsed.id !== "string" ||
      typeof parsed.name !== "string"
    )
      return null;
    if (
      parsed.state !== "running" &&
      parsed.state !== "completed" &&
      parsed.state !== "failed"
    )
      return null;
    return {
      id: parsed.id,
      name: parsed.name,
      state: parsed.state,
      args: parseStringRecord(parsed.args),
      owner: isToolActivityOwner(parsed.owner) ? parsed.owner : undefined,
      createdAt: createdAt ?? undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Whether a persisted row's `owner` field names a known actor. Anything else
 * (a row written before the field existed, or an unrecognised token) leaves
 * the activity ownerless, which the UI reads as Nova's own call - matching
 * how those rows were emitted.
 */
function isToolActivityOwner(value: unknown): value is ToolActivityOwner {
  return (
    value === "nova" ||
    value === "coding-specialist" ||
    value === "research-agent" ||
    value === "thinker-agent" ||
    value === "vm-agent"
  );
}

/**
 * The actor a tool activity belongs to, as a short label and a one-sentence
 * plain-English explanation of who ran it. `nova` is both what new rows
 * carry and the default for ownerless rows written before the field existed.
 */
export type ToolActivityActor = {
  owner: ToolActivityOwner;
  /** Short name shown on the badge, e.g. "Coding specialist". */
  label: string;
  /**
   * Plain-English explanation of who made the call and how it got there, for
   * the badge's tooltip text.
   */
  description: string;
};

export function toolActivityActor(
  activity: ToolActivity
): ToolActivityActor {
  const owner = activity.owner ?? ownerOfCall(activity.name);
  switch (owner) {
    case "coding-specialist":
      return {
        owner,
        label: "Coding specialist",
        description: "A specialist Nova delegated the coding to - not Nova itself. It reads, writes and runs files in your workspace on its own.",
      };
    case "research-agent":
      return {
        owner,
        label: "Research agent",
        description: "A specialist Nova delegated the research to - not Nova itself.",
      };
    case "thinker-agent":
      return {
        owner,
        label: "Thinker",
        description: "A specialist Nova delegated this analysis to - not Nova itself.",
      };
    case "vm-agent":
      return {
        owner,
        label: "VM agent",
        description: "A specialist Nova delegated this task to - not Nova itself. It runs in the workspace sandbox.",
      };
    default:
      return {
        owner: "nova",
        label: "Nova",
        description: "Called directly by Nova, on your behalf.",
      };
  }
}

/**
 * The actor for rows that carry no `owner` field (written before the field
 * existed): delegation tools were always sub-agent calls even then, so their
 * rows still get the specialist's badge - never Nova's. Everything the main
 * agent called itself stays Nova.
 */
function ownerOfCall(name: string): ToolActivityOwner {
  switch (name) {
    case "editor":
    case "code_task":
      return "coding-specialist";
    case "research_web":
      return "research-agent";
    case "thinker":
      return "thinker-agent";
    case "run_vm_task":
      return "vm-agent";
    default:
      return "nova";
  }
}

/**
 * Whether a tool activity ran on a sub-agent rather than on Nova itself.
 * Drives the indented "inside the delegation" styling.
 */
export function isDelegatedToolActivity(activity: ToolActivity): boolean {
  return toolActivityActor(activity).owner !== "nova";
}

/**
 * The plain-English label for a turn-anchoring user message: a short
 * snippet of what the user asked, so a long thread reads as a numbered
 * list of topics instead of a wall of bubbles. Falls back to a generic
 * label when the message is empty.
 */
export function turnAskLabel(content: string): string {
  const singleLine = content.replace(/\s+/g, " ").trim();
  if (!singleLine) return "your message";
  const max = 64;
  return singleLine.length > max
    ? `${singleLine.slice(0, max - 1).trimEnd()}...`
    : singleLine;
}

/**
 * Totalling the tool work of one turn so the header can say what it cost:
 * how many calls and how many of them were on a sub-agent. A mixed turn
 * names both; an all-Nova turn stays quiet about delegation.
 */
export type TurnToolSummary = {
  total: number;
  delegated: number;
  label: string;
};

export function turnToolSummary(activities: ToolActivity[]): TurnToolSummary {
  const total = activities.length;
  const delegated = activities.filter(isDelegatedToolActivity).length;
  const label =
    total === 0
      ? "no tools"
      : delegated === 0
        ? `${total} tool${total === 1 ? "" : "s"}`
        : `${total} tool${total === 1 ? "" : "s"} (${delegated} delegated)`;
  return { total, delegated, label };
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") return {};
    record[key] = entry;
  }
  return record;
}

type ChatReconciliation = {
  userCommitted: boolean;
  replyCommitted: boolean;
  liveActivities: ToolActivity[];
};

/**
 * Decides which optimistic bubbles are still needed on top of the persisted
 * conversation. Because the server persists the user message, tool rows, and
 * the assistant reply while the same content is streamed optimistically, the
 * UI must not render both copies (duplicates) nor drop a reply before its
 * persisted copy exists (flicker / missing messages).
 *
 * `baselineMessageId` is the highest persisted id at submit time. Only records
 * with a higher id belong to the current submission, so an identical prompt or
 * reply sent twice is never mistaken for the earlier one (commit identity is
 * the record id, not its content).
 */
export function reconcileChatMessages(
  persisted: PersistedChatMessage[],
  baselineMessageId: number,
  pendingUserContent: string,
  streamingContent: string,
  toolActivities: ToolActivity[]
): ChatReconciliation {
  const submitted = persisted.filter(message => message.id > baselineMessageId);
  const userCommitted = Boolean(
    pendingUserContent && submitted.some(message => message.role === "user")
  );
  // Internal bookkeeping rows (tool activity, specialist acceptance, the
  // workflow-mode marker) are written with the assistant role but are not
  // replies - counting one as the committed reply would hide the reply still
  // streaming in.
  const replyCommitted = Boolean(
    streamingContent &&
      submitted.some(
        message =>
          message.role === "assistant" &&
          !isInternalChatMessage(message.content)
      )
  );
  const persistedToolIds = new Set<string>();
  for (const message of submitted) {
    const persistedTool = parsePersistedToolActivity(message.content);
    if (persistedTool) persistedToolIds.add(persistedTool.id);
  }
  const liveActivities = toolActivities.filter(
    activity => !persistedToolIds.has(activity.id)
  );
  return { userCommitted, replyCommitted, liveActivities };
}

type ChatListItem =
  | { kind: "message"; message: PersistedChatMessage }
  | { kind: "toolRun"; activities: ToolActivity[] };

/**
 * The server prefixes every agent-team reply with `[Name] ` so the reader can
 * tell which teammate spoke; live streamed text carries no such prefix. Any
 * content comparison between a live segment and its ledger row has to ignore
 * the attribution, or the streamed copy never hands over to its persisted row
 * and the turn shows both - out of order - until a reload settles it.
 */
const TEAM_REPLY_ATTRIBUTION = /^\[[^\]\n]{1,80}\]\s+/;

function stripReplyAttribution(content: string): string {
  return content.replace(TEAM_REPLY_ATTRIBUTION, "").trim();
}

/**
 * Folds the persisted transcript into render items: consecutive tool-activity
 * rows merge into a single `toolRun` item so the chat can render them as one
 * collapsible "Used N tools" group instead of a stack of standalone chips.
 * Every other message passes through unchanged, in order.
 */
export function groupPersistedChatItems(
  messages: PersistedChatMessage[]
): ChatListItem[] {
  return groupActivityRuns(
    messages,
    message => parsePersistedToolActivity(message.content, message.createdAt),
    message => ({ kind: "message" as const, message })
  );
}

/**
 * One renderable entry of the current turn, in the order it happened. `key`
 * identifies the row across re-renders: the persisted message id for ledger
 * rows, the live-segment index for live rows. Array indices would make React
 * reuse one row's DOM node for a different row as the list changes shape
 * (optimistic user bubble to ledger row, live segment to ledger reply),
 * replaying the entry animation or flashing stale content.
 */
export type TurnRenderItem =
  | {
      kind: "user";
      key: string;
      messageId: number;
      content: string;
      pending: boolean;
      createdAt?: string | Date | null;
    }
  | {
      kind: "reply";
      key: string;
      messageId: number;
      content: string;
      live: boolean;
      createdAt?: string | Date | null;
    }
  | {
      kind: "toolRun";
      key: string;
      activities: ToolActivity[];
      live: boolean;
      createdAt?: string | Date | null;
    };

/**
 * Lays the current turn out in the order it actually happened: what the user
 * asked, what Nova said, the tools it called, what it said next, and finally
 * the reply. This is what keeps an intro line ("let me check that") above the
 * tools it announced - drawing every tool row first and one accumulated text
 * bubble after it left that line stranded below its own tools, which read as
 * if Nova had used the tools before saying anything.
 *
 * The persisted ledger is the skeleton: the server appends rows in
 * chronological order (the announcing text, then the tools it announced, then
 * the next text), so walking those rows in order keeps the turn in sequence
 * whether the browser watched it stream or is reading it back later. The live
 * transcript fills in only what the ledger does not hold yet - the segment
 * still streaming and tools whose rows have not landed - and it is always the
 * newest content, so it appends after the ledger rows. A tool the poller has
 * already delivered renders from its ledger row instead of a second live copy,
 * so a completed call never jumps back above the text around it. A live text
 * segment drops out once its ledger row exists, in order, so a persisted row
 * (or a rephrased end-of-run reply) never duplicates the streamed bubble.
 */
export function buildTurnItems({
  messages,
  liveEvents,
  pendingUserContent,
  userCommitted,
  streaming = false,
}: {
  /** Persisted rows belonging to this turn (ids above the submission baseline). */
  messages: PersistedChatMessage[];
  /** The browser's live transcript, in arrival order. */
  liveEvents: LiveChatEvent[];
  pendingUserContent: string;
  userCommitted: boolean;
  /**
   * True while the run is still in flight. A live segment no ledger row has
   * matched yet is the text currently streaming, not a superseded draft, so
   * the closing-reply rule must not hide it mid-run (that made the reply
   * blink out whenever an interim narration row became the last ledger row).
   */
  streaming?: boolean;
}): TurnRenderItem[] {
  const items: TurnRenderItem[] = [];
  const ledgerActivities = new Map<string, ToolActivity>();
  const ledgerReplies: string[] = [];
  for (const message of messages) {
    const activity = parsePersistedToolActivity(
      message.content,
      message.createdAt
    );
    if (activity) ledgerActivities.set(activity.id, activity);
    else if (message.role === "assistant") ledgerReplies.push(message.content);
  }
  const liveItems = groupLiveChatItems(liveEvents);

  // The optimistic bubble stands in for the user's row until the server
  // persists it; afterwards the ledger copy takes its place in the skeleton
  // below, keeping the user's row interleaved with the tools and replies that
  // followed it. A run started elsewhere (Telegram, a reload) has no
  // optimistic bubble at all, so its whole turn - every user row and every
  // tool run - comes from the ledger in order.
  if (Boolean(pendingUserContent) && !userCommitted)
    items.push({
      kind: "user",
      key: "user-pending",
      messageId: 0,
      content: pendingUserContent,
      pending: true,
    });

  // Which live text segments the ledger has already recorded. Matched in
  // order, and a mismatch does not advance the pointer: a segment the server
  // does not persist (a superseded draft) cannot hide a later one it did. The
  // ending comparison covers a segment that grew past its ledger row - the
  // streamed text plus the reply the model restated in end_turn.
  let ledgerReplyIndex = 0;
  const liveTextCommitted = liveItems.map(item => {
    if (item.kind !== "text") return false;
    const ledgerCopy = ledgerReplies[ledgerReplyIndex];
    if (ledgerCopy === undefined) return false;
    // Attribution is stripped on both sides: a team-chat ledger row reads
    // `[Mira] the reply` while the streamed segment is just `the reply`.
    const ledger = stripReplyAttribution(ledgerCopy);
    const live = stripReplyAttribution(item.content);
    if (ledger.length === 0 || !(live === ledger || live.endsWith(ledger)))
      return false;
    ledgerReplyIndex += 1;
    return true;
  });

  // The turn's closing reply is a text row with no tool row after it. Once it
  // lands, the ledger is the record of what Nova said, so any live segment it
  // did not match (a superseded draft, or narration the model restated in
  // end_turn) drops out instead of trailing or duplicating the reply.
  const lastMessage = messages[messages.length - 1];
  const closingReplyPersisted = Boolean(
    lastMessage &&
      lastMessage.role === "assistant" &&
      !parsePersistedToolActivity(lastMessage.content)
  );

  // The ledger skeleton, in the order those rows were written.
  for (const item of groupPersistedChatItems(messages)) {
    if (item.kind === "toolRun")
      items.push({
        kind: "toolRun",
        key: `tools-${item.activities[0].id}`,
        live: false,
        createdAt: item.activities[0].createdAt ?? null,
        activities: item.activities.map(
          activity => ledgerActivities.get(activity.id) ?? activity
        ),
      });
    else if (item.message.role === "user")
      items.push({
        kind: "user",
        key: `user-${item.message.id}`,
        messageId: item.message.id,
        content: item.message.content,
        pending: false,
        createdAt: item.message.createdAt ?? null,
      });
    else
      items.push({
        kind: "reply",
        key: `reply-${item.message.id}`,
        messageId: item.message.id,
        content: item.message.content,
        live: false,
        createdAt: item.message.createdAt ?? null,
      });
  }

  // The live tail: the segment still streaming and any tool whose row has not
  // been polled in yet. Everything already in the ledger stays where the
  // ledger put it.
  for (let index = 0; index < liveItems.length; index += 1) {
    const item = liveItems[index];
    if (item.kind === "text") {
      // While the run is live, an unmatched segment is the reply still
      // arriving: show it. Only a settled turn treats unmatched text as a
      // superseded draft the persisted ledger has already replaced.
      if (!liveTextCommitted[index] && (streaming || !closingReplyPersisted))
        items.push({
          kind: "reply",
          key: `live-reply-${index}`,
          messageId: 0,
          content: item.content,
          live: true,
        });
      continue;
    }
    const activities = item.activities.filter(
      activity => !ledgerActivities.has(activity.id)
    );
    if (activities.length > 0)
      items.push({
        kind: "toolRun",
        key: `live-tools-${item.activities[0].id}`,
        activities,
        live: true,
      });
  }

  return items;
}

/**
 * Collapses persisted tool-activity rows to one entry per activity id,
 * keeping the LATEST state at its position (running → completed/failed).
 * Other messages pass through untouched and order is preserved.
 */
export function dedupeToolActivityMessages(
  messages: PersistedChatMessage[]
): PersistedChatMessage[] {
  // Parse each row once: the filter below would otherwise re-parse every
  // tool row up to three times. The indexes live in a Map rather than a plain
  // object so an id such as "__proto__" is stored like any other string.
  const activityIds = messages.map(
    message => parsePersistedToolActivity(message.content)?.id ?? null
  );
  const lastIndexOf = new Map<string, number>();
  activityIds.forEach((id, index) => {
    if (id !== null) lastIndexOf.set(id, index);
  });
  return messages.filter((_, index) => {
    const id = activityIds[index];
    return id === null || lastIndexOf.get(id) === index;
  });
}
