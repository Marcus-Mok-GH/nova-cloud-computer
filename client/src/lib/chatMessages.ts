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
      args: parsed.args && typeof parsed.args === "object" ? parsed.args : {},
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    };
  } catch {
    return null;
  }
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
 */
export function reconcileChatMessages(
  persisted: PersistedChatMessage[],
  pendingUserContent: string,
  streamingContent: string,
  toolActivities: ToolActivity[]
): ChatReconciliation {
  const latest = [...persisted].reverse();
  const latestUserMessage = latest.find(message => message.role === "user");
  const latestAssistantMessage = latest.find(
    message => message.role === "assistant"
  );
  const userCommitted = Boolean(
    latestUserMessage &&
      pendingUserContent &&
      latestUserContentMatches(latestUserMessage.content, pendingUserContent)
  );
  const replyCommitted = Boolean(
    latestAssistantMessage &&
      streamingContent &&
      latestAssistantMessage.content.trim() === streamingContent.trim()
  );
  const persistedToolIds = new Set<string>();
  for (const message of persisted) {
    const persistedTool = parsePersistedToolActivity(message.content);
    if (persistedTool) persistedToolIds.add(persistedTool.id);
  }
  const liveActivities = toolActivities.filter(
    activity => !persistedToolIds.has(activity.id)
  );
  return { userCommitted, replyCommitted, liveActivities };
}

function latestUserContentMatches(
  persistedContent: string,
  pendingContent: string
): boolean {
  return persistedContent.trim() === pendingContent.trim();
}
