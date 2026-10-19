/**
 * The coding-specialist tool family: `editor` (runs the autonomous or
 * single-shot coding sub-agent) and `accept_own_coding` (the gate that lets a
 * user accept Nova's own coding while the specialist is down). Both live here
 * together because they share the specialist lifecycle.
 */
import { errorMessage } from "@shared/_core/errors";
import { sleep } from "@shared/timing";
import {
  MIN_CALL_RESERVE_MS,
  runAutonomousCoderTask,
  runCoderTask,
  type CoderOutcome,
  type CoderToolActivity,
} from "../coder";
import { NimConfigError } from "../nim";
import { syncAgentSandbox } from "../sandboxWorkspace";
import { trackRunningProcess } from "../runningProcesses";
import { recordSpecialistAcceptance } from "../workspace/workspaceAgentTypes";
import { createProgressNudge } from "./progress";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolAcceptOwnCoding(
  ctx: ToolCtx
): Promise<ToolExecution> {
  const { gate, ownerId } = ctx;
  if (!gate) {
    return {
      ok: false,
      result:
        "There is no pending coding-specialist acceptance question - continue normally.",
    };
  }
  if (gate.specialistDownThisRun) {
    return {
      ok: false,
      result:
        "The coding specialist failed in this same run, so the user has not had a turn to answer yet. " +
        "Tell the user the specialist is down, ask whether to proceed with Nova's own attempt, and end your turn. " +
        "Only call accept_own_coding in a later conversation turn, after the user explicitly accepted.",
      action: {
        kind: "tool",
        name: "accept_own_coding",
        operation: "failed",
      },
    };
  }
  if (!gate.awaitingAcceptance) {
    return {
      ok: false,
      result:
        "There is no pending coding-specialist acceptance question. Only call this tool when the user has just " +
        "explicitly accepted Nova writing the code itself while the specialist is down.",
      action: {
        kind: "tool",
        name: "accept_own_coding",
        operation: "failed",
      },
    };
  }
  gate.awaitingAcceptance = false;
  gate.blocked = false;
  await recordSpecialistAcceptance(ownerId, gate.chatId, "accepted");
  return {
    ok: true,
    result:
      "Recorded: the user accepted Nova writing this code itself without the coding specialist. " +
      "You may proceed with create_file/edit_file for this task, and say plainly that the result is Nova's own work.",
    action: {
      kind: "tool",
      name: "accept_own_coding",
      operation: "completed",
    },
  };
}

export async function toolEditor(ctx: ToolCtx): Promise<ToolExecution> {
  const {
    args,
    str,
    ownerId,
    computer,
    chatId,
    callId,
    sandbox,
    onProgress,
    deadlineAtMs,
    onSubToolActivity,
  } = ctx;
  const task = str(args.task).trim();
  if (!task) return { ok: false, result: "A coding task is required." };
  const context = str(args.context) || undefined;
  const language = str(args.language) || undefined;
  const startedAt = Date.now();
  // Durable ledger: the specialist task registers a running-process row BEFORE it starts, so when the platform
  // kills this invocation mid-task the reaper reconnects the editor to the same sandbox and finishes the coding
  // work in a fresh invocation - the sub-agent keeps running on its own instead of the main agent having to recall
  // it. Only the autonomous (sandbox) shape is resumable; the single-shot call is one bounded request whose result
  // dies with this invocation by design.
  const process =
    sandbox && chatId
      ? await trackRunningProcess({
          workspaceId: computer.workspace.id,
          chatId,
          kind: "editor",
          payload: { task, context, language },
        }).catch(() => undefined)
      : undefined;
  let processStatus: "completed" | "failed" = "completed";
  // One coding task, two possible shapes: with a live sandbox the
  // specialist works autonomously (it lists, reads and writes workspace
  // files and runs commands itself, and its writes sync back into the
  // durable store); without one - or when the model lacks function
  // calling - it returns complete code for this agent to place. The
  // specialist streams its own steps; the elapsed-time heartbeat only
  // fires when its stream has gone quiet.
  const nudge = createProgressNudge({
    onProgress,
    startedAt,
    stillWorking: elapsed =>
      `The coding specialist is still working - ${elapsed}s elapsed…`,
  });
  const note = nudge.note;
  note(
    sandbox
      ? "The coding specialist is taking over the task - reading the workspace on its own…"
      : "The coding specialist is reading the task…"
  );
  const specialistError = (error: unknown) => {
    // Config problems already carry a clean, user-facing explanation.
    // Anything else is logged for diagnosis and replaced with a fixed
    // message: raw specialist errors can name internal services or
    // endpoints, and this text is fed back into the chat.
    if (error instanceof NimConfigError) return `${error.message}.`;
    console.error("[Editor] specialist failed:", error);
    return "The coding specialist failed unexpectedly. Please try again shortly.";
  };
  const runSpecialist = (): Promise<CoderOutcome> =>
    sandbox
      ? runAutonomousCoderTask({
          task,
          context,
          language,
          sandbox,
          onProgress: note,
          deadlineAtMs,
          // The specialist's own tool calls stream out as real activity
          // rows, namespaced under this editor call's id so they can
          // never collide across editor invocations in one run. Args are
          // repacked into the same { arguments: json } shape every tool
          // row uses, so the client renders them with its usual labels.
          ...(onSubToolActivity
            ? {
                onToolActivity: (activity: CoderToolActivity) => {
                  return onSubToolActivity({
                    id: `${callId}:${activity.id}`,
                    name: activity.name,
                    state: activity.state,
                    args: { arguments: JSON.stringify(activity.args) },
                    ...(activity.summary ? { summary: activity.summary } : {}),
                  });
                },
              }
            : {}),
        })
      : runCoderTask(task, context, language, deadlineAtMs).then(result => ({
          kind: "single",
          ...result,
        }));
  try {
    let outcome: CoderOutcome;
    try {
      outcome = await runSpecialist();
    } catch (error) {
      // A config error is deterministic - no retry helps, and the user
      // must hear exactly which key the operator has to set. Any
      // NimConfigError (missing key, missing model ID for a custom
      // endpoint, refused plaintext transport) is classified by type,
      // not by message text.
      if (error instanceof NimConfigError) throw error;
      const message = errorMessage(error, "");
      if (message.includes("not configured")) throw error;
      // Transient specialist failures (timeouts, NIM hiccups) get one
      // automatic retry, so a single blip never pushes the agent into
      // silently hand-writing the code itself. The retry only runs when
      // the remaining budget still covers the wait plus the reserve the
      // specialist needs to start; otherwise it would begin work after
      // the run deadline and be discarded anyway.
      const retryWaitMs = 1500;
      if (
        deadlineAtMs !== undefined &&
        deadlineAtMs - Date.now() - retryWaitMs < 2 * MIN_CALL_RESERVE_MS
      )
        throw error;
      note("The coding specialist hit a snag - retrying once…");
      await sleep(retryWaitMs);
      outcome = await runSpecialist();
    }
    if (outcome.kind === "single") {
      return {
        ok: true,
        result: outcome.code,
        detail: outcome.code.slice(0, 16000),
        action: {
          kind: "tool",
          name: `editor: ${task.slice(0, 45)}`,
          operation: "completed",
        },
      };
    }
    // Autonomous: the specialist's writes are already in the sandbox -
    // sync them into the durable store now so this run's later rounds
    // (and the workspace UI) see the real files. syncAgentSandbox never
    // throws, but a sync that silently failed is not a success story:
    // the claim below is anchored on the files the specialist wrote
    // (authoritative from the loop), and the end-of-run sync is the
    // backstop - so the instruction to read the files back and verify
    // also catches a file the sync missed.
    await syncAgentSandbox(ownerId, computer.workspace.id, sandbox);
    const fileList =
      outcome.writtenPaths.length > 0
        ? outcome.writtenPaths.join(", ")
        : "(none)";
    return {
      ok: true,
      result:
        `The coding specialist worked autonomously in the sandbox. Its summary: ${outcome.summary}\n\n` +
        `Files it wrote: ${fileList}. Read the changed files back from the workspace, verify the work actually meets the task, fix anything it left broken, and present the result to the user. If a changed file is missing from the workspace, say so plainly instead of improvising it.`,
      detail: `${outcome.summary}\n\nFiles written: ${fileList}`.slice(
        0,
        16000
      ),
      action: {
        kind: "tool",
        name: `editor: ${task.slice(0, 45)}`,
        operation: "completed",
      },
    };
  } catch (error) {
    // The task failed inside this invocation: the durable row closes with it - only a KILLED invocation leaves
    // its row behind for the reaper.
    processStatus = "failed";
    const message = specialistError(error);
    return {
      ok: false,
      result:
        `${message} The specialist is unavailable for this task, so do NOT silently write the code yourself: ` +
        `tell the user exactly that the coding specialist is down, and ask whether to proceed with Nova's own attempt. ` +
        `Non-trivial create_file and edit_file are blocked in this run; only in a LATER conversation turn, once the user has explicitly ` +
        `accepted Nova's own coding, call the accept_own_coding tool to record it, then write the code yourself and say plainly that ` +
        `it is Nova's own work without the specialist, so a broken result never comes as a surprise. ` +
        `Genuinely tiny fixes (a one-line change, a few lines of markup) remain allowed. ` +
        `If the user wants to wait instead, tell them the workspace owner needs to finish setting up the editor.`,
      detail: message,
      specialistDown: true,
      action: {
        kind: "tool",
        name: `editor: ${task.slice(0, 45)}`,
        operation: "failed",
      },
    };
  } finally {
    nudge.stop();
    // Close the durable row for this task; a killed invocation never reaches this line, which is exactly how its
    // row becomes resumable.
    await process?.finish(processStatus);
  }
}
