import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { chatMessages, chats, workspaces } from "../../drizzle/schema";
import { newChatId } from "../chatId";
import { isUniqueViolation, requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";

/**
 * One chat row, scoped to its owner in a single round trip. The workspace is
 * resolved as a subquery rather than a separate read, so every chat read or
 * write path (opening a conversation, polling it, appending to it) costs one
 * query less. This deliberately does not provision a workspace: sign-in and
 * `workspace.computer` do that, and a chat cannot exist without one.
 */
export async function getChatForUser(ownerId: number, chatId: string) {
  const db = await requireDb();
  const ownedWorkspaceIds = db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, ownerId));
  return (await db.select().from(chats).where(and(
    eq(chats.id, chatId),
    inArray(chats.workspaceId, ownedWorkspaceIds),
  )).limit(1))[0];
}

export async function listChatsForUser(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  return listChatsByWorkspaceId(workspace.id);
}

/** Internal: the caller must have resolved a workspace this owner owns. */
export async function listChatsByWorkspaceId(workspaceId: number) {
  const db = await requireDb();
  return db.select().from(chats).where(eq(chats.workspaceId, workspaceId)).orderBy(desc(chats.updatedAt));
}
/**
 * Sets the chat's selected model (`null` restores the default free model).
 * Catalogue validation and plan gating happen in the router before this
 * write; here the value is stored verbatim so the next run reads it.
 */
export async function setChatModelForUser(ownerId: number, chatId: string, model: string | null) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, chatId);
  if (!chat) return undefined;
  return (await db.update(chats).set({ model, updatedAt: new Date() }).where(eq(chats.id, chat.id)).returning())[0];
}

export async function createChatForUser(
  ownerId: number,
  title: string,
  model?: string | null,
  effort?: string | null
) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  // A random id keeps chat links unpredictable; retry on the astronomically
  // unlikely collision with an existing primary key. Catalogue/plan validation
  // and effort-support checks happen in the router before this write; here
  // the values are stored verbatim so the next run reads them.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return (
        await db
          .insert(chats)
          .values({
            id: newChatId(),
            workspaceId: workspace.id,
            title,
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
          })
          .returning()
      )[0];
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return undefined;
}

export async function listChatMessagesForUser(ownerId: number, chatId: string) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, chatId);
  if (!chat) return undefined;
  return db.select().from(chatMessages).where(eq(chatMessages.chatId, chat.id)).orderBy(asc(chatMessages.createdAt));
}

/** Postgres `foreign_key_violation`. Raised when the chat row is gone. */
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Appends a chat message and bumps the chat's `updatedAt`.
 *
 * A message must never be dropped silently: the agent run writes the user's
 * row before it starts, so a skipped write leaves the ledger holding a reply
 * to a question that was never stored - the message the user sent disappears
 * from the conversation on the next poll, with no error anywhere.
 *
 * A missing chat still returns `undefined` (that is an ownership/not-found
 * answer the caller handles). Every other failure throws, and a foreign-key
 * violation - the chat was pruned or deleted between the ownership read and
 * the insert, which is a live race because several prunes and deletes run
 * concurrently - is retried once against a freshly resolved chat.
 */
export async function appendChatMessageForUser(ownerId: number, input: { chatId: string; role: "user" | "assistant"; content: string }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const db = await requireDb();
    const chat = await getChatForUser(ownerId, input.chatId);
    if (!chat) return undefined;
    try {
      const [message] = await db.insert(chatMessages).values({ chatId: chat.id, role: input.role, content: input.content }).returning();
      await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chat.id));
      return message;
    } catch (error) {
      // The chat row went away between the read and the insert. Retry once:
      // the re-resolved lookup either finds a live chat and the write lands,
      // or returns undefined (a genuine not-found the caller handles).
      if ((error as { code?: string } | null)?.code === FOREIGN_KEY_VIOLATION && attempt === 0) continue;
      console.error("[Chat] failed to append message", error instanceof Error ? error.message : error);
      throw new Error("Your message could not be saved. Please try sending it again.");
    }
  }
  return undefined;
}

/**
 * Reverts a conversation to an earlier message for the regenerate flow.
 * Deletes every message in the chat with an id at or after `messageId`
 * (the anchor inclusive), so the caller can resend the anchor's content as
 * a fresh turn. Returns undefined when the chat or anchor does not belong
 * to the user.
 */
export async function revertChatToMessageForUser(ownerId: number, chatId: string, messageId: number) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, chatId);
  if (!chat) return undefined;
  const [anchor] = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.chatId, chat.id), eq(chatMessages.id, messageId)))
    .limit(1);
  if (!anchor) return undefined;
  const deleted = await db
    .delete(chatMessages)
    .where(and(eq(chatMessages.chatId, chat.id), gte(chatMessages.id, messageId)))
    .returning({ id: chatMessages.id });
  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chat.id));
  return { anchor, deletedCount: deleted.length };
}

export async function renameChatIfDefaultForUser(ownerId: number, chatId: string, title: string, defaultTitles: string[]) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, chatId);
  if (!chat) return undefined;
  const [updated] = await db.update(chats)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(chats.id, chat.id), inArray(chats.title, defaultTitles)))
    .returning();
  return updated;
}

export async function deleteChatForUser(ownerId: number, chatId: string) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, chatId);
  if (!chat) return false;
  await db.delete(chats).where(eq(chats.id, chat.id));
  return true;
}
