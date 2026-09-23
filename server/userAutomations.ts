import { asc, and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { createWorkspaceFileForUser, getOrCreateWorkspace, createChatForUser, listChatsForUser } from "./db";
import { runWorkspaceAgent } from "./workspaceAgent";
import { userAutomations, type UserAutomation } from "../drizzle/schema";

let db: ReturnType<typeof drizzle> | null = null;
async function getDb() { if (!db && process.env.DATABASE_URL) db = drizzle(neon(process.env.DATABASE_URL)); if (!db) throw new Error("The Nova database is unavailable."); return db; }

export const USER_AUTOMATION_CRONS = { hourly: "0 0 * * * *", daily: "0 0 9 * * *", weekdays: "0 0 9 * * 1-5", weekly: "0 0 9 * * 1" } as const;
export type UserAutomationFrequency = keyof typeof USER_AUTOMATION_CRONS | "custom";

function safeAutomation(row: UserAutomation) {
  return { id: row.id, name: row.name, instructions: row.instructions, frequency: row.frequency, scheduleCron: row.scheduleCron, scheduleTimezone: row.scheduleTimezone, executionPrompt: row.executionPrompt, args: row.args, definition: row.definition, enabled: row.enabled, scheduleActive: Boolean(row.scheduleCronTaskUid), lastRunAt: row.lastRunAt, lastError: row.lastError, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function listUserAutomations(ownerId: number) { const database = await getDb(); const workspace = await getOrCreateWorkspace(ownerId); const rows = await database.select().from(userAutomations).where(and(eq(userAutomations.ownerId, ownerId), eq(userAutomations.workspaceId, workspace.id))).orderBy(asc(userAutomations.createdAt)); return rows.map(safeAutomation); }
export async function getUserAutomation(ownerId: number, id: number) { const database = await getDb(); const workspace = await getOrCreateWorkspace(ownerId); return (await database.select().from(userAutomations).where(and(eq(userAutomations.id, id), eq(userAutomations.ownerId, ownerId), eq(userAutomations.workspaceId, workspace.id))).limit(1))[0]; }

export async function createUserAutomation(ownerId: number, input: { name: string; instructions: string; frequency: UserAutomationFrequency; scheduleCron: string; scheduleTimezone: string; executionPrompt: string; args: Record<string, unknown>; definition: Record<string, unknown> }) {
  const database = await getDb(); const workspace = await getOrCreateWorkspace(ownerId);
  const [created] = await database.insert(userAutomations).values({ ownerId, workspaceId: workspace.id, name: input.name, instructions: input.instructions, frequency: input.frequency, scheduleCron: input.scheduleCron, scheduleTimezone: input.scheduleTimezone, executionPrompt: input.executionPrompt, args: input.args, definition: input.definition, enabled: false }).returning();
  if (!created) throw new Error("Nova could not create the automation."); return safeAutomation(created);
}

export async function updateUserAutomation(ownerId: number, id: number, input: { name?: string; instructions?: string; frequency?: UserAutomationFrequency; scheduleCron?: string; scheduleTimezone?: string; executionPrompt?: string; args?: Record<string, unknown>; definition?: Record<string, unknown>; enabled?: boolean }) {
  const database = await getDb(); const existing = await getUserAutomation(ownerId, id); if (!existing) return undefined;
  const update: Partial<typeof userAutomations.$inferInsert> = { updatedAt: new Date() };
  for (const key of ["name", "instructions", "scheduleCron", "scheduleTimezone", "executionPrompt", "args", "definition", "enabled"] as const) { if (input[key] !== undefined) (update as any)[key] = input[key]; }
  if (input.frequency !== undefined) update.frequency = input.frequency;
  const [updated] = await database.update(userAutomations).set(update).where(eq(userAutomations.id, existing.id)).returning(); return updated ? safeAutomation(updated) : undefined;
}
export async function deleteUserAutomation(ownerId: number, id: number) { const database = await getDb(); const existing = await getUserAutomation(ownerId, id); if (!existing) return false; await database.delete(userAutomations).where(eq(userAutomations.id, existing.id)); return true; }
export async function setUserAutomationScheduleTask(ownerId: number, id: number, taskUid: string | null) { const database = await getDb(); const existing = await getUserAutomation(ownerId, id); if (!existing) return undefined; const [updated] = await database.update(userAutomations).set({ scheduleCronTaskUid: taskUid, updatedAt: new Date() }).where(eq(userAutomations.id, existing.id)).returning(); return updated ? safeAutomation(updated) : undefined; }
export async function getUserAutomationForScheduleTask(taskUid: string) { const database = await getDb(); return (await database.select().from(userAutomations).where(eq(userAutomations.scheduleCronTaskUid, taskUid)).limit(1))[0]; }

export async function runUserAutomationForScheduleTask(taskUid: string, now = new Date()) {
  const database = await getDb(); const automation = await getUserAutomationForScheduleTask(taskUid); if (!automation || !automation.enabled) return { skipped: true };
  try {
    const workspace = await getOrCreateWorkspace(automation.ownerId);
    const prompt = `${automation.executionPrompt}\n\nStructured automation arguments:\n${JSON.stringify(automation.args, null, 2)}\n\nExecution constraints:\n${JSON.stringify((automation.definition as Record<string, unknown>)?.constraints ?? {}, null, 2)}\n\nRun time: ${now.toISOString()}\nWorkspace: ${workspace.name}\n\nThis is a scheduled automation run. It must be fully self-directed: use your tools to actually do the work - workspace files, research_web, solve_equation, run_vm_task, code_task, connectors, memory and planning as needed - then end_turn with a concise Markdown report of what was done, what failed, and any follow-up worth knowing. Never invent completed work.`;
    // Self-directed run: the full agent loop with every tool, not a single
    // bare LLM call. Each automation keeps one dedicated chat, so the run
    // history (and the plan it wrote) stays inspectable in the Chats page.
    const chatTitle = `Automation · ${automation.name}`.slice(0, 160);
    const existingChat = (await listChatsForUser(automation.ownerId)).find(chat => chat.title === chatTitle);
    const chat = existingChat ?? (await createChatForUser(automation.ownerId, chatTitle));
    if (!chat) throw new Error("Nova could not open the automation chat.");
    const run = await runWorkspaceAgent(automation.ownerId, chat.id, prompt, { channel: "web" });
    const content = run?.message?.content?.trim() || "Nova completed the automation without a report.";
    const safeName = automation.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "automation";
    const artifact = await createWorkspaceFileForUser(automation.ownerId, { name: `${safeName}-${now.toISOString().slice(0, 10)}.md`, content: `# ${automation.name}\n\n${content}\n`, mimeType: "text/markdown" });
    if (!artifact) throw new Error("Nova could not save the automation report.");
    await database.update(userAutomations).set({ lastRunAt: now, lastError: null, updatedAt: now }).where(eq(userAutomations.id, automation.id));
    return { skipped: false, success: true, artifactId: artifact.id, chatId: chat.id, outOfBudget: Boolean(run?.outOfBudget) };
  } catch (error) { const message = error instanceof Error ? error.message : "Nova could not complete this automation."; await database.update(userAutomations).set({ lastError: message.slice(0, 1200), updatedAt: now }).where(eq(userAutomations.id, automation.id)); return { skipped: false, success: false, error: message }; }
}
