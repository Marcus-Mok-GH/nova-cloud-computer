import { describe, expect, it } from "vitest";
import type { PersistedChatMessage } from "./chatMessages";
import {
  EMPTY_CHAT_LEDGER,
  mergeChatLedger,
  type ChatLedgerState,
} from "./chatLedger";

const message = (id: number, content = `m${id}`): PersistedChatMessage => ({
  id,
  role: "assistant",
  content,
});

describe("mergeChatLedger", () => {
  it("takes the first payload as the whole history and sets the cursor", () => {
    const next = mergeChatLedger(
      EMPTY_CHAT_LEDGER,
      [message(1), message(2), message(3)],
      "c1"
    );
    expect(next.chatId).toBe("c1");
    expect(next.rows.map(row => row.id)).toEqual([1, 2, 3]);
    expect(next.cursor).toBe(3);
  });

  it("orders the first payload by id rather than trusting arrival order", () => {
    const next = mergeChatLedger(
      EMPTY_CHAT_LEDGER,
      [message(3), message(1), message(2)],
      "c1"
    );
    expect(next.rows.map(row => row.id)).toEqual([1, 2, 3]);
    expect(next.cursor).toBe(3);
  });

  it("appends only rows past the cursor", () => {
    const start = mergeChatLedger(
      EMPTY_CHAT_LEDGER,
      [message(1), message(2)],
      "c1"
    );
    const next = mergeChatLedger(start, [message(3), message(4)], "c1");
    expect(next.rows.map(row => row.id)).toEqual([1, 2, 3, 4]);
    expect(next.cursor).toBe(4);
  });

  it("is a no-op for an empty incremental slice or a repeated payload", () => {
    const start = mergeChatLedger(
      EMPTY_CHAT_LEDGER,
      [message(1), message(2)],
      "c1"
    );
    expect(mergeChatLedger(start, [], "c1")).toBe(start);
    expect(mergeChatLedger(start, [message(1), message(2)], "c1")).toBe(start);
  });

  it("drops the previous chat's rows and cursor when the reader switches", () => {
    const start = mergeChatLedger(
      EMPTY_CHAT_LEDGER,
      [message(10), message(11)],
      "c1"
    );
    const next = mergeChatLedger(start, [message(1)], "c2");
    expect(next.chatId).toBe("c2");
    expect(next.rows.map(row => row.id)).toEqual([1]);
    expect(next.cursor).toBe(1);
  });

  it("re-seeds from an emptied ledger after a revert", () => {
    const emptied: ChatLedgerState = { chatId: "c1", rows: [], cursor: undefined };
    const next = mergeChatLedger(emptied, [message(7), message(8)], "c1");
    expect(next.rows.map(row => row.id)).toEqual([7, 8]);
    expect(next.cursor).toBe(8);
  });
});
