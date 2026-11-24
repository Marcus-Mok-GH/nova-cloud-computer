import type { PersistedChatMessage } from "./chatMessages";

/**
 * The transcript the reader has on screen plus the cursor the next poll uses.
 * `cursor` is the newest row id already held, so the server can return only
 * what changed; it belongs to `chatId` and is dropped when the reader opens a
 * different conversation.
 */
export type ChatLedgerState = {
  chatId: string;
  rows: PersistedChatMessage[];
  cursor: number | undefined;
};

export const EMPTY_CHAT_LEDGER: ChatLedgerState = {
  chatId: "",
  rows: [],
  cursor: undefined,
};

/**
 * Folds one ledger response into the accumulated transcript.
 *
 * The first payload for a conversation carries no cursor and IS the history,
 * so it replaces whatever the previously opened chat left behind - including
 * rows the caller still holds. Later payloads are slices after the cursor, so
 * they append. Merging by id rather than trusting arrival order keeps the
 * transcript ordered even when a poll lands mid-write or two polls overlap,
 * and makes a repeated payload a no-op.
 */
export function mergeChatLedger(
  current: ChatLedgerState,
  incoming: PersistedChatMessage[],
  chatId: string
): ChatLedgerState {
  if (!incoming.length && current.chatId === chatId) return current;
  if (current.chatId !== chatId) {
    const rows = [...incoming].sort((a, b) => a.id - b.id);
    return {
      chatId,
      rows,
      cursor: rows.length ? rows[rows.length - 1].id : undefined,
    };
  }
  const known = new Set(current.rows.map(message => message.id));
  const fresh = incoming.filter(message => !known.has(message.id));
  if (fresh.length === 0) return current;
  const merged = [...current.rows, ...fresh].sort((a, b) => a.id - b.id);
  return {
    ...current,
    rows: merged,
    cursor: merged.length ? merged[merged.length - 1].id : undefined,
  };
}
