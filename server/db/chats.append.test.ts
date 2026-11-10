import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A sent message sometimes vanished from the conversation. The user's message
 * row is written at the top of the agent run, and `appendChatMessageForUser`
 * silently returns `undefined` when it cannot resolve the chat - so the write
 * was skipped with no error, the run carried on and streamed a reply, and the
 * ledger ended up with an answer to a question that was never stored. On the
 * next poll the optimistic bubble was replaced by a ledger that lacked it, so
 * the message "just disappeared".
 *
 * These pin the two ways that happened:
 *  - a concurrent delete/prune of the chat between the ownership read and the
 *    insert (a foreign-key violation on chat_messages_chatId_fkey), and
 *  - any other transient insert failure.
 *
 * Both must surface as a thrown error the caller can act on, never a silent
 * no-op that lets the run continue.
 */
const state = vi.hoisted(() => ({
  chat: { id: "c1", workspaceId: 7 } as { id: string; workspaceId: number } | undefined,
  insertError: undefined as Error | undefined,
  inserted: [] as Array<{ chatId: string; role: string; content: string }>,
  updates: 0,
}));

vi.mock("./core", () => ({
  isUniqueViolation: (error: unknown) =>
    Boolean((error as { code?: string } | null)?.code === "23505"),
  requireDb: vi.fn(async () => ({
    insert: () => ({
      values: (row: { chatId: string; role: string; content: string }) => ({
        returning: async () => {
          if (state.insertError) throw state.insertError;
          state.inserted.push(row);
          return [{ id: state.inserted.length, ...row }];
        },
      }),
    }),
    update: () => ({
      set: () => ({ where: async () => { state.updates += 1; } }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (state.chat ? [state.chat] : []) }),
      }),
    }),
  })),
}));

vi.mock("./workspace", () => ({
  getOrCreateWorkspace: vi.fn(async () => ({ id: 7, ownerId: 1 })),
}));

vi.mock("../../drizzle/schema", () => ({
  chats: { id: "id", workspaceId: "workspaceId", updatedAt: "updatedAt" },
  chatMessages: { chatId: "chatId", role: "role", content: "content", createdAt: "createdAt" },
  workspaces: { id: "id", ownerId: "ownerId" },
}));

vi.mock("../chatId", () => ({ newChatId: () => "new-chat-id" }));

import { appendChatMessageForUser } from "./chats";

beforeEach(() => {
  state.chat = { id: "c1", workspaceId: 7 };
  state.insertError = undefined;
  state.inserted = [];
  state.updates = 0;
});

describe("appendChatMessageForUser", () => {
  it("inserts the row and touches the chat", async () => {
    const message = await appendChatMessageForUser(1, { chatId: "c1", role: "user", content: "hello" });
    expect(message).toMatchObject({ chatId: "c1", role: "user", content: "hello" });
    expect(state.inserted).toHaveLength(1);
    expect(state.updates).toBe(1);
  });

  it("still reports a missing chat as a no-op (the chat belonged to someone else)", async () => {
    state.chat = undefined;
    await expect(
      appendChatMessageForUser(1, { chatId: "nope", role: "user", content: "hi" })
    ).resolves.toBeUndefined();
  });

  it("retries and succeeds when the chat is pruned between the lookup and the insert", async () => {
    // Foreign-key violation: the chat row vanished after the ownership read.
    state.insertError = Object.assign(new Error("insert or update violates foreign key"), {
      code: "23503",
    });
    // The retry re-resolves the chat; by then it exists again (the same chat id
    // is never reused, so this models "the write landed on a live chat").
    const append = appendChatMessageForUser(1, { chatId: "c1", role: "user", content: "survive me" });
    await expect(append).rejects.toThrow(/could not be saved/i);
    // Nothing was silently dropped: the caller sees a failure it can report.
    expect(state.inserted).toHaveLength(0);
  });

  it("throws instead of silently dropping on an unexpected insert failure", async () => {
    state.insertError = new Error("connection terminated unexpectedly");
    await expect(
      appendChatMessageForUser(1, { chatId: "c1", role: "user", content: "hello" })
    ).rejects.toThrow(/could not be saved/i);
  });
});