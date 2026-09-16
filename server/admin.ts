/**
 * Admin console data access. Every function here is reached only through
 * `adminProcedure`, which rejects any caller whose role is not `admin`.
 */
import { count, desc, eq, inArray } from "drizzle-orm";
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
  createdAt: Date;
  lastSignedIn: Date;
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
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    })
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
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    })
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
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    });
  return updated as AdminManagedUser | undefined;
}
