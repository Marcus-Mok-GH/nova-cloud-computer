import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A sent message sometimes vanished from the conversation. The user's message
 * row is written at the top of the agent run, and `appendChatMessageForUser`
 * silently returned `undefined` when it could not resolve the chat - so the
 * write was skipped, the run carried on and streamed a reply, and the ledger
 * ended up holding an answer to a question that was never stored. On the next
 * poll the optimistic bubble was replaced by a ledger that lacked it, so the
 * message "just disappeared".
 *
 * The trigger is a foreign-key race: the helper reads the chat for ownership,
 * then inserts in a separate statement, and `chat_messages.chatId` is a FK
 * onto `chats`. The delete endpoint and the Telegram stale-chat prune both run
 * concurrently with a send, so the chat can be gone before the insert lands.
 *
 * IMPORTANT - why the mocks look the way they do: under Drizzle the pg error is
 * NOT the thrown error. The thrown value is a `DrizzleQueryError` whose `.code`
 * is undefined and whose `.cause` is the pg `DatabaseError` carrying
 * `code: "23503"` (confirmed against live Postgres). A test that attaches the
 * code flat onto the thrown error passes even when the production check is
 * broken, so the retry is exercised here through a wrapped error and the real
 * unwrapping helper. That is the regression this suite exists to prevent.
 */
const state = vi.hoisted(() => ({
  chat: { id: "c1", workspaceId: 7 } as { id: string; workspaceId: number } | undefined,
  insertError: undefined as Error | undefined,
  inserted: [] as Array<{ chatId: string; role: string; content: string }>,
  updates: 0,
  attempts: 0,
  failAlways: false,
}));

/** The shape Drizzle actually throws: the pg code lives on `.cause`. */
function drizzleWrapped(pgCode: string, message: string): Error {
  const cause = Object.assign(new Error(message), {
    code: pgCode,
    constraint: pgCode === "23503" ? "chat_messages_chatId_chats_id_fk" : undefined,
    name: "DatabaseError",
  });
  return Object.assign(new Error(`Failed query: insert into "chat_messages" ...`), {
    name: "DrizzleQueryError",
    cause,
  });
}

vi.mock("./core", async () => {
  const actual = await vi.importActual<typeof import("./core")>("./core");
  return {
    // The REAL unwrapping helpers - they are part of what is under test.
    isForeignKeyViolation: actual.isForeignKeyViolation,
    isUniqueViolation: actual.isUniqueViolation,
    requireDb: vi.fn(async () => ({
      insert: () => ({
        values: (row: { chatId: string; role: string; content: string }) => ({
          returning: async () => {
            state.attempts += 1;
            // Fail the first attempt only, so a working retry can succeed;
            // `failAlways` models a chat that stayed gone.
            if (state.insertError && (state.failAlways || state.attempts === 1)) throw state.insertError;
            state.inserted.push(row);
            return [{ id: state.inserted.length, ...row }];
          },
        }),
      }),
      update: () => ({ set: () => ({ where: async () => { state.updates += 1; } }) }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => (state.chat ? [state.chat] : []) }),
        }),
      }),
    })),
  };
});

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
import { isForeignKeyViolation } from "./core";

beforeEach(() => {
  state.chat = { id: "c1", workspaceId: 7 };
  state.insertError = undefined;
  state.inserted = [];
  state.updates = 0;
  state.attempts = 0;
  state.failAlways = false;
});

describe("isForeignKeyViolation", () => {
  it("finds the code on a Drizzle-wrapped error (the production shape)", () => {
    expect(isForeignKeyViolation(drizzleWrapped("23503", "violates foreign key constraint"))).toBe(true);
  });

  it("still finds a flat code", () => {
    expect(isForeignKeyViolation(Object.assign(new Error("x"), { code: "23503" }))).toBe(true);
  });

  it("does not mistake other errors for a foreign-key violation", () => {
    expect(isForeignKeyViolation(drizzleWrapped("23505", "duplicate key"))).toBe(false);
    expect(isForeignKeyViolation(new Error("connection terminated unexpectedly"))).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
});

describe("appendChatMessageForUser", () => {
  it("inserts the row and touches the chat", async () => {
    const message = await appendChatMessageForUser(1, { chatId: "c1", role: "user", content: "hello" });
    expect(message).toMatchObject({ chatId: "c1", role: "user", content: "hello" });
    expect(state.inserted).toHaveLength(1);
    expect(state.updates).toBe(1);
  });

  it("reports a missing chat as a no-op (the chat was not this user's)", async () => {
    state.chat = undefined;
    await expect(
      appendChatMessageForUser(1, { chatId: "nope", role: "user", content: "hi" })
    ).resolves.toBeUndefined();
  });

  it("retries and saves the message when the chat is pruned between the lookup and the insert", async () => {
    // A Drizzle-wrapped 23503: exactly what live Postgres produced. If the
    // production check only reads the top-level `.code`, this never retries,
    // the write is lost and the message vanishes - the reported bug.
    state.insertError = drizzleWrapped(
      "23503",
      'insert or update on table "chat_messages" violates foreign key constraint'
    );
    const message = await appendChatMessageForUser(1, {
      chatId: "c1",
      role: "user",
      content: "survive me",
    });
    expect(state.attempts).toBe(2);
    expect(message).toMatchObject({ content: "survive me" });
    expect(state.inserted).toHaveLength(1);
  });

  it("throws instead of silently dropping on an unexpected insert failure", async () => {
    state.insertError = new Error("connection terminated unexpectedly");
    await expect(
      appendChatMessageForUser(1, { chatId: "c1", role: "user", content: "hello" })
    ).rejects.toThrow(/could not be saved/i);
  });

  it("gives up after one retry instead of looping when the chat stays gone", async () => {
    // Both attempts fail: the retry must not spin, and the caller must hear
    // about it rather than the write being dropped in silence.
    state.insertError = drizzleWrapped("23503", "still gone");
    state.failAlways = true;
    await expect(
      appendChatMessageForUser(1, { chatId: "c1", role: "user", content: "hello" })
    ).rejects.toThrow(/could not be saved/i);
    expect(state.attempts).toBe(2);
    expect(state.inserted).toHaveLength(0);
  });
});