/**
 * The shell tool family: run_bash (live workspace sandbox) and run_vm_task
 * (fresh agent VM run). Both need the run's sandbox state to decide whether a
 * workspace restore is still needed.
 */
import { startAgentVmRun } from "../agentVm";
import { runBashOnSandbox } from "../sandboxWorkspace";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolRunBash(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, sandbox } = ctx;
  const command = str(args.command);
  if (!command) return { ok: false, result: "A bash command is required." };
  if (!sandbox)
    return {
      ok: false,
      result:
        "The workspace sandbox is not available right now - it either failed to wake or it is not set up on this workspace yet. Use run_vm_task for shell work instead, and tell the user the sandbox needs to be set up first.",
      action: { kind: "vm", name: "bash", operation: "disabled" },
    };
  const bash = await runBashOnSandbox(sandbox, command);
  return {
    ok: bash.ok,
    result: bash.result,
    detail: bash.result.slice(0, 16000),
    action: {
      kind: "vm",
      name: "bash",
      operation: bash.ok ? "completed" : "failed",
    },
  };
}

export async function toolRunVmTask(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId, chatId, sandbox } = ctx;
  const task = str(args.task);
  if (!task) return { ok: false, result: "A task is required." };
  const started = await startAgentVmRun(
    ownerId,
    {
      task,
      code: str(args.code) || undefined,
      chatId,
    },
    // The sandbox already woke with this run and its files are current, so a
    // mid-run restore (which wipes and re-uploads the workspace, losing
    // bash-created files) must not run again.
    { skipRestore: Boolean(sandbox) }
  );
  if (!started.configured)
    return {
      ok: false,
      result: started.message,
      action: { kind: "vm", name: "E2B", operation: "disabled" },
    };
  return {
    ok: true,
    result: started.message,
    action: {
      kind: "vm",
      name: `run #${started.run?.id ?? ""}`,
      operation: "completed",
    },
  };
}
