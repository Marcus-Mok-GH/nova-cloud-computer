import { and, asc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { type RunningProcess, type RunningProcessPayload, runningProcesses } from "../../drizzle/schema";
import { requireDb } from "./core";

/*
 * The DURABLE RUNNING-PROCESS LEDGER (see server/runningProcesses.ts).
 *
 * Every long-lived background process registers a row before it starts working and beats its heartbeat while it runs.
 * The platform (Vercel) kills serverless invocations mid-flight without any chance to run cleanup code, so in-memory
 * progress dies with the invocation - but the row stays behind, still marked running with a stopped heartbeat, and a
 * later sweep resumes the work from exactly that stored state.
 */

/** What a durable process row tracks: one autonomous editor task, or one segment of a segmented agent run. */
export type RunningProcessKind = "editor" | "agent_run";

/**
 * Registers a process row BEFORE the work starts, so a kill at any later moment leaves a resumable record behind.
 * Best-effort by design: a database hiccup must never block the work itself, the caller just loses the resume guarantee
 * for that one process.
 */
export async function registerRunningProcess(input: { workspaceId: number; chatId?: string | null; kind: RunningProcessKind; payload: RunningProcessPayload }): Promise<RunningProcess | undefined> {
  const db = await requireDb();
  const [created] = await db
    .insert(runningProcesses)
    .values({ workspaceId: input.workspaceId, chatId: input.chatId ?? null, kind: input.kind, payload: input.payload })
    .returning();
  return created;
}

/** Beats the liveness beacon of these live rows; a closed row is never touched. Never throws. */
export async function heartbeatRunningProcesses(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await requireDb();
  await db.update(runningProcesses).set({ heartbeatAt: new Date(), updatedAt: new Date() }).where(and(inArray(runningProcesses.id, ids), eq(runningProcesses.status, "running")));
}

/** Closes a process row (completed/failed); only live rows can be closed. */
export async function finishRunningProcess(processId: number, status: "completed" | "failed", errorMessage?: string) {
  const db = await requireDb();
  const [updated] = await db
    .update(runningProcesses)
    .set({ status, errorMessage: errorMessage?.slice(0, 1200) ?? null, completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(runningProcesses.id, processId), eq(runningProcesses.status, "running")))
    .returning();
  return updated;
}

/** Live rows whose beacon stopped before `staleBefore` - the reaper's resume candidates, oldest first. */
export async function listStaleRunningProcesses(staleBefore: Date, limit: number): Promise<RunningProcess[]> {
  const db = await requireDb();
  return db.select().from(runningProcesses).where(and(eq(runningProcesses.status, "running"), lt(runningProcesses.heartbeatAt, staleBefore))).orderBy(asc(runningProcesses.id)).limit(limit);
}

/**
 * Atomically claims a stale row for its resume. The heartbeat bump makes the claim a single winner even when several
 * sweeps race on the same row: the loser's UPDATE re-evaluates its WHERE against the already-bumped heartbeat and
 * matches nothing. The attempt increment is what bounds the resume budget - a task the platform keeps killing is
 * dead-lettered instead of retried forever. Returns undefined when the row is not claimable (already claimed, closed,
 * still beating, or out of attempts).
 */
export async function claimRunningProcess(processId: number, staleBefore: Date, maxAttempts: number) {
  const db = await requireDb();
  const result = (await db.execute(sql`
    UPDATE "running_processes"
    SET "heartbeatAt" = now(), "updatedAt" = now(), "attempts" = "attempts" + 1
    WHERE "id" = ${processId}
      AND "status" = 'running'
      AND "heartbeatAt" < ${staleBefore.toISOString()}
      AND "attempts" < ${maxAttempts}
    RETURNING "id"
  `)) as unknown as { rows?: Array<{ id?: unknown }> } | Array<{ id?: unknown }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const id = Number(rows[0]?.id);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const [row] = await db.select().from(runningProcesses).where(eq(runningProcesses.id, id)).limit(1);
  return row;
}

/** Dead-letters a process row whose resume budget is spent (or that cannot be resumed at all). */
export async function failRunningProcess(processId: number, errorMessage: string) {
  const db = await requireDb();
  const [updated] = await db
    .update(runningProcesses)
    .set({ status: "failed", errorMessage: errorMessage.slice(0, 1200), completedAt: new Date(), updatedAt: new Date() })
    .where(eq(runningProcesses.id, processId))
    .returning();
  return updated;
}

/**
 * True when a sibling process row for this chat is still alive (its beacon beats after `aliveSince`). The reaper uses it
 * to serialize recovery inside one conversation: a live editor task holds off its parent run's resume, so an interrupted
 * run never continues in parallel with the sub-agent that was already interrupted inside it.
 */
export async function hasLiveRunningProcessForChat(chatId: string, excludeProcessId: number, aliveSince: Date): Promise<boolean> {
  const db = await requireDb();
  const rows = await db
    .select({ id: runningProcesses.id })
    .from(runningProcesses)
    .where(and(eq(runningProcesses.chatId, chatId), eq(runningProcesses.status, "running"), gt(runningProcesses.heartbeatAt, aliveSince), ne(runningProcesses.id, excludeProcessId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * True while ANY editor row for this chat is still open - beating, or stale and waiting to be claimed. The sweep checks
 * this BEFORE claiming an agent-run row: while an interrupted editor task has an open row, the run's continuation must
 * not be dispatched (it would continue in parallel with the sub-agent), and skipping before the claim means the deferred
 * run burns none of its resume attempts while it waits.
 */
export async function hasOpenEditorProcessForChat(chatId: string, excludeProcessId: number): Promise<boolean> {
  const db = await requireDb();
  const rows = await db
    .select({ id: runningProcesses.id })
    .from(runningProcesses)
    .where(and(eq(runningProcesses.chatId, chatId), eq(runningProcesses.status, "running"), eq(runningProcesses.kind, "editor"), ne(runningProcesses.id, excludeProcessId)))
    .limit(1);
  return rows.length > 0;
}
