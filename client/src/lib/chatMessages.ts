export const TOOL_ACTIVITY_MESSAGE_PREFIX = "__nova_tool_activity__:";
/** Internal bookkeeping rows (specialist-acceptance state) - never rendered. */
export const SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX = "__nova_specialist_acceptance__:";

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
   * oldest first, so long-running sub-agents (research_web, code_task) can
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
  if (incoming.state === "running" && incoming.detail && incoming.detail !== current.detail) {
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
