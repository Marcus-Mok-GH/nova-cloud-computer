export const TOOL_ACTIVITY_MESSAGE_PREFIX = "__nova_tool_activity__:";
/** Internal bookkeeping rows (specialist-acceptance state) - never rendered. */
export const SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX =
  "__nova_specialist_acceptance__:";

/** True for internal rows the UI must never show as chat bubbles. */
export const isInternalChatMessage = (content: string): boolean =>
  content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX) ||
  content.startsWith(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX);

export type ChatRole = "user" | "assistant";
export type PersistedChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
};
export type ToolActivity = {
  id: string;
  name: string;
  state: "running" | "completed" | "failed";
  args: Record<string, string>;
  summary?: string;
  /** Live progress note while running, or the full tool response once done. */
  detail?: string;
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
  { kind: "text"; content: string } | { kind: "tool"; activity: ToolActivity };

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
export type LiveChatItem =
  | { kind: "text"; content: string }
  | { kind: "toolRun"; activities: ToolActivity[] };

/**
 * Folds the ordered live events into render items: each streamed text segment
 * stays exactly where it happened, and each consecutive stretch of tool events
 * collapses into one run so the live view keeps a single compact card per
 * stretch. This is what keeps a live turn in arrival order - an intro line
 * ("let me check that") stays above the tools it announced instead of being
 * left behind below them once those tools arrive.
 */
export function groupLiveChatItems(events: LiveChatEvent[]): LiveChatItem[] {
  const items: LiveChatItem[] = [];
  let run: ToolActivity[] = [];
  const flushRun = () => {
    if (run.length > 0) {
      items.push({ kind: "toolRun", activities: run });
      run = [];
    }
  };
  for (const event of events) {
    if (event.kind === "tool") {
      run.push(event.activity);
      continue;
    }
    flushRun();
    items.push({ kind: "text", content: event.content });
  }
  flushRun();
  return items;
}

export function parsePersistedToolActivity(
  content: string
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
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
    };
  } catch {
    return null;
  }
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

export type ChatReconciliation = {
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
  const replyCommitted = Boolean(
    streamingContent &&
    submitted.some(
      message =>
        message.role === "assistant" &&
        !message.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX)
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

/**
 * Collapses persisted tool-activity rows to one entry per activity id,
 * keeping the LATEST state at its position (running → completed/failed).
 * Other messages pass through untouched and order is preserved.
 */

export type ChatListItem =
  | { kind: "message"; message: PersistedChatMessage }
  | { kind: "toolRun"; activities: ToolActivity[] };

/**
 * Folds the persisted transcript into render items: consecutive tool-activity
 * rows merge into a single `toolRun` item so the chat can render them as one
 * collapsible "Used N tools" group instead of a stack of standalone chips.
 * Every other message passes through unchanged, in order.
 */
export function groupPersistedChatItems(
  messages: PersistedChatMessage[]
): ChatListItem[] {
  const items: ChatListItem[] = [];
  let run: ToolActivity[] = [];
  const flushRun = () => {
    if (run.length > 0) {
      items.push({ kind: "toolRun", activities: run });
      run = [];
    }
  };
  for (const message of messages) {
    const activity = parsePersistedToolActivity(message.content);
    if (activity) {
      run.push(activity);
      continue;
    }
    flushRun();
    items.push({ kind: "message", message });
  }
  flushRun();
  return items;
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
  | { kind: "user"; key: string; content: string; pending: boolean }
  | { kind: "reply"; key: string; content: string; live: boolean }
  | { kind: "toolRun"; key: string; activities: ToolActivity[]; live: boolean };

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
}: {
  /** Persisted rows belonging to this turn (ids above the submission baseline). */
  messages: PersistedChatMessage[];
  /** The browser's live transcript, in arrival order. */
  liveEvents: LiveChatEvent[];
  pendingUserContent: string;
  userCommitted: boolean;
}): TurnRenderItem[] {
  const items: TurnRenderItem[] = [];
  const ledgerActivities = new Map<string, ToolActivity>();
  const ledgerReplies: string[] = [];
  for (const message of messages) {
    const activity = parsePersistedToolActivity(message.content);
    if (activity) ledgerActivities.set(activity.id, activity);
    else if (message.role === "assistant") ledgerReplies.push(message.content);
  }
  const liveItems = groupLiveChatItems(liveEvents);

  // The optimistic bubble stands in for the user's row until the server
  // persists it; afterwards the ledger copy takes that place. A run started
  // elsewhere (Telegram, a reload) has no optimistic bubble at all.
  const pendingUser = Boolean(pendingUserContent) && !userCommitted;
  if (pendingUser)
    items.push({
      kind: "user",
      key: "user-pending",
      content: pendingUserContent,
      pending: true,
    });
  else
    for (const message of messages)
      if (message.role === "user")
        items.push({
          kind: "user",
          key: `user-${message.id}`,
          content: message.content,
          pending: false,
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
    const ledger = ledgerCopy.trim();
    const live = item.content.trim();
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
        activities: item.activities.map(
          activity => ledgerActivities.get(activity.id) ?? activity
        ),
      });
    else if (item.message.role === "assistant")
      items.push({
        kind: "reply",
        key: `reply-${item.message.id}`,
        content: item.message.content,
        live: false,
      });
  }

  // The live tail: the segment still streaming and any tool whose row has not
  // been polled in yet. Everything already in the ledger stays where the
  // ledger put it.
  for (let index = 0; index < liveItems.length; index += 1) {
    const item = liveItems[index];
    if (item.kind === "text") {
      if (!liveTextCommitted[index] && !closingReplyPersisted)
        items.push({
          kind: "reply",
          key: `live-reply-${index}`,
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

export function dedupeToolActivityMessages(
  messages: PersistedChatMessage[]
): PersistedChatMessage[] {
  const lastIndexOf: Record<string, number> = {};
  for (let index = 0; index < messages.length; index += 1) {
    const activity = parsePersistedToolActivity(messages[index].content);
    if (activity) lastIndexOf[activity.id] = index;
  }
  return messages.filter(
    (message, index) =>
      !parsePersistedToolActivity(message.content) ||
      lastIndexOf[parsePersistedToolActivity(message.content)!.id] === index
  );
}
