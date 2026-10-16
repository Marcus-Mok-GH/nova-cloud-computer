import { and, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { agentRuns, agentStopRequests, agentVmRuns, workspaces } from "../../drizzle/schema";
import { requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";
import { getChatForUser } from "./chats";
import { getTelegramCredentialsForUser } from "./telegram";

type AgentVmRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "disabled";

async function getAgentVmRunForUser(ownerId: number, runId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(agentVmRuns).where(and(eq(agentVmRuns.id, runId), eq(agentVmRuns.workspaceId, workspace.id))).limit(1))[0];
}

export function toSafeAgentVmRun(run: typeof agentVmRuns.$inferSelect) {
  return {
    id: run.id,
    provider: run.provider,
    sandboxId: run.sandboxId,
    task: run.task,
    status: run.status,
    resultSummary: run.resultSummary,
    errorMessage: run.errorMessage,
    artifactFileId: run.artifactFileId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export async function listAgentVmRunsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const runs = await db.select().from(agentVmRuns).where(eq(agentVmRuns.workspaceId, workspace.id)).orderBy(desc(agentVmRuns.createdAt)).limit(20);
  return runs.map(toSafeAgentVmRun);
}

export async function createAgentVmRunForUser(ownerId: number, input: { task: string; provider?: "e2b"; chatId?: string | null }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [created] = await db.insert(agentVmRuns).values({ workspaceId: workspace.id, provider: input.provider ?? "e2b", task: input.task, status: "queued", chatId: input.chatId ?? null }).returning();
  if (!created) throw new Error("Nova could not queue the agent VM run.");
  return toSafeAgentVmRun(created);
}

/**
 * Records a fresh stop request, replacing any older one. A `chatId` scopes the
 * stop to one chat's workflows (the web composer's stop button); without one
 * the stop is workspace-wide (Telegram /stop).
 */
export async function requestAgentStopForUser(ownerId: number, chatId?: string | null) {
  const db = await requireDb();
  await db.delete(agentStopRequests).where(eq(agentStopRequests.ownerId, ownerId));
  const [created] = await db.insert(agentStopRequests).values({ ownerId, chatId: chatId ?? null }).returning();
  return created;
}

/** Moves a just-delivered run to awaiting_continue so a continuation endpoint can claim its next segment. */
export async function holdAgentRunForContinue(ownerId: number, runId: number) {
  const db = await requireDb();
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) return undefined;
  const chat = await getChatForUser(ownerId, run.chatId);
  if (!chat) return undefined;
  const [updated] = await db.update(agentRuns).set({ status: "awaiting_continue", updatedAt: new Date() })
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "running"))).returning();
  return updated;
}

export interface AgentRunContinuationClaim {
  runId: number;
  segment: number;
  chatId: string;
  ownerId: number;
  channel: string;
  /** Telegram-only: absent for the web channel, which needs no external delivery step. */
  token?: string;
  /** Telegram-only: absent for the web channel, which needs no external delivery step. */
  telegramChatId?: string;
}

/**
 * Atomically claims the next segment of a segmented run: only an
 * awaiting_continue row at the expected segment flips back to running with
 * segment + 1, so concurrent or redelivered continuation requests can never
 * double-run a segment. There is no segment cap: a run chains segments for as
 * long as its task still has work (the user's /stop ends a runaway at any time).
 *
 * Delivery differs by channel: a Telegram run must resolve a bot token and
 * chat id to push its reply externally, so a claim that cannot resolve them
 * fails outright. A web run needs no external delivery - runWorkspaceAgent
 * already persists its own reply into the chat, and the client polls chat
 * messages - so the claim only needs the workspace owner.
 */
export async function claimAgentRunContinuation(runId: number, expectedSegment: number) {
  const db = await requireDb();
  const [claimed] = await db.update(agentRuns).set({ status: "running", segment: sql`${agentRuns.segment} + 1`, updatedAt: new Date() })
    // No segment cap: agent runs are autonomous and may chain as many
      // segments as the task needs (each claim still flips the row
      // atomically, and /stop can end a runaway at any time).
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "awaiting_continue"), eq(agentRuns.segment, expectedSegment)))
    .returning();
  if (!claimed) return undefined;
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, claimed.workspaceId));
  if (!workspace) return undefined;
  if (claimed.channel === "web") {
    return { runId: claimed.id, segment: claimed.segment, chatId: claimed.chatId, ownerId: workspace.ownerId, channel: "web" } satisfies AgentRunContinuationClaim;
  }
  const credentials = await getTelegramCredentialsForUser(workspace.ownerId).catch(() => undefined);
  if (!credentials?.token || !claimed.notifyChatId) {
    // The continuation could never deliver its reply: close the run rather than leave it stuck awaiting_continue.
    await db.update(agentRuns).set({ status: "failed", errorMessage: "continuation could not resolve its Telegram delivery target", completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, claimed.id));
    return undefined;
  }
  return { runId: claimed.id, segment: claimed.segment, chatId: claimed.chatId, ownerId: workspace.ownerId, channel: "telegram", token: credentials.token, telegramChatId: claimed.notifyChatId } satisfies AgentRunContinuationClaim;
}

/** Returns the live run for a conversation, after verifying it belongs to the owner. */
export async function getActiveAgentRunForChat(ownerId: number, chatId: string) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, chatId);
  if (!chat) return undefined;
  return (await db.select({
    id: agentRuns.id,
    status: agentRuns.status,
    segment: agentRuns.segment,
    startedAt: agentRuns.startedAt,
    updatedAt: agentRuns.updatedAt,
  }).from(agentRuns).where(and(
    eq(agentRuns.chatId, chat.id),
    inArray(agentRuns.status, ["running", "awaiting_continue"]),
  )).orderBy(desc(agentRuns.createdAt)).limit(1))[0];
}

/** Starts a segmented agent run ledger row: one row per user message that begins agent work. */
export async function startAgentRunForUser(ownerId: number, input: { chatId: string; channel?: string; notifyChatId?: string }) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, input.chatId);
  if (!chat) return undefined;
  const [run] = await db.insert(agentRuns).values({
    workspaceId: chat.workspaceId,
    chatId: chat.id,
    channel: input.channel ?? "telegram",
    notifyChatId: input.notifyChatId ?? null,
  }).returning();
  return run;
}

/** Closes a run ledger row (completed/stopped/failed); only live rows can be closed. */
export async function finishAgentRunForUser(ownerId: number, runId: number, status: "completed" | "stopped" | "failed", errorMessage?: string) {
  const db = await requireDb();
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) return undefined;
  const chat = await getChatForUser(ownerId, run.chatId);
  if (!chat) return undefined;
  const [updated] = await db.update(agentRuns).set({
    status,
    errorMessage: errorMessage ?? null,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(agentRuns.id, run.id), inArray(agentRuns.status, ["running", "awaiting_continue"]))).returning();
  return updated;
}

/** True when a stop request was recorded after `startedAt` - either for `chatId`'s workflows or workspace-wide. */
export async function hasAgentStopAfter(ownerId: number, chatId: string | undefined, startedAt: Date) {
  const db = await requireDb();
  const rows = await db
    .select({ id: agentStopRequests.id })
    .from(agentStopRequests)
    .where(and(
      eq(agentStopRequests.ownerId, ownerId),
      gt(agentStopRequests.createdAt, startedAt),
      ...(chatId === undefined ? [] : [or(isNull(agentStopRequests.chatId), eq(agentStopRequests.chatId, chatId))]),
    ))
    .limit(1);
  return rows.length > 0;
}

/** Cancels queued/running agent VM runs - scoped to one chat when `chatId` is given, the whole workspace otherwise. */
export async function cancelActiveAgentVmRunsForUser(ownerId: number, chatId?: string) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const cancelled = await db
    .update(agentVmRuns)
    .set({ status: "cancelled", errorMessage: "Cancelled by a stop request.", completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(agentVmRuns.workspaceId, workspace.id),
      inArray(agentVmRuns.status, ["queued", "running"]),
      ...(chatId === undefined ? [] : [eq(agentVmRuns.chatId, chatId)]),
    ))
    .returning({ id: agentVmRuns.id });
  return cancelled.length;
}

export async function updateAgentVmRunForUser(ownerId: number, runId: number, input: { status?: AgentVmRunStatus; sandboxId?: string | null; resultSummary?: string | null; errorMessage?: string | null; artifactFileId?: number | null; startedAt?: Date | null; completedAt?: Date | null }) {
  const db = await requireDb();
  const run = await getAgentVmRunForUser(ownerId, runId);
  if (!run) return undefined;
  const updateSet: Partial<typeof agentVmRuns.$inferInsert> = { updatedAt: new Date() };
  if (input.status !== undefined) updateSet.status = input.status;
  if (input.sandboxId !== undefined) updateSet.sandboxId = input.sandboxId;
  if (input.resultSummary !== undefined) updateSet.resultSummary = input.resultSummary;
  if (input.errorMessage !== undefined) updateSet.errorMessage = input.errorMessage;
  if (input.artifactFileId !== undefined) updateSet.artifactFileId = input.artifactFileId;
  if (input.startedAt !== undefined) updateSet.startedAt = input.startedAt;
  if (input.completedAt !== undefined) updateSet.completedAt = input.completedAt;
  const [updated] = await db.update(agentVmRuns).set(updateSet).where(eq(agentVmRuns.id, run.id)).returning();
  return updated ? toSafeAgentVmRun(updated) : undefined;
}

export async function getActiveAgentVmRunForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const active = (await db.select().from(agentVmRuns).where(and(eq(agentVmRuns.workspaceId, workspace.id), inArray(agentVmRuns.status, ["queued", "running"]))).limit(1))[0];
  return active ? toSafeAgentVmRun(active) : undefined;
}

export async function countAgentVmRunsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [result] = await db.select({ total: count() }).from(agentVmRuns).where(eq(agentVmRuns.workspaceId, workspace.id));
  return Number(result?.total ?? 0);
}

/** One segmented-run ledger row by id, so a reaper can see whether a killed segment's run is still open. */
export async function getAgentRunById(runId: number) {
  const db = await requireDb();
  return (await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1))[0];
}

/** Closes a live ledger row whose work can no longer be resumed (its resume budget is spent). */
export async function failAgentRunById(runId: number, errorMessage: string) {
  const db = await requireDb();
  const [updated] = await db
    .update(agentRuns)
    .set({ status: "failed", errorMessage: errorMessage.slice(0, 1200), completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, ["running", "awaiting_continue"])))
    .returning();
  return updated;
}
