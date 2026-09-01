import { asc, and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { invokeLLM } from "./_core/llm";
import { createWorkspaceFileForUser, getOrCreateWorkspace } from "./db";
import { userAutomations, type UserAutomation } from "../drizzle/schema";

let db: ReturnType<typeof drizzle> | null = null;
async function getDb() {
  if (!db && process.env.DATABASE_URL) db = drizzle(neon(process.env.DATABASE_URL));
  if (!db) throw new Error("The Nova database is unavailable.");
  return db;
}

export const USER_AUTOMATION_CRONS = {
  hourly: "0 0 * * * *",
  daily: "0 0 9 * * *",
  weekdays: "0 0 9 * * 1-5",
  weekly: "0 0 9 * * 1",
} as const;

export type UserAutomationFrequency = keyof typeof USER_AUTOMATION_CRONS;

function safeAutomation(row: UserAutomation) {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    frequency: row.frequency,
    enabled: row.enabled,
    scheduleActive: Boolean(row.scheduleCronTaskUid),
    lastRunAt: row.lastRunAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function workspaceFor(ownerId: number) {
  return getOrCreateWorkspace(ownerId);
}

export async function listUserAutomations(ownerId: number) {
  const database = await getDb();
  const workspace = await workspaceFor(ownerId);
  const rows = await database.select().from(userAutomations)
    .where(and(eq(userAutomations.ownerId, ownerId), eq(userAutomations.workspaceId, workspace.id)))
    .orderBy(asc(userAutomations.createdAt));
  return rows.map(safeAutomation);
}

export async function getUserAutomation(ownerId: number, id: number) {
  const database = await getDb();
  const workspace = await workspaceFor(ownerId);
  return (await database.select().from(userAutomations).where(and(
    eq(userAutomations.id, id), eq(userAutomations.ownerId, ownerId), eq(userAutomations.workspaceId, workspace.id),
  )).limit(1))[0];
}

export async function createUserAutomation(ownerId: number, input: { name: string; instructions: string; frequency: UserAutomationFrequency }) {
  const database = await getDb();
  const workspace = await workspaceFor(ownerId);
  const [created] = await database.insert(userAutomations).values({
    ownerId,
    workspaceId: workspace.id,
    name: input.name,
    instructions: input.instructions,
    frequency: input.frequency,
    scheduleCron: USER_AUTOMATION_CRONS[input.frequency],
    enabled: false,
  }).returning();
  if (!created) throw new Error("Nova could not create the automation.");
  return safeAutomation(created);
}

export async function updateUserAutomation(ownerId: number, id: number, input: { name?: string; instructions?: string; frequency?: UserAutomationFrequency; enabled?: boolean }) {
  const database = await getDb();
  const existing = await getUserAutomation(ownerId, id);
  if (!existing) return undefined;
  const update: Partial<typeof userAutomations.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) update.name = input.name;
  if (input.instructions !== undefined) update.instructions = input.instructions;
  if (input.frequency !== undefined) {
    update.frequency = input.frequency;
    update.scheduleCron = USER_AUTOMATION_CRONS[input.frequency];
  }
  if (input.enabled !== undefined) update.enabled = input.enabled;
  const [updated] = await database.update(userAutomations).set(update).where(eq(userAutomations.id, existing.id)).returning();
  return updated ? safeAutomation(updated) : undefined;
}

export async function deleteUserAutomation(ownerId: number, id: number) {
  const database = await getDb();
  const existing = await getUserAutomation(ownerId, id);
  if (!existing) return false;
  await database.delete(userAutomations).where(eq(userAutomations.id, existing.id));
  return true;
}

export async function setUserAutomationScheduleTask(ownerId: number, id: number, taskUid: string | null) {
  const database = await getDb();
  const existing = await getUserAutomation(ownerId, id);
  if (!existing) return undefined;
  const [updated] = await database.update(userAutomations).set({ scheduleCronTaskUid: taskUid, updatedAt: new Date() }).where(eq(userAutomations.id, existing.id)).returning();
  return updated ? safeAutomation(updated) : undefined;
}

export async function getUserAutomationForScheduleTask(taskUid: string) {
  const database = await getDb();
  return (await database.select().from(userAutomations).where(eq(userAutomations.scheduleCronTaskUid, taskUid)).limit(1))[0];
}

export async function runUserAutomationForScheduleTask(taskUid: string, now = new Date()) {
  const database = await getDb();
  const automation = await getUserAutomationForScheduleTask(taskUid);
  if (!automation || !automation.enabled) return { skipped: true };

  try {
    const workspace = await workspaceFor(automation.ownerId);
    const result = await invokeLLM({
      messages: [
        { role: "system", content: "You are Nova's background automation worker. Complete the user's recurring automation instruction using only the information available in the workspace context. Return a concise Markdown report of what you found, decided, or completed. Do not claim to have performed actions you cannot actually perform." },
        { role: "user", content: `Automation: ${automation.name}\n\nInstructions:\n${automation.instructions}\n\nWorkspace: ${workspace.name}\nRun time: ${now.toISOString()}` },
      ],
    });
    const message = result.choices?.[0]?.message?.content;
    const content = typeof message === "string" ? message : Array.isArray(message) ? message.map(part => typeof part === "string" ? part : String(part?.text ?? "")).join("\n") : "Nova completed the automation without a report.";
    const safeName = automation.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "automation";
    const artifact = await createWorkspaceFileForUser(automation.ownerId, {
      name: `${safeName}-${now.toISOString().slice(0, 10)}.md`,
      content: `# ${automation.name}\n\n${content.trim()}\n`,
      mimeType: "text/markdown",
    });
    if (!artifact) throw new Error("Nova could not save the automation report.");
    await database.update(userAutomations).set({ lastRunAt: now, lastError: null, updatedAt: now }).where(eq(userAutomations.id, automation.id));
    return { skipped: false, success: true, artifactId: artifact.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nova could not complete this automation.";
    await database.update(userAutomations).set({ lastError: message.slice(0, 1200), updatedAt: now }).where(eq(userAutomations.id, automation.id));
    return { skipped: false, success: false, error: message };
  }
}
