import { Daytona } from "@daytona/sdk";
import { ENV } from "./_core/env";

const MAX_WORKSPACE_FILES = 24;
const MAX_FILE_BYTES = 60_000;
const MAX_CODE_BYTES = 12_000;
const MAX_OUTPUT_BYTES = 12_000;
const RUN_TIMEOUT_SECONDS = 30;

export type DaytonaWorkspaceFile = {
  id: number;
  name: string;
  content: string;
  mimeType: string;
  folderId: number | null;
};

export type DaytonaWorkspaceFolder = {
  id: number;
  name: string;
  parentId: number | null;
};

export type DaytonaSandboxLike = {
  id: string;
  state?: "started" | "stopped" | "paused" | "archived" | "error" | string;
  recoverable?: boolean;
  start?: (timeout?: number) => Promise<void>;
  recover?: (timeout?: number) => Promise<void>;
  refreshData?: () => Promise<void>;
  fs: {
    uploadFile: (content: Buffer, remotePath: string, timeout?: number) => Promise<void>;
  };
  process: {
    executeCommand: (command: string, cwd?: string, env?: Record<string, string>, timeout?: number) => Promise<{ result?: string; exitCode?: number | null }>;
  };
  delete: (timeout?: number, wait?: boolean) => Promise<void>;
};

export type DaytonaClientLike = {
  create: (input: Record<string, unknown>) => Promise<DaytonaSandboxLike>;
  get: (sandboxId: string) => Promise<DaytonaSandboxLike>;
};

export type DaytonaTaskInput = {
  runId: number;
  workspaceId: number;
  ownerId: number;
  task: string;
  code?: string;
  files: DaytonaWorkspaceFile[];
  folders: DaytonaWorkspaceFolder[];
  onSandboxCreated?: (sandboxId: string) => Promise<void> | void;
};

export type DaytonaTaskResult = {
  sandboxId: string;
  output: string;
  uploadedFileCount: number;
};

export function isDaytonaConfigured() {
  return Boolean(process.env.DAYTONA_API_KEY?.trim());
}

function safeDaytonaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:DAYTONA_API_KEY|authorization|bearer)\s*[=:]\s*\S+/gi, "[private credential]")
    .slice(0, 500);
}

export function getDaytonaClient(): DaytonaClientLike | undefined {
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) return undefined;
  return new Daytona({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL?.trim() || "https://app.daytona.io/api",
    target: process.env.DAYTONA_TARGET?.trim() || "us",
    useDeprecatedPolling: true,
  }) as unknown as DaytonaClientLike;
}

function safePathSegment(value: string, fallback: string) {
  const normalized = value
    .replace(/[\\/]+/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[_.]+/, "")
    .slice(0, 100);
  return normalized || fallback;
}

function truncate(value: string, maximum: number) {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n\n[truncated by Nova]`;
}

export function sanitizeDaytonaOutput(value: string | undefined) {
  return truncate((value ?? "").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\0/g, ""), MAX_OUTPUT_BYTES).trim() || "Task finished without console output.";
}

export function validateDaytonaCode(code: string | undefined) {
  if (!code?.trim()) return;
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) throw new Error("Nova limits one VM task to 12 KB of Python code.");
}

export function buildDaytonaWorkspaceBundle(files: DaytonaWorkspaceFile[], folders: DaytonaWorkspaceFolder[]) {
  const folderNames = new Map(folders.map(folder => [folder.id, folder.name]));
  const selected = files.slice(0, MAX_WORKSPACE_FILES);
  const manifest = selected.map(file => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    folder: file.folderId ? folderNames.get(file.folderId) ?? null : null,
    path: `input/${file.id}-${safePathSegment(file.name, `file-${file.id}.txt`)}`,
  }));
  return {
    manifest,
    uploads: selected.map((file, index) => ({
      remotePath: `/home/daytona/workspace/input/${file.id}-${safePathSegment(file.name, `file-${index + 1}.txt`)}`,
      content: truncate(file.content, MAX_FILE_BYTES),
    })),
  };
}

function buildTaskScript(code?: string) {
  const userCode = code?.trim() || [
    "print('Nova workspace inventory')",
    "for path in sorted(INPUT_DIR.iterdir()):",
    "    print(f'- {path.name}')",
  ].join("\n");
  return [
    "from pathlib import Path",
    "WORKSPACE_DIR = Path('/home/daytona/workspace')",
    "INPUT_DIR = WORKSPACE_DIR / 'input'",
    "OUTPUT_DIR = WORKSPACE_DIR / 'output'",
    "OUTPUT_DIR.mkdir(parents=True, exist_ok=True)",
    "# The VM below is a dedicated network-enabled sandbox for the requested task (not the user's computer).",
    userCode,
    "",
  ].join("\n");
}

export function persistentSandboxConfig(workspaceId: number, ownerId: number) {
  return {
    name: `nova-workspace-${workspaceId}`,
    language: "python",
    labels: {
      "nova.owner": String(ownerId),
      "nova.workspace": String(workspaceId),
      "nova.persistent": "true",
    },
    // Daytona's selected Python snapshot uses its default 1 vCPU, 1 GiB RAM,
    // and 3 GiB disk. The SDK rejects an explicit resources field with a snapshot.
    ephemeral: false,
    autoDeleteInterval: -1,
    public: false,
  };
}

const persistentSandboxInFlight = new Map<string, Promise<DaytonaSandboxLike>>();

// Idempotently prepare the user's persistent VM so the opencode CLI is installed
// and configured to stream the "big-pickle" model through the anonymous OpenCode
// Zen provider (mirroring the Zo Computer setup). The CLI supports anonymous
// access, so no API key is needed. Best-effort: a provisioning failure never
// blocks the VM for normal use.
async function provisionOpencodeOnSandbox(sandbox: DaytonaSandboxLike) {
  const config = JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "opencode/big-pickle" });
  const script = [
    "set -e",
    'if ! command -v opencode >/dev/null 2>&1 && [ ! -x "$HOME/.opencode/bin/opencode" ]; then',
    "  curl -fsSL https://opencode.ai/install | bash",
    "fi",
    "grep -q 'opencode/bin' \"$HOME/.bashrc\" 2>/dev/null || printf '\\nexport PATH=\"$HOME/.opencode/bin:$PATH\"\\n' >> \"$HOME/.bashrc\"",
    'mkdir -p "$HOME/.config/opencode"',
    `printf '%s' ${JSON.stringify(config)} > "$HOME/.config/opencode/opencode.json"`,
  ].join("\n");
  try {
    await sandbox.process.executeCommand(script, "/home/daytona", undefined, 180);
  } catch (error) {
    console.warn(`[Daytona] opencode provisioning skipped for sandbox ${sandbox.id}: ${safeDaytonaError(error)}`);
  }
}

async function wakePersistentSandbox(sandbox: DaytonaSandboxLike): Promise<DaytonaSandboxLike> {
  if (sandbox.state === "error" && sandbox.recoverable && sandbox.recover) {
    await sandbox.recover(30);
  } else if ((sandbox.state === "stopped" || sandbox.state === "paused" || sandbox.state === "archived") && sandbox.start) {
    await sandbox.start(30);
  }
  return sandbox;
}

async function createOrGetPersistentSandbox(client: DaytonaClientLike, workspaceId: number, ownerId: number): Promise<DaytonaSandboxLike> {
  const config = persistentSandboxConfig(workspaceId, ownerId);
  try {
    return await wakePersistentSandbox(await client.get(config.name));
  } catch {
    // The deterministic workspace name is not present yet, so create it once
    // and prepare the user's VM with the opencode CLI + big-pickle config.
    const sandbox = await wakePersistentSandbox(await client.create(config));
    await provisionOpencodeOnSandbox(sandbox);
    return sandbox;
  }
}

export async function ensurePersistentSandbox(client: DaytonaClientLike, workspaceId: number, ownerId: number): Promise<DaytonaSandboxLike> {
  const key = `${ownerId}:${workspaceId}`;
  const existing = persistentSandboxInFlight.get(key);
  if (existing) return existing;

  const pending = createOrGetPersistentSandbox(client, workspaceId, ownerId);
  persistentSandboxInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (persistentSandboxInFlight.get(key) === pending) persistentSandboxInFlight.delete(key);
  }
}

export async function recoverPersistentSandbox(client: DaytonaClientLike, workspaceId: number, ownerId: number): Promise<DaytonaSandboxLike> {
  const config = persistentSandboxConfig(workspaceId, ownerId);
  try {
    const sandbox = await client.get(config.name);
    await sandbox.refreshData?.();
    return await wakePersistentSandbox(sandbox);
  } catch {
    // If the provider can no longer retrieve this sandbox, the normal durable
    // ensure path will reuse its deterministic name or create a replacement.
    return ensurePersistentSandbox(client, workspaceId, ownerId);
  }
}

async function uploadBundleToSandbox(sandbox: DaytonaSandboxLike, files: DaytonaWorkspaceFile[], folders: DaytonaWorkspaceFolder[], task: string, code?: string) {
  await sandbox.process.executeCommand("mkdir -p /home/daytona/workspace/input /home/daytona/workspace/output", "/home/daytona", undefined, 10);
  const bundle = buildDaytonaWorkspaceBundle(files, folders);
  await sandbox.fs.uploadFile(Buffer.from(JSON.stringify({ task, files: bundle.manifest }, null, 2)), "/home/daytona/workspace/nova-manifest.json");
  for (const file of bundle.uploads) {
    await sandbox.fs.uploadFile(Buffer.from(file.content), file.remotePath);
  }
  await sandbox.fs.uploadFile(Buffer.from(buildTaskScript(code)), "/home/daytona/workspace/.nova-task.py");
}

export async function runDaytonaTask(client: DaytonaClientLike, input: DaytonaTaskInput): Promise<DaytonaTaskResult> {
  validateDaytonaCode(input.code);
  const sandbox = await client.create({
    name: `nova-run-${input.runId}`,
    language: "python",
    labels: {
      "nova.owner": String(input.ownerId),
      "nova.workspace": String(input.workspaceId),
      "nova.run": String(input.runId),
    },
    resources: { cpu: 1, memory: 1, disk: 3 },
    ephemeral: true,
    autoDeleteInterval: 0,
    ttlMinutes: 20,
    public: false,
  });

  try {
    await input.onSandboxCreated?.(sandbox.id);
    const bundle = buildDaytonaWorkspaceBundle(input.files, input.folders);
    await sandbox.process.executeCommand("mkdir -p /home/daytona/workspace/input /home/daytona/workspace/output", "/home/daytona", undefined, 10);
    await sandbox.fs.uploadFile(Buffer.from(JSON.stringify({ task: input.task, files: bundle.manifest }, null, 2)), "/home/daytona/workspace/nova-manifest.json");
    for (const file of bundle.uploads) await sandbox.fs.uploadFile(Buffer.from(file.content), file.remotePath);
    await sandbox.fs.uploadFile(Buffer.from(buildTaskScript(input.code)), "/home/daytona/workspace/.nova-task.py");
    const response = await sandbox.process.executeCommand("python3 .nova-task.py", "/home/daytona/workspace", undefined, RUN_TIMEOUT_SECONDS);
    const output = sanitizeDaytonaOutput(response.result);
    if (response.exitCode && response.exitCode !== 0) throw new Error(output);
    return { sandboxId: sandbox.id, output, uploadedFileCount: bundle.uploads.length };
  } finally {
    await sandbox.delete(10, false).catch(() => undefined);
  }
}

class DaytonaTaskExitError extends Error {}

async function runTaskInPersistentSandbox(sandbox: DaytonaSandboxLike, input: {
  task: string;
  code?: string;
  files: DaytonaWorkspaceFile[];
  folders: DaytonaWorkspaceFolder[];
}): Promise<DaytonaTaskResult> {
  await uploadBundleToSandbox(sandbox, input.files, input.folders, input.task, input.code);
  const response = await sandbox.process.executeCommand("python3 .nova-task.py", "/home/daytona/workspace", undefined, RUN_TIMEOUT_SECONDS);
  const output = sanitizeDaytonaOutput(response.result);
  if (response.exitCode && response.exitCode !== 0) throw new DaytonaTaskExitError(output);
  return { sandboxId: sandbox.id, output, uploadedFileCount: Math.min(input.files.length, MAX_WORKSPACE_FILES) };
}

export async function runDaytonaTaskInPersistentSandbox(client: DaytonaClientLike, input: {
  workspaceId: number;
  ownerId: number;
  task: string;
  code?: string;
  files: DaytonaWorkspaceFile[];
  folders: DaytonaWorkspaceFolder[];
}): Promise<DaytonaTaskResult> {
  validateDaytonaCode(input.code);
  const sandbox = await ensurePersistentSandbox(client, input.workspaceId, input.ownerId);
  try {
    return await runTaskInPersistentSandbox(sandbox, input);
  } catch (error) {
    // Do not repeat a completed user program that reported its own failure.
    if (error instanceof DaytonaTaskExitError) throw error;

    console.warn(`[Daytona] Persistent task failed for workspace ${input.workspaceId}; retrying once with automatic recovery: ${safeDaytonaError(error)}`);
    const recoveredSandbox = await recoverPersistentSandbox(client, input.workspaceId, input.ownerId);
    return runTaskInPersistentSandbox(recoveredSandbox, input);
  }
}

export async function initWorkspacePersistentVm(workspaceId: number, ownerId: number, knownSandboxId?: string | null): Promise<string | undefined> {
  const client = getDaytonaClient();
  if (!client) return undefined;

  try {
    if (knownSandboxId) {
      const sandbox = await wakePersistentSandbox(await client.get(knownSandboxId));
      return sandbox.id;
    }
    const sandbox = await ensurePersistentSandbox(client, workspaceId, ownerId);
    return sandbox.id;
  } catch (knownSandboxError) {
    if (knownSandboxId) {
      console.warn(`[Daytona] Stored sandbox lookup failed for workspace ${workspaceId}: ${safeDaytonaError(knownSandboxError)}`);
    }
    try {
      const sandbox = await ensurePersistentSandbox(client, workspaceId, ownerId);
      return sandbox.id;
    } catch (provisionError) {
      console.error(`[Daytona] Persistent sandbox provisioning failed for workspace ${workspaceId}: ${safeDaytonaError(provisionError)}`);
      return undefined;
    }
  }
}

export type OpencodeChatResult = {
  reply: string;
  sandboxId: string;
};

const OPENCODE_CHAT_TIMEOUT_SECONDS = 180;

// Run the opencode CLI agent inside the user's persistent VM, streaming the
// "big-pickle" model through the anonymous OpenCode Zen provider (mirroring the
// Zo Computer setup). This powers keyless conversational chat: the full opencode
// agent runs on the VM with its own tools (bash, file edit, etc.) inside the
// dedicated sandbox, and its `text` events are streamed back to the caller.
export async function runOpencodeChatInPersistentSandbox(client: DaytonaClientLike, input: {
  workspaceId: number;
  ownerId: number;
  model: string;
  prompt: string;
  onChunk?: (chunk: string) => void | Promise<void>;
}): Promise<OpencodeChatResult> {
  const sandbox = await ensurePersistentSandbox(client, input.workspaceId, input.ownerId);
  const runOpencode = async (target: DaytonaSandboxLike) => {
    await provisionOpencodeOnSandbox(target);
    const script = [
      "set -e",
      'export PATH="$HOME/.opencode/bin:$PATH"',
      'mkdir -p "$HOME/.opencode-chat"',
      `printf '%s' ${JSON.stringify(input.prompt)} > "$HOME/.opencode-chat/prompt.txt"`,
      `opencode run -m ${JSON.stringify(input.model)} --format json < "$HOME/.opencode-chat/prompt.txt"`,
    ].join("\n");
    const response = await target.process.executeCommand(script, "/home/daytona", undefined, OPENCODE_CHAT_TIMEOUT_SECONDS);
    const lines = (response.result ?? "").split("\n");
    const reply: string[] = [];
    for (const line of lines) {
      let event: { type?: string; part?: { type?: string; text?: string } };
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "text" && typeof event.part?.text === "string") {
        reply.push(event.part.text);
      }
    }
    const text = reply.join("");
    return text;
  };

  try {
    const reply = await runOpencode(sandbox);
    const chunks = reply.match(/[\s\S]{1,64}/g) ?? [];
    for (const chunk of chunks) await input.onChunk?.(chunk);
    return { reply, sandboxId: sandbox.id };
  } catch (error) {
    console.warn(`[Daytona] Opencode chat failed for workspace ${input.workspaceId}; retrying once with automatic recovery: ${safeDaytonaError(error)}`);
    const recoveredSandbox = await recoverPersistentSandbox(client, input.workspaceId, input.ownerId);
    const reply = await runOpencode(recoveredSandbox);
    const chunks = reply.match(/[\s\S]{1,64}/g) ?? [];
    for (const chunk of chunks) await input.onChunk?.(chunk);
    return { reply, sandboxId: recoveredSandbox.id };
  }
}
