import {
  createAgentVmRunForUser,
  createWorkspaceFileForUser,
  getWorkspaceComputer,
  listAgentVmRunsForUser,
  updateAgentVmRunForUser,
  updateWorkspacePersistentSandbox,
} from "./db";
import { getDaytonaClient, isDaytonaConfigured, runDaytonaTaskInPersistentSandbox, ensurePersistentSandbox } from "./daytona";
import { persistDaytonaWorkspace, persistWorkspaceToObjectStorage, restoreWorkspaceToDaytona } from "./workspaceSync";

const ERROR_LIMIT = 1000;

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : "Nova could not complete that agent VM run.";
  return value.replace(/DAYTONA_API_KEY\s*=\s*\S+/gi, "[private credential]").slice(0, ERROR_LIMIT);
}
export async function getAgentVmStatus(ownerId: number) {
  return {
    configured: isDaytonaConfigured(),
    provider: "daytona" as const,
    policy: "persistent_workspace" as const,
    limits: { timeoutSeconds: 30, network: "allowed" as const },
    allowance: { usedRuns: 0, maxRuns: 0, remainingRuns: 0, exhausted: false },
    persistence: "s3_daytona_bidirectional" as const,
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
  const computer = await getWorkspaceComputer(ownerId);
  const run = await createAgentVmRunForUser(ownerId, { task: input.task });
  try {
    // Files created from the Files tab are first persisted to S3. The same durable
    // objects are then restored into the persistent Daytona workspace before the task runs.
    await persistWorkspaceToObjectStorage(ownerId);
    const sandbox = await ensurePersistentSandbox(client, computer.workspace.id, ownerId);
    await restoreWorkspaceToDaytona(ownerId, sandbox);
    const syncedComputer = await getWorkspaceComputer(ownerId);

    const result = await runDaytonaTaskInPersistentSandbox(client, {
      workspaceId: syncedComputer.workspace.id,
      ownerId,
      task: input.task,
      code: input.code,
      files: syncedComputer.files,
      folders: syncedComputer.folders,
    });

    // Anything the agent created or changed in Daytona is imported back into Neon
    // and mirrored to S3 before the run is considered complete.
    const completedSandbox = await client.get(result.sandboxId);
    const importedFileCount = await persistDaytonaWorkspace(ownerId, completedSandbox);
    await persistWorkspaceToObjectStorage(ownerId);

    await updateWorkspacePersistentSandbox(syncedComputer.workspace.id, result.sandboxId);
    const artifact = await createWorkspaceFileForUser(ownerId, {
      name: `nova-run-${run.id}.txt`,
      content: `Task: ${input.task}\n\n${result.output}\n`,
      mimeType: "text/plain",
    });
    await persistWorkspaceToObjectStorage(ownerId);
    const completed = await updateAgentVmRunForUser(ownerId, run.id, {
      status: "succeeded",
      resultSummary: result.output,
      artifactFileId: artifact?.id ?? null,
      sandboxId: result.sandboxId,
      completedAt: new Date(),
    });
    return {
      configured: true as const,
      run: completed,
      message: `Daytona completed the task using ${result.uploadedFileCount} workspace file${result.uploadedFileCount === 1 ? "" : "s"} and synchronized ${importedFileCount} file${importedFileCount === 1 ? "" : "s"} back to Nova storage.`,
    };
  } catch (error) {
    const failed = await updateAgentVmRunForUser(ownerId, run.id, { status: "failed", errorMessage: safeError(error), completedAt: new Date() });
    return { configured: true as const, run: failed, message: safeError(error) };
  }
}

export async function cancelAgentVmRun(ownerId: number, runId: number) {
  return undefined;
}
