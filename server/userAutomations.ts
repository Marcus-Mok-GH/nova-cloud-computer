import { asc, and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { invokeLLM } from "./_core/llm";
import { createWorkspaceFileForUser, getOrCreateWorkspace } from "./db";
import { userAutomations, type UserAutomation } from "../drizzle/schema";

let db: ReturnType<typeof drizzle> | null = null;
async function getDb() { if (!db && process.env.DATABASE_URL) db = drizzle(neon(process.env.DATABASE_URL)); if (!db) throw new Error("The Nova database is unavailable."); return db; }

export const USER_AUTOMATION_CRONS = { hourly: "0 0 * * * *", daily: "0 0 9 * * *", weekdays: "0 0 9 * * 1-5", weekly: "0 0 9 * * 1" } as const;
export type UserAutomationFrequency = keyof typeof USER_AUTOMATION_CRONS | "custom";

function safeAutomation(row: UserAutomation) {
  return { id: row.id, name: row.name, instructions: row.instructions, frequency: row.frequency, scheduleCron: row.scheduleCron, scheduleTimezone: row.scheduleTimezone, executionPrompt: row.executionPrompt, args: row.args, definition: row.definition, enabled: row.enabled, scheduleActive: Boolean(row.scheduleCronTaskUid), lastRunAt: row.lastRunAt, lastError: row.lastError, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
async function workspaceFor(ownerId: number) { return getOrCreateWorkspace(ownerId); }

export async function listUserAutomations(ownerId: number) { const database = await getDb(); const workspace = await workspaceFor(ownerId); const rows = await database.select().from(userAutomations).where(and(eq(userAutomations.ownerId, ownerId), eq(userAutomations.workspaceId, workspace.id))).orderBy(asc(userAutomations.createdAt)); return rows.map(safeAutomation); }
export async function getUserAutomation(ownerId: number, id: number) { const database = await getDb(); const workspace = await workspaceFor(ownerId); return (await database.select().from(userAutomations).where(and(eq(userAutomations.id, id), eq(userAutomations.ownerId, ownerId), eq(userAutomations.workspaceId, workspace.id))).limit(1))[0]; }

export async function createUserAutomation(ownerId: number, input: { name: string; instructions: string; frequency: UserAutomationFrequency; scheduleCron: string; scheduleTimezone: string; executionPrompt: string; args: Record<string, unknown>; definition: Record<string, unknown> }) {
  const database = await getDb(); const workspace = await workspaceFor(ownerId);
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
    const workspace = await workspaceFor(automation.ownerId);
    const prompt = `${automation.executionPrompt}\n\nStructured automation arguments:\n${JSON.stringify(automation.args, null, 2)}\n\nExecution constraints:\n${JSON.stringify((automation.definition as Record<string, unknown>)?.constraints ?? {}, null, 2)}\n\nRun time: ${now.toISOString()}\nWorkspace: ${workspace.name}`;
    const result = await invokeLLM({ messages: [{ role: "system", content: "You are Nova's scheduled automation worker. Follow the compiled automation prompt and arguments. Use only capabilities actually available to this worker. Never invent actions, credentials, external access, or completed work. If the requested work cannot be performed, clearly report the limitation instead of pretending. Return a concise Markdown report." }, { role: "user", content: prompt }] });
    const message = result.choices?.[0]?.message?.content;
    const content = typeof message === "string" ? message : Array.isArray(message) ? message.map(part => typeof part === "string" ? part : String(part?.text ?? "")).join("\n") : "Nova completed the automation without a report.";
    const safeName = automation.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "automation";
    const artifact = await createWorkspaceFileForUser(automation.ownerId, { name: `${safeName}-${now.toISOString().slice(0, 10)}.md`, content: `# ${automation.name}\n\n${content.trim()}\n`, mimeType: "text/markdown" });
    if (!artifact) throw new Error("Nova could not save the automation report.");
    await database.update(userAutomations).set({ lastRunAt: now, lastError: null, updatedAt: now }).where(eq(userAutomations.id, automation.id));
    return { skipped: false, success: true, artifactId: artifact.id };
  } catch (error) { const message = error instanceof Error ? error.message : "Nova could not complete this automation."; await database.update(userAutomations).set({ lastError: message.slice(0, 1200), updatedAt: now }).where(eq(userAutomations.id, automation.id)); return { skipped: false, success: false, error: message }; }
}
