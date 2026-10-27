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

export async function createChatForUser(ownerId: number, title: string) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  // A random id keeps chat links unpredictable; retry on the astronomically
  // unlikely collision with an existing primary key.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return (await db.insert(chats).values({ id: newChatId(), workspaceId: workspace.id, title }).returning())[0];
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

export async function appendChatMessageForUser(ownerId: number, input: { chatId: string; role: "user" | "assistant"; content: string }) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, input.chatId);
  if (!chat) return undefined;
  const [message] = await db.insert(chatMessages).values({ chatId: chat.id, role: input.role, content: input.content }).returning();
  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chat.id));
  return message;
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
