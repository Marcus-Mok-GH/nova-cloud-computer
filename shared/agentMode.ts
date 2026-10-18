/**
 * Conversation workflow modes ("chat" / "plan" / "build") and the internal
 * mode-marker rows that record them. The server writes the markers into the
 * chat ledger and resolves a run's mode from them; the client reads the same
 * rows to label the conversation header. The marker prefix is the
 * byte-for-byte contract in `./const`, and the parsing below is shared so a
 * persisted row always resolves to the same mode on both sides.
 */

import { AGENT_MODE_MESSAGE_PREFIX } from "./const";

export type AgentMode = "chat" | "plan" | "build";

/**
 * Reads the latest persisted mode marker from a conversation's rows. Returns
 * null when the chat has never recorded a mode (an older chat, or a brand-new
 * one), so the caller can decide the default.
 */
export function latestAgentModeMarker(
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
