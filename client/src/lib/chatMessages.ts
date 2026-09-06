export const TOOL_ACTIVITY_MESSAGE_PREFIX = "__nova_tool_activity__:";

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
};

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
