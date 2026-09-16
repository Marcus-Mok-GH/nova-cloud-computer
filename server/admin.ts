/**
 * Admin console data access. Every function here is reached only through
 * `adminProcedure`, which rejects any caller whose role is not `admin`.
 */
import { and, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
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

/** Number of other admins who could keep the console running — admins that are
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
