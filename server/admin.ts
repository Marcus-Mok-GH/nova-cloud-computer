/**
 * Admin console data access. Every function here is reached only through
 * `adminProcedure`, which rejects any caller whose role is not `admin`.
 */
import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  agentVmRuns,
  automations,
  chatMessages,
  chats,
  projects,
  tasks,
  telegramBotSettings,
  users,
  workspaceFiles,
  workspaceFolders,
  workspaces,
} from "../drizzle/schema";

export type AdminManagedUser = {
  id: number;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  bannedAt: Date | null;
  createdAt: Date;
  lastSignedIn: Date;
};

const managedUserColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  bannedAt: users.bannedAt,
  createdAt: users.createdAt,
  lastSignedIn: users.lastSignedIn,
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Nova could not reach its database.");
  return db;
}

/** Every registered account, newest first, without internal identifiers. */
export async function listUsersForAdmin(): Promise<AdminManagedUser[]> {
  const db = await requireDb();
  const rows = await db
    .select(managedUserColumns)
    .from(users)
    .orderBy(desc(users.createdAt));
  return rows as AdminManagedUser[];
}

/** System-wide counts plus recent activity for the admin overview cards. */
export async function getAdminOverview() {
  const db = await requireDb();

  const [
    [usersTotal],
    [adminsTotal],
    [chatsTotal],
    [messagesTotal],
    [projectsTotal],
    [tasksTotal],
    [automationsTotal],
    [workspacesTotal],
    [telegramLinkedTotal],
    [activeAgentRuns],
  ] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(users).where(eq(users.role, "admin")),
    db.select({ value: count() }).from(chats),
    db.select({ value: count() }).from(chatMessages),
    db.select({ value: count() }).from(projects),
    db.select({ value: count() }).from(tasks),
    db.select({ value: count() }).from(automations),
    db.select({ value: count() }).from(workspaces),
    db.select({ value: count() }).from(telegramBotSettings),
    db.select({ value: count() }).from(agentVmRuns).where(inArray(agentVmRuns.status, ["queued", "running"])),
  ]);

  const recentUsers = await db
    .select(managedUserColumns)
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(5);

  const recentAgentRuns = await db
    .select({
      id: agentVmRuns.id,
      task: agentVmRuns.task,
      status: agentVmRuns.status,
      createdAt: agentVmRuns.createdAt,
    })
    .from(agentVmRuns)
    .orderBy(desc(agentVmRuns.createdAt))
    .limit(5);

  return {
    totals: {
      users: usersTotal?.value ?? 0,
      admins: adminsTotal?.value ?? 0,
      chats: chatsTotal?.value ?? 0,
      messages: messagesTotal?.value ?? 0,
      projects: projectsTotal?.value ?? 0,
      tasks: tasksTotal?.value ?? 0,
      automations: automationsTotal?.value ?? 0,
      workspaces: workspacesTotal?.value ?? 0,
      telegramLinked: telegramLinkedTotal?.value ?? 0,
      activeAgentRuns: activeAgentRuns?.value ?? 0,
    },
    recentUsers: recentUsers as AdminManagedUser[],
    recentAgentRuns,
  };
}

/** Promote or demote an account. Returns the updated row, or undefined if the id is unknown. */
export async function setUserRoleForAdmin(userId: number, role: "user" | "admin") {
  const db = await requireDb();
  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning(managedUserColumns);
  return updated as AdminManagedUser | undefined;
}

/** Number of other admins who could keep the console running - admins that are
 * currently banned do not count, since they cannot sign in to help. */
export async function countOtherActiveAdmins(userId: number): Promise<number> {
  const db = await requireDb();
  const [row] = await db
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), isNull(users.bannedAt), ne(users.id, userId)));
  return Number(row?.total ?? 0);
}

/** Ban or unban an account. Banned accounts are signed out and cannot sign back
 * in or use the Telegram bot. Returns the updated row, or undefined if unknown. */
export async function setUserBannedForAdmin(userId: number, banned: boolean) {
  const db = await requireDb();
  const [updated] = await db
    .update(users)
    .set({ bannedAt: banned ? new Date() : null, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning(managedUserColumns);
  return updated as AdminManagedUser | undefined;
}

/** Delete an account and all of its workspace data (chats, files, automations)
 * via cascade. The Neon Auth identity itself is managed by Neon and is not
 * removed; a banned identity that signs in again is simply rejected. */
export async function deleteUserForAdmin(userId: number) {
  const db = await requireDb();
  const [deleted] = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return !!deleted;
}

// ---------------------------------------------------------------------------
// Admin content inspection
//
// Read-only visibility into another account's chats and workspace files.
// Reached only through `adminProcedure`, so every caller is a verified admin.
// ---------------------------------------------------------------------------

/** Newest chats inspected per account. */
const ADMIN_INSPECT_CHATS_LIMIT = 50;
/** Most recent messages kept per inspected chat. */
const ADMIN_INSPECT_MESSAGES_PER_CHAT = 100;
/** Most recent files inspected per account. */
const ADMIN_INSPECT_FILES_LIMIT = 200;
/** Characters of text shown inline before a file needs to be opened fully. */
const ADMIN_INSPECT_PREVIEW_CHARS = 400;

export type AdminInspectedMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
};

export type AdminInspectedChat = {
  id: number;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: AdminInspectedMessage[];
};

export type AdminInspectedFile = {
  id: number;
  name: string;
  folderName: string | null;
  mimeType: string;
  sizeBytes: number;
  updatedAt: Date;
  preview: string;
};

/** Another account's chats with their most recent messages, newest activity first. */
export async function getUserChatsForAdmin(userId: number): Promise<AdminInspectedChat[]> {
  const db = await requireDb();

  const chatRows = await db
    .select({ id: chats.id, title: chats.title, createdAt: chats.createdAt, updatedAt: chats.updatedAt })
    .from(chats)
    .innerJoin(workspaces, eq(chats.workspaceId, workspaces.id))
    .where(eq(workspaces.ownerId, userId))
    .orderBy(desc(chats.updatedAt))
    .limit(ADMIN_INSPECT_CHATS_LIMIT);

  if (chatRows.length === 0) return [];

  // Rank messages per chat so one very active chat cannot crowd the others out
  // of a shared result limit: each selected chat always gets its own newest N.
  const chatIdList = sql.join(chatRows.map(chat => sql`${chat.id}`), sql`, `);
  const rankedResult = (await db.execute(sql`
    SELECT id, "chatId", role, content, "createdAt"
    FROM (
      SELECT id, "chatId", role, content, "createdAt",
             ROW_NUMBER() OVER (PARTITION BY "chatId" ORDER BY "createdAt" DESC, id DESC) AS rn
      FROM chat_messages
      WHERE "chatId" IN (${chatIdList})
    ) ranked
    WHERE rn <= ${ADMIN_INSPECT_MESSAGES_PER_CHAT}
  `)) as unknown as
    | { rows?: Array<{ id: number; chatId: number; role: "user" | "assistant"; content: string; createdAt: Date | string }> }
    | Array<{ id: number; chatId: number; role: "user" | "assistant"; content: string; createdAt: Date | string }>;
  const messageRows = Array.isArray(rankedResult) ? rankedResult : (rankedResult.rows ?? []);

  const messagesByChat = new Map<number, AdminInspectedMessage[]>();
  for (const message of messageRows) {
    const bucket = messagesByChat.get(message.chatId) ?? [];
    bucket.push({ id: message.id, role: message.role, content: message.content, createdAt: new Date(message.createdAt) });
    messagesByChat.set(message.chatId, bucket);
  }

  return chatRows.map(chat => ({
    ...chat,
    messages: (messagesByChat.get(chat.id) ?? []).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    ),
  }));
}

/** Another account's workspace files, newest first, with a short inline preview. */
export async function getUserFilesForAdmin(userId: number): Promise<AdminInspectedFile[]> {
  const db = await requireDb();

  // Compute size and preview in the database: selecting full content for up to
  // 200 files could pull tens of millions of characters into the app.
  const rows = await db
    .select({
      id: workspaceFiles.id,
      name: workspaceFiles.name,
      folderName: workspaceFolders.name,
      mimeType: workspaceFiles.mimeType,
      sizeBytes: sql<number>`length(${workspaceFiles.content})`,
      preview: sql<string>`left(${workspaceFiles.content}, ${ADMIN_INSPECT_PREVIEW_CHARS})`,
      updatedAt: workspaceFiles.updatedAt,
    })
    .from(workspaceFiles)
    .innerJoin(workspaces, eq(workspaceFiles.workspaceId, workspaces.id))
    .leftJoin(workspaceFolders, eq(workspaceFiles.folderId, workspaceFolders.id))
    .where(eq(workspaces.ownerId, userId))
    .orderBy(desc(workspaceFiles.updatedAt))
    .limit(ADMIN_INSPECT_FILES_LIMIT);

  return rows.map(file => ({
    ...file,
    sizeBytes: Number(file.sizeBytes ?? 0),
  }));
}

/** Full content of a single file, but only when it belongs to that account's workspace. */
export async function getUserFileContentForAdmin(userId: number, fileId: number) {
  const db = await requireDb();
  const [file] = await db
    .select({
      id: workspaceFiles.id,
      name: workspaceFiles.name,
      mimeType: workspaceFiles.mimeType,
      content: workspaceFiles.content,
    })
    .from(workspaceFiles)
    .innerJoin(workspaces, eq(workspaceFiles.workspaceId, workspaces.id))
    .where(and(eq(workspaces.ownerId, userId), eq(workspaceFiles.id, fileId)));
  return file;
}
