import { and, asc, desc, eq } from "drizzle-orm";
import { automationRuns, automations } from "../../drizzle/schema";
import { requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";

type AutomationKind = "workspace_digest";
type AutomationRunStatus = "running" | "succeeded" | "failed" | "skipped";

function toSafeAutomation(automation: typeof automations.$inferSelect) {
  return {
    id: automation.id,
    kind: automation.kind,
    enabled: automation.enabled,
    scheduleActive: Boolean(automation.scheduleCronTaskUid),
    lastRunAt: automation.lastRunAt,
    lastError: automation.lastError,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
  };
}

function toSafeAutomationRun(run: typeof automationRuns.$inferSelect) {
  return {
    id: run.id,
    automationId: run.automationId,
    runKey: run.runKey,
    status: run.status,
    summary: run.summary,
    errorMessage: run.errorMessage,
    artifactFileId: run.artifactFileId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export async function getOrCreateAutomationForUser(ownerId: number, kind: AutomationKind = "workspace_digest") {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const ownership = and(eq(automations.ownerId, ownerId), eq(automations.workspaceId, workspace.id), eq(automations.kind, kind));
  const existing = (await db.select().from(automations).where(ownership).limit(1))[0];
  if (existing) return toSafeAutomation(existing);
  await db.insert(automations).values({ ownerId, workspaceId: workspace.id, kind, enabled: false }).onConflictDoNothing();
  const created = (await db.select().from(automations).where(ownership).limit(1))[0];
  if (!created) throw new Error("Nova could not create the workspace automation.");
  return toSafeAutomation(created);
}

export async function listAutomationRecordsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  await getOrCreateAutomationForUser(ownerId);
  return db.select().from(automations).where(and(
    eq(automations.ownerId, ownerId),
    eq(automations.workspaceId, workspace.id),
  )).orderBy(asc(automations.createdAt));
}

export async function listAutomationsForUser(ownerId: number) {
  return (await listAutomationRecordsForUser(ownerId)).map(toSafeAutomation);
}

export async function getAutomationRecordForUser(ownerId: number, automationId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(automations).where(and(
    eq(automations.id, automationId),
    eq(automations.ownerId, ownerId),
    eq(automations.workspaceId, workspace.id),
  )).limit(1))[0];
}

export async function updateAutomationForUser(ownerId: number, automationId: number, input: { enabled: boolean }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [updated] = await db.update(automations).set({ enabled: input.enabled, updatedAt: new Date() }).where(and(
    eq(automations.id, automationId),
    eq(automations.ownerId, ownerId),
    eq(automations.workspaceId, workspace.id),
  )).returning();
  return updated ? toSafeAutomation(updated) : undefined;
}

/** Stores the opaque task ID only after the current account has been authorized for the automation. */
export async function setAutomationScheduleTaskForUser(ownerId: number, automationId: number, scheduleCronTaskUid: string | null) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [updated] = await db.update(automations).set({ scheduleCronTaskUid, updatedAt: new Date() }).where(and(
    eq(automations.id, automationId),
    eq(automations.ownerId, ownerId),
    eq(automations.workspaceId, workspace.id),
  )).returning();
  return updated ? toSafeAutomation(updated) : undefined;
}

/** Resolves only the account-owned automation authenticated by the scheduler's opaque task ID. */
export async function getAutomationForScheduleTask(scheduleCronTaskUid: string) {
  const db = await requireDb();
  return (await db.select().from(automations).where(eq(automations.scheduleCronTaskUid, scheduleCronTaskUid)).limit(1))[0];
}

export async function listAutomationRunsForUser(ownerId: number, automationId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const automation = (await db.select().from(automations).where(and(
    eq(automations.id, automationId),
    eq(automations.ownerId, ownerId),
    eq(automations.workspaceId, workspace.id),
  )).limit(1))[0];
  if (!automation) return [];
  const runs = await db.select().from(automationRuns).where(and(
    eq(automationRuns.automationId, automation.id),
    eq(automationRuns.ownerId, ownerId),
    eq(automationRuns.workspaceId, workspace.id),
  )).orderBy(desc(automationRuns.createdAt)).limit(12);
  return runs.map(toSafeAutomationRun);
}

export async function claimAutomationRun(input: { automationId: number; ownerId: number; workspaceId: number; runKey: string }) {
  const db = await requireDb();
  const [created] = await db.insert(automationRuns).values({
    automationId: input.automationId,
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    runKey: input.runKey,
    status: "running",
  }).onConflictDoUpdate({
    target: [automationRuns.automationId, automationRuns.runKey],
    set: { status: "running", summary: null, errorMessage: null, completedAt: null, updatedAt: new Date() },
    setWhere: and(
      eq(automationRuns.ownerId, input.ownerId),
      eq(automationRuns.workspaceId, input.workspaceId),
      eq(automationRuns.status, "failed"),
    ),
  }).returning();
  return created ? toSafeAutomationRun(created) : undefined;
}

export async function updateAutomationRun(input: { automationId: number; ownerId: number; workspaceId: number; runId: number; status: AutomationRunStatus; summary?: string | null; errorMessage?: string | null; artifactFileId?: number | null; completedAt?: Date | null }) {
  const db = await requireDb();
  const [updated] = await db.update(automationRuns).set({
    status: input.status,
    summary: input.summary,
    errorMessage: input.errorMessage,
    artifactFileId: input.artifactFileId,
    completedAt: input.completedAt,
    updatedAt: new Date(),
  }).where(and(
    eq(automationRuns.id, input.runId),
    eq(automationRuns.automationId, input.automationId),
    eq(automationRuns.ownerId, input.ownerId),
    eq(automationRuns.workspaceId, input.workspaceId),
  )).returning();
  return updated ? toSafeAutomationRun(updated) : undefined;
}

export async function updateAutomationScheduleState(input: { automationId: number; ownerId: number; workspaceId: number; lastRunAt?: Date | null; lastError?: string | null }) {
  const db = await requireDb();
  const [updated] = await db.update(automations).set({
    lastRunAt: input.lastRunAt,
    lastError: input.lastError,
    updatedAt: new Date(),
  }).where(and(
    eq(automations.id, input.automationId),
    eq(automations.ownerId, input.ownerId),
    eq(automations.workspaceId, input.workspaceId),
  )).returning();
  return updated ? toSafeAutomation(updated) : undefined;
}
