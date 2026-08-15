import {
  createAgentVmRunForUser,
  createWorkspaceFileForUser,
  countAgentVmRunsForUser,
  getActiveAgentVmRunForUser,
  getWorkspaceComputer,
  listAgentVmRunsForUser,
  updateAgentVmRunForUser,
} from "./db";
import { getDaytonaClient, isDaytonaConfigured, runDaytonaTask } from "./daytona";

const ERROR_LIMIT = 1000;
const DEFAULT_TRIAL_RUN_CAP = 50;

function getTrialRunCap() {
  const parsed = Number.parseInt(process.env.DAYTONA_TRIAL_MAX_RUNS ?? String(DEFAULT_TRIAL_RUN_CAP), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 500) : DEFAULT_TRIAL_RUN_CAP;
}

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : "Nova could not complete that agent VM run.";
  return value.replace(/DAYTONA_API_KEY\s*=\s*\S+/gi, "[private credential]").slice(0, ERROR_LIMIT);
}

export async function getAgentVmStatus(ownerId: number) {
  const usedRuns = await countAgentVmRunsForUser(ownerId);
  const maxRuns = getTrialRunCap();
  return {
    configured: isDaytonaConfigured(),
    provider: "daytona" as const,
    policy: "configured_run_cap" as const,
    limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" as const },
    allowance: { usedRuns, maxRuns, remainingRuns: Math.max(0, maxRuns - usedRuns), exhausted: usedRuns >= maxRuns },
  };
}

export async function listAgentVmRuns(ownerId: number) {
  return listAgentVmRunsForUser(ownerId);
}

export async function startAgentVmRun(ownerId: number, input: { task: string; code?: string }) {
  const client = getDaytonaClient();
  if (!client) {
    return {
      configured: false as const,
      run: null,
      message: "Daytona is not connected yet. An administrator must add the server-only Daytona API key before Nova can start agent VMs.",
    };
  }
  const usedRuns = await countAgentVmRunsForUser(ownerId);
  const maxRuns = getTrialRunCap();
  if (usedRuns >= maxRuns) {
    return {
      configured: true as const,
      run: null,
      message: "Nova’s configured Daytona run cap is reached. New VM runs are blocked until an administrator explicitly raises the cap.",
    };
  }
  const active = await getActiveAgentVmRunForUser(ownerId);
  if (active) throw new Error("This workspace already has an active agent VM run. Wait for it to finish before starting another.");
  const computer = await getWorkspaceComputer(ownerId);
  const run = await createAgentVmRunForUser(ownerId, { task: input.task });
  try {
    const result = await runDaytonaTask(client, {
      runId: run.id,
      workspaceId: computer.workspace.id,
      ownerId,
      task: input.task,
      code: input.code,
      files: computer.files,
      folders: computer.folders,
      onSandboxCreated: async sandboxId => {
        await updateAgentVmRunForUser(ownerId, run.id, { status: "running", sandboxId, startedAt: new Date() });
      },
    });
    const artifact = await createWorkspaceFileForUser(ownerId, {
      name: `nova-run-${run.id}.txt`,
      content: `Task: ${input.task}\n\n${result.output}\n`,
      mimeType: "text/plain",
    });
    const completed = await updateAgentVmRunForUser(ownerId, run.id, {
      status: "succeeded",
      resultSummary: result.output,
      artifactFileId: artifact?.id ?? null,
      completedAt: new Date(),
    });
    return { configured: true as const, run: completed, message: `Daytona completed the task using ${result.uploadedFileCount} workspace file${result.uploadedFileCount === 1 ? "" : "s"}.` };
  } catch (error) {
    const failed = await updateAgentVmRunForUser(ownerId, run.id, { status: "failed", errorMessage: safeError(error), completedAt: new Date() });
    return { configured: true as const, run: failed, message: safeError(error) };
  }
}

export async function cancelAgentVmRun(ownerId: number, runId: number) {
  const active = await getActiveAgentVmRunForUser(ownerId);
  if (!active || active.id !== runId) return undefined;
  const client = getDaytonaClient() as unknown as { get?: (sandboxId: string) => Promise<{ delete: (timeout?: number, wait?: boolean) => Promise<void> }> } | undefined;
  if (client?.get && active.sandboxId) await client.get(active.sandboxId).then(sandbox => sandbox.delete(10, false)).catch(() => undefined);
  return updateAgentVmRunForUser(ownerId, runId, { status: "cancelled", completedAt: new Date(), errorMessage: null });
}
