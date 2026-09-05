import {
  createAgentVmRunForUser,
  createWorkspaceFileForUser,
  getWorkspaceComputer,
  listAgentVmRunsForUser,
  updateAgentVmRunForUser,
  updateWorkspacePersistentSandbox,
} from "./db";
import {
  getE2BClient,
  isE2BConfigured,
  runE2BTaskInPersistentSandbox,
  ensurePersistentSandbox,
  withE2BWorkspaceLock,
} from "./e2b";
import {
  persistE2BWorkspace,
  persistWorkspaceToObjectStorage,
  restoreWorkspaceToE2B,
} from "./workspaceSync";

const ERROR_LIMIT = 1000;

function safeError(error: unknown) {
  const value =
    error instanceof Error
      ? error.message
      : "Nova could not complete that agent VM run.";
  return value
    .replace(/E2B_API_KEY\s*=\s*\S+/gi, "[private credential]")
    .slice(0, ERROR_LIMIT);
}
export async function getAgentVmStatus(ownerId: number) {
  return {
    configured: isE2BConfigured(),
    provider: "e2b" as const,
    policy: "persistent_workspace" as const,
    limits: { timeoutSeconds: 30, network: "allowed" as const },
    allowance: { usedRuns: 0, maxRuns: 0, remainingRuns: 0, exhausted: false },
    persistence: "s3_e2b_bidirectional" as const,
  };
}

export async function listAgentVmRuns(ownerId: number) {
  return listAgentVmRunsForUser(ownerId);
}

export async function startAgentVmRun(
  ownerId: number,
  input: { task: string; code?: string }
) {
  const client = getE2BClient();
  if (!client) {
    return {
      configured: false as const,
      run: null,
      message:
        "E2B is not connected yet. An administrator must add the server-only E2B API key before Nova can start agent VMs.",
    };
  }
  const computer = await getWorkspaceComputer(ownerId);
  const run = await createAgentVmRunForUser(ownerId, { task: input.task });
  try {
    return await withE2BWorkspaceLock(
      ownerId,
      computer.workspace.id,
      async () => {
        // Files created from the Files tab are first persisted to S3. The same durable
        // objects are then restored into the persistent E2B workspace before the task runs.
        await persistWorkspaceToObjectStorage(ownerId);
        const sandbox = await ensurePersistentSandbox(
          client,
          computer.workspace.id,
          ownerId,
          computer.workspace.persistentSandboxId
        );
        await restoreWorkspaceToE2B(ownerId, sandbox);
        const syncedComputer = await getWorkspaceComputer(ownerId);

        const result = await runE2BTaskInPersistentSandbox(client, {
          workspaceId: syncedComputer.workspace.id,
          ownerId,
          sandboxId: syncedComputer.workspace.persistentSandboxId,
          task: input.task,
          code: input.code,
          files: syncedComputer.files,
          folders: syncedComputer.folders,
        });

        // Anything the agent created or changed in E2B is imported back into Neon
        // and mirrored to S3 before the run is considered complete.
        const completedSandbox = await client.connect(result.sandboxId);
        const importedFileCount = await persistE2BWorkspace(
          ownerId,
          completedSandbox
        );
        await persistWorkspaceToObjectStorage(ownerId);

        await updateWorkspacePersistentSandbox(
          syncedComputer.workspace.id,
          result.sandboxId
        );
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
          message: `E2B completed the task using ${result.uploadedFileCount} workspace file${result.uploadedFileCount === 1 ? "" : "s"} and synchronized ${importedFileCount} file${importedFileCount === 1 ? "" : "s"} back to Nova storage.`,
        };
      }
    );
  } catch (error) {
    const failed = await updateAgentVmRunForUser(ownerId, run.id, {
      status: "failed",
      errorMessage: safeError(error),
      completedAt: new Date(),
    });
    return {
      configured: true as const,
      run: failed,
      message: safeError(error),
    };
  }
}

export async function cancelAgentVmRun(ownerId: number, runId: number) {
  return undefined;
}
