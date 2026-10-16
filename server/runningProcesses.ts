/**
 * Durable running-process recovery.
 *
 * Vercel kills serverless invocations mid-flight (maxDuration, deploys, OOM)
 * without running any cleanup code, so in-memory progress dies with the
 * invocation. Every long-lived process - an agent-run segment, an autonomous
 * editor (coding specialist) task - therefore registers a row in
 * `running_processes` BEFORE it starts working and beats the row's heartbeat
 * while it runs (see trackRunningProcess). A killed process leaves its row
 * behind: still `running`, heartbeat frozen. That row is the durable record
 * of what was being done.
 *
 * A sweep (reapOrphanedRunningProcesses) finds rows whose heartbeat stopped
 * and resumes them in a FRESH invocation, claiming each row atomically so
 * only one sweep ever resumes a given process. An interrupted editor task
 * thus keeps running - reconnected to the same persistent sandbox - without
 * the main agent having to recall its sub-agents, and an interrupted agent
 * run chains a continuation segment through the existing /api/agent/continue
 * machinery. Every row carries a small resume budget, so a task the platform
 * keeps killing is dead-lettered instead of retried forever.
 */
import { createHmac } from "node:crypto";
import type { RunningProcess, RunningProcessPayload } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { trackBackgroundWork } from "./backgroundWork";
import {
  appendChatMessageForUser,
  claimRunningProcess,
  failAgentRunById,
  failRunningProcess,
  finishRunningProcess,
  getAgentRunById,
  getChatForUser,
  getWorkspaceById,
  hasAgentStopAfter,
  hasLiveRunningProcessForChat,
  hasOpenEditorProcessForChat,
  heartbeatRunningProcesses,
  holdAgentRunForContinue,
  listStaleRunningProcesses,
  registerRunningProcess,
  type RunningProcessKind,
} from "./db";

/** How often a live process beats its database heartbeat. */
export const PROCESS_HEARTBEAT_INTERVAL_MS = 20_000;
/** A still-running row whose beacon is older than this is a process the platform killed. */
export const PROCESS_STALE_AFTER_MS = 60_000;
/** How many times one process may be resumed before it is dead-lettered. */
export const MAX_PROCESS_RESUME_ATTEMPTS = 2;
/** How many stale rows one sweep dispatches, so recovery spreads over fresh invocations instead of one long one. */
export const RESUME_BATCH_LIMIT = 3;
/** Minimum gap between ledger sweeps per warm instance (any request traffic may ask for one). */
const RECOVERY_KICK_INTERVAL_MS = 60_000;
/** How often the sweep retries a dropped resume self-call before rescheduling is abandoned for this row. */
const RESUME_SELF_CALL_ATTEMPTS = 3;
/** Pause between resume self-call attempts. */
const RESUME_SELF_CALL_RETRY_DELAY_MS = 1_000;
/** Cap for code posted back to the chat when a resume degraded to the single-shot specialist. */
const SINGLE_SHOT_CHAT_LIMIT = 16_000;

export type RunningProcessHandle = {
  id: number;
  /** Beats the row's heartbeat once, outside the regular interval. */
  heartbeat: () => void;
  /** Closes the row and stops the beacon. Idempotent; never throws. */
  finish: (
    status: "completed" | "failed",
    errorMessage?: string
  ) => Promise<void>;
};

/**
 * Registers the durable row for work that is about to start, and beats its
 * heartbeat for as long as the work lives. Returns undefined when the row
 * could not be registered: the work itself must never be blocked by the
 * ledger, the caller just loses the resume guarantee for this one process.
 */
export async function trackRunningProcess(input: {
  workspaceId: number;
  chatId?: string | null;
  kind: RunningProcessKind;
  payload: RunningProcessPayload;
}): Promise<RunningProcessHandle | undefined> {
  let row: RunningProcess | undefined;
  try {
    row = await registerRunningProcess(input);
  } catch (error) {
    console.error(
      "[Running processes] could not register a process row:",
      error instanceof Error ? error.message : error
    );
  }
  if (!row) return undefined;
  const id = row.id;
  const beat = () => {
    void heartbeatRunningProcesses([id]).catch(() => {});
  };
  const timer = setInterval(beat, PROCESS_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  let closed = false;
  return {
    id,
    heartbeat: beat,
    finish: async (status, errorMessage) => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      try {
        await finishRunningProcess(id, status, errorMessage);
      } catch {}
    },
  };
}

let lastRecoveryKickAtMs = 0;

/** Clears the per-instance sweep throttle so tests can exercise the kick window. */
export function resetRunningProcessRecoveryForTests(): void {
  lastRecoveryKickAtMs = 0;
}

/**
 * Asks a fresh invocation to sweep the ledger and resume whatever the
 * platform killed. Throttled per instance - the Vercel catch-all calls this
 * on any API traffic - so warm instances only pay for one cheap SELECT a
 * minute. Never throws and never blocks the caller.
 */
export function kickRunningProcessRecovery(): void {
  const now = Date.now();
  if (now - lastRecoveryKickAtMs < RECOVERY_KICK_INTERVAL_MS) return;
  lastRecoveryKickAtMs = now;
  trackBackgroundWork(
    reapOrphanedRunningProcesses().catch(error =>
      console.error(
        "[Running processes] sweep failed:",
        error instanceof Error ? error.message : error
      )
    )
  );
}

/** Editor rows sort first: while one is alive for a chat, its parent run defers to it. */
function kindPriority(kind: string): number {
  return kind === "editor" ? 0 : 1;
}

/**
 * One pass over the ledger: dead-letters rows that burned their resume
 * budget, and dispatches the rest - editor tasks first, so a resumed
 * sub-agent always owns the conversation until it finishes (an interrupted
 * run's continuation then starts from a chat that already contains the
 * sub-agent's result, and never runs in parallel with it). Each resume is
 * dispatched to a fresh invocation, which claims the row atomically and runs
 * it with its own serverless budget.
 */
export async function reapOrphanedRunningProcesses(): Promise<{
  dispatched: number;
}> {
  const staleBefore = new Date(Date.now() - PROCESS_STALE_AFTER_MS);
  const candidates = await listStaleRunningProcesses(
    staleBefore,
    RESUME_BATCH_LIMIT
  ).catch(() => [] as RunningProcess[]);
  if (candidates.length === 0) return { dispatched: 0 };
  const ordered = [...candidates].sort(
    (a, b) => kindPriority(a.kind) - kindPriority(b.kind) || a.id - b.id
  );
  let dispatched = 0;
  for (const candidate of ordered) {
    if (candidate.attempts >= MAX_PROCESS_RESUME_ATTEMPTS) {
      await closeExhaustedProcess(candidate).catch(() => {});
      continue;
    }
    // Defer an interrupted run while its editor sub-agent still owns the
    // conversation. The check happens BEFORE the claim, so waiting for the
    // editor to finish costs the run none of its resume attempts - the next
    // sweep picks the run up once the editor row closes.
    if (
      candidate.kind === "agent_run" &&
      candidate.chatId &&
      (await hasOpenEditorProcessForChat(candidate.chatId, candidate.id).catch(
        () => false
      ))
    )
      continue;
    if (await dispatchResume(candidate, staleBefore)) dispatched += 1;
  }
  return { dispatched };
}

/** Hands one claimed row to a fresh invocation, or resumes it in-process when this deployment has no self-invocation target (local dev, tests). */
async function dispatchResume(
  process: RunningProcess,
  staleBefore: Date
): Promise<boolean> {
  const secret = ENV.agentContinueSecret;
  if (secret && ENV.publicBaseUrl) {
    for (let attempt = 1; attempt <= RESUME_SELF_CALL_ATTEMPTS; attempt += 1) {
      if (await callResumeEndpointOnce(secret, process.id)) return true;
      if (attempt < RESUME_SELF_CALL_ATTEMPTS)
        await new Promise(resolve =>
          setTimeout(resolve, RESUME_SELF_CALL_RETRY_DELAY_MS)
        );
    }
    return false;
  }
  const claimed = await claimRunningProcess(
    process.id,
    staleBefore,
    MAX_PROCESS_RESUME_ATTEMPTS
  ).catch(() => undefined);
  if (!claimed) return false;
  trackBackgroundWork(
    resumeRunningProcess(claimed).catch(error =>
      console.error(
        "[Running processes] inline resume failed:",
        error instanceof Error ? error.message : error
      )
    )
  );
  return true;
}

async function callResumeEndpointOnce(
  secret: string,
  processId: number
): Promise<boolean> {
  const body = JSON.stringify({ processId });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `${ENV.publicBaseUrl}/api/agent/process/resume`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nova-signature": `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
      }
    );
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Dead-letters a row whose resume budget is spent, telling the user (or closing the run) honestly. */
async function closeExhaustedProcess(process: RunningProcess): Promise<void> {
  await failRunningProcess(
    process.id,
    "the platform killed this process on every resume attempt"
  );
  if (process.kind === "agent_run" && process.payload.runId) {
    await failAgentRunById(
      process.payload.runId,
      "the platform killed this run on every automatic resume attempt - send the message again to retry"
    ).catch(() => {});
    return;
  }
  if (process.kind === "editor" && process.chatId) {
    const workspace = await getWorkspaceById(process.workspaceId).catch(
      () => undefined
    );
    if (!workspace) return;
    await appendChatMessageForUser(workspace.ownerId, {
      chatId: process.chatId,
      role: "assistant",
      content:
        "⚠️ A coding task was interrupted by the platform and could not be finished after several automatic resume attempts. " +
        "Ask the user whether to retry the task, and delegate it again as a fresh, smaller coding task.",
    }).catch(() => {});
  }
}

/**
 * Resumes one CLAIMED process row (the caller - the resume endpoint or the
 * inline fallback - already won the atomic claim and charged one attempt).
 * Always sweeps again afterwards: another stale row may be waiting behind the
 * one just handled, including a parent run that deferred while this row was
 * live.
 */
export async function resumeRunningProcess(
  process: RunningProcess
): Promise<void> {
  try {
    if (process.kind === "editor") await resumeEditorProcess(process);
    else if (process.kind === "agent_run") await resumeAgentRunSegment(process);
    else
      await failRunningProcess(
        process.id,
        `unknown process kind: ${process.kind.slice(0, 60)}`
      ).catch(() => {});
  } catch (error) {
    console.error(
      `[Running processes] resume of ${process.kind} process ${process.id} failed:`,
      error instanceof Error ? error.message : error
    );
    // Only announce the failure on the final attempt: an earlier failure may
    // still be rescued by the next resume, and a note per attempt would spam
    // the conversation while the work is simply queued to continue.
    await finishRunningProcess(
      process.id,
      "failed",
      error instanceof Error ? error.message : String(error)
    ).catch(() => {});
    if (process.attempts >= MAX_PROCESS_RESUME_ATTEMPTS)
      await announceResumeFailure(process).catch(() => {});
  } finally {
    // Allow the follow-up sweep to run immediately (this instance just did
    // the work, so the per-instance throttle would otherwise delay it).
    lastRecoveryKickAtMs = 0;
    kickRunningProcessRecovery();
  }
}

/** Posts a plain-language note when a process can no longer be resumed at all. */
async function announceResumeFailure(process: RunningProcess): Promise<void> {
  if (process.kind !== "editor" || !process.chatId) return;
  const workspace = await getWorkspaceById(process.workspaceId).catch(
    () => undefined
  );
  if (!workspace) return;
  await appendChatMessageForUser(workspace.ownerId, {
    chatId: process.chatId,
    role: "assistant",
    content:
      "⚠️ An interrupted coding task could not be resumed automatically. " +
      "Tell the user plainly, then delegate the remaining coding work again as a fresh task.",
  }).catch(() => {});
}

/**
 * Reconnects the interrupted editor task to its persistent sandbox and runs
 * the specialist to completion, exactly as the killed invocation would have:
 * the sandbox kept its disk across the kill (and any writes the specialist
 * had already made), so the resume continues from where the work stopped.
 * The result lands in the chat, so nobody has to recall the sub-agent.
 */
async function resumeEditorProcess(process: RunningProcess): Promise<void> {
  const { task, context, language } = process.payload;
  const chatId = process.chatId;
  const trimmedTask = task?.trim();
  if (!trimmedTask || !chatId) {
    await failRunningProcess(
      process.id,
      "the stored editor task could not be resumed (its payload was incomplete)"
    ).catch(() => {});
    return;
  }
  const workspace = await getWorkspaceById(process.workspaceId).catch(
    () => undefined
  );
  if (!workspace) {
    await failRunningProcess(
      process.id,
      "the workspace no longer exists"
    ).catch(() => {});
    return;
  }
  // A stop requested while the process was dead means the user abandoned the
  // work: silently reviving it would be wrong.
  if (
    await hasAgentStopAfter(workspace.ownerId, chatId, process.startedAt).catch(
      () => false
    )
  ) {
    await failRunningProcess(
      process.id,
      "stopped by the user while the process was dead"
    ).catch(() => {});
    return;
  }
  // Reconnect (no restore): the persistent sandbox still holds the partial
  // work the killed specialist wrote, and a durable-store restore would
  // overwrite it.
  const { ensurePersistentSandbox, getE2BClient } = await import("./e2b");
  const client = getE2BClient();
  const sandbox = client
    ? await ensurePersistentSandbox(
        client,
        workspace.id,
        workspace.ownerId,
        workspace.persistentSandboxId ?? null
      ).catch(() => undefined)
    : undefined;
  if (!sandbox) {
    await finishRunningProcess(
      process.id,
      "failed",
      "the workspace sandbox could not be reopened for the resume"
    ).catch(() => {});
    await appendChatMessageForUser(workspace.ownerId, {
      chatId,
      role: "assistant",
      content:
        "⚠️ A coding task was interrupted and its workspace sandbox could not be reopened, so the work could not be resumed automatically. " +
        "Ask the user whether to retry it.",
    }).catch(() => {});
    return;
  }
  const { runAutonomousCoderTask } = await import("./coder");
  const { MAX_RUN_BUDGET_MS } = await import("./workspace/workspaceAgent");
  // Beat the heartbeat while the specialist works, exactly like the killed
  // invocation did: a resumed process must not look dead to the next sweep.
  const beat = setInterval(() => {
    void heartbeatRunningProcesses([process.id]).catch(() => {});
  }, PROCESS_HEARTBEAT_INTERVAL_MS);
  beat.unref?.();
  let outcome: Awaited<ReturnType<typeof runAutonomousCoderTask>>;
  try {
    outcome = await runAutonomousCoderTask({
      task: trimmedTask,
      context,
      language,
      sandbox,
      deadlineAtMs: Date.now() + MAX_RUN_BUDGET_MS,
    });
  } finally {
    clearInterval(beat);
  }
  // The specialist's writes live in the sandbox (its write_file calls are
  // mirrored into the durable store as they happen, and this end-of-resume
  // sync backstops everything else, e.g. files created by run_command).
  const { syncAgentSandbox } = await import("./sandboxWorkspace");
  await syncAgentSandbox(workspace.ownerId, workspace.id, sandbox);
  const summary =
    outcome.kind === "single"
      ? outcome.code.slice(0, SINGLE_SHOT_CHAT_LIMIT)
      : outcome.summary;
  const fileList =
    outcome.kind === "autonomous"
      ? outcome.writtenPaths.length > 0
        ? outcome.writtenPaths.join(", ")
        : "(none)"
      : undefined;
  await finishRunningProcess(process.id, "completed").catch(() => {});
  await appendChatMessageForUser(workspace.ownerId, {
    chatId,
    role: "assistant",
    content:
      `🔁 An interrupted coding task resumed automatically and finished: ${trimmedTask.slice(0, 200)}\n\n${summary}` +
      (fileList !== undefined ? `\n\nFiles written: ${fileList}.` : ""),
  }).catch(() => {});
}

/**
 * Resumes the agent-run segment whose invocation was killed, through the
 * existing continuation chain: the open ledger row is moved to
 * awaiting_continue (when the kill left it mid-segment) and the next segment
 * is scheduled, which claims it atomically and runs with a fresh budget. The
 * resumed segment picks the task up from the chat history - by then any
 * interrupted editor task has already resumed and posted its own result.
 */
async function resumeAgentRunSegment(process: RunningProcess): Promise<void> {
  const runId = process.payload.runId;
  if (!runId) {
    await failRunningProcess(
      process.id,
      "the stored agent run could not be resumed (its payload was incomplete)"
    ).catch(() => {});
    return;
  }
  const run = await getAgentRunById(runId).catch(() => undefined);
  // The run already ended (completed, stopped, or failed): nothing to resume.
  if (
    !run ||
    (run.status !== "running" && run.status !== "awaiting_continue")
  ) {
    await finishRunningProcess(process.id, "completed").catch(() => {});
    return;
  }
  // A later segment already took over after this one died, so this row is
  // history - resuming it would run two segments in parallel on one chat.
  if (run.segment > (process.payload.segment ?? -1)) {
    await finishRunningProcess(process.id, "completed").catch(() => {});
    return;
  }
  // While a live sub-agent process is still working in this conversation
  // (typically the editor task interrupted inside this very segment), hold
  // off: the continuation would otherwise run in parallel with it. The next
  // sweep picks the run up once that process closes.
  if (
    run.chatId &&
    (await hasLiveRunningProcessForChat(
      run.chatId,
      process.id,
      new Date(Date.now() - PROCESS_STALE_AFTER_MS)
    ).catch(() => false))
  )
    return;
  const workspace = await getWorkspaceById(process.workspaceId).catch(
    () => undefined
  );
  if (!workspace) {
    await failRunningProcess(
      process.id,
      "the workspace no longer exists"
    ).catch(() => {});
    return;
  }
  // A stop requested while the segment was dead: do not resurrect it.
  if (
    await hasAgentStopAfter(
      workspace.ownerId,
      run.chatId,
      process.startedAt
    ).catch(() => false)
  ) {
    await finishRunningProcess(
      process.id,
      "failed",
      "stopped by the user while the process was dead"
    ).catch(() => {});
    return;
  }
  if (!process.payload.chainable) {
    // Team chats deliberately do not chain continuations (a continuation
    // would re-run the whole roster), so a killed team segment cannot be
    // resumed automatically - say so plainly instead of looping.
    await failRunningProcess(
      process.id,
      "this run does not chain continuation segments"
    ).catch(() => {});
    await failAgentRunById(
      runId,
      "the platform killed this run and it cannot be resumed automatically - send the message again to retry"
    ).catch(() => {});
    return;
  }
  if (run.status === "running") {
    const held = await holdAgentRunForContinue(workspace.ownerId, runId).catch(
      () => undefined
    );
    if (!held) {
      // The chat vanished or the row closed underneath us: nothing to resume.
      await finishRunningProcess(process.id, "completed").catch(() => {});
      return;
    }
  }
  // Dynamic import: agentRuns pulls in the whole agent loop, which imports
  // this module back through the tool executor - keeping the cycle lazy
  // (exactly like the peak-queue worker) keeps the module graph acyclic at
  // load time.
  const { scheduleContinuation } = await import("./agentRuns");
  const scheduled = await scheduleContinuation(runId, run.segment).catch(
    () => false
  );
  if (!scheduled) {
    // Leave the row running with its bumped heartbeat: it goes stale again in
    // a minute and the next sweep retries, until the attempt cap dead-letters
    // it and closes the run honestly.
    return;
  }
  await finishRunningProcess(process.id, "completed").catch(() => {});
}

/** Exposed for the chat helpers that register an agent-run segment as a durable process. */
export async function trackAgentRunProcess(input: {
  ownerId: number;
  chatId: string;
  runId: number;
  segment: number;
  chainable: boolean;
}): Promise<RunningProcessHandle | undefined> {
  const chat = await getChatForUser(input.ownerId, input.chatId).catch(
    () => undefined
  );
  if (!chat) return undefined;
  return trackRunningProcess({
    workspaceId: chat.workspaceId,
    chatId: chat.id,
    kind: "agent_run",
    payload: {
      runId: input.runId,
      segment: input.segment,
      chainable: input.chainable,
    },
  });
}
