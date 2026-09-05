import { Sandbox, type CommandResult } from "e2b";
export const E2B_WORKSPACE_DIR = "/home/user/workspace";

const MAX_WORKSPACE_FILES = 24;
const MAX_FILE_BYTES = 60_000;
const MAX_CODE_BYTES = 12_000;
const MAX_OUTPUT_BYTES = 12_000;
const RUN_TIMEOUT_MS = 30_000;
const OPENCODE_CHAT_TIMEOUT_MS = 180_000;
const PERSISTENT_SANDBOX_TIMEOUT_MS = 3_600_000;
const DEFAULT_MAX_SANDBOX_CREATIONS = 50;

let sandboxCreationCount = 0;
const sandboxExecutionLocks = new Map<string, Promise<void>>();

export type E2BWorkspaceFile = {
  id: number;
  name: string;
  content: string;
  mimeType: string;
  folderId: number | null;
};

export type E2BWorkspaceFolder = {
  id: number;
  name: string;
  parentId: number | null;
};

export type E2BCommandResult = Pick<
  CommandResult,
  "exitCode" | "stdout" | "stderr"
> & { error?: string };

type E2BFileEntry = {
  path: string;
  name?: string;
  type?: string;
  size?: number;
  mimeType?: string;
  isDir?: boolean;
  isDirectory?: boolean;
};

type E2BCommandsLike = {
  run: (
    command: string,
    options?: Record<string, unknown>
  ) => Promise<E2BCommandResult>;
};

type E2BFilesLike = {
  write: (
    path: string,
    data: string | ArrayBuffer | Uint8Array
  ) => Promise<unknown>;
  read: (
    path: string,
    options?: { format?: "bytes" | "text" }
  ) => Promise<string | Uint8Array>;
  list: (path: string, options?: { depth?: number }) => Promise<E2BFileEntry[]>;
  makeDir?: (path: string) => Promise<boolean>;
  remove?: (path: string) => Promise<unknown>;
};

export type E2BSandboxLike = {
  sandboxId: string;
  commands: E2BCommandsLike;
  files: E2BFilesLike;
  pause?: (options?: { keepMemory?: boolean }) => Promise<boolean>;
  kill?: () => Promise<boolean>;
  setTimeout?: (timeoutMs: number) => Promise<void>;
};

export type E2BClientLike = {
  create: (options?: Record<string, unknown>) => Promise<E2BSandboxLike>;
  connect: (
    sandboxId: string,
    options?: Record<string, unknown>
  ) => Promise<E2BSandboxLike>;
};

export type E2BTaskInput = {
  runId: number;
  workspaceId: number;
  ownerId: number;
  task: string;
  code?: string;
  files: E2BWorkspaceFile[];
  folders: E2BWorkspaceFolder[];
  onSandboxCreated?: (sandboxId: string) => Promise<void> | void;
};

export type E2BTaskResult = {
  sandboxId: string;
  output: string;
  uploadedFileCount: number;
};

export function isE2BConfigured() {
  return Boolean(process.env.E2B_API_KEY?.trim());
}

function maxSandboxCreations() {
  const configured = Number.parseInt(
    process.env.E2B_MAX_SANDBOX_CREATIONS ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_MAX_SANDBOX_CREATIONS;
}

/** Reserve one sandbox creation before contacting E2B, enforcing Nova's zero-spend safety cap. */
export function reserveSandboxCreation() {
  const limit = maxSandboxCreations();
  if (sandboxCreationCount >= limit) {
    throw new Error(
      "Nova has paused new sandbox work to stay within its no-card safety limit."
    );
  }
  sandboxCreationCount += 1;
}

/** Reset the process-local creation counter for isolated tests and controlled worker restarts. */
export function resetSandboxCreationCount() {
  sandboxCreationCount = 0;
}

function safeE2BError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(
      /(?:E2B_API_KEY\s*[=:]\s*|authorization\s*[:=]\s*bearer\s+|bearer\s+)\S+/gi,
      "[private credential]"
    )
    .slice(0, 500);
}

export function getE2BClient(): E2BClientLike | undefined {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) return undefined;
  return {
    create: options =>
      Sandbox.create({
        ...(options ?? {}),
        apiKey,
      }) as unknown as Promise<E2BSandboxLike>,
    connect: (sandboxId, options) =>
      Sandbox.connect(sandboxId, {
        ...(options ?? {}),
        apiKey,
      }) as unknown as Promise<E2BSandboxLike>,
  };
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
  return value.length <= maximum
    ? value
    : `${value.slice(0, maximum)}\n\n[truncated by Nova]`;
}

export function sanitizeE2BOutput(value: string | undefined) {
  return (
    truncate(
      (value ?? "")
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\0/g, ""),
      MAX_OUTPUT_BYTES
    ).trim() || "Task finished without console output."
  );
}

export function validateE2BCode(code: string | undefined) {
  if (!code?.trim()) return;
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES)
    throw new Error("Nova limits one VM task to 12 KB of Python code.");
}

export function buildE2BWorkspaceBundle(
  files: E2BWorkspaceFile[],
  folders: E2BWorkspaceFolder[]
) {
  const folderNames = new Map(folders.map(folder => [folder.id, folder.name]));
  const selected = files.slice(0, MAX_WORKSPACE_FILES);
  const manifest = selected.map(file => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    folder: file.folderId ? (folderNames.get(file.folderId) ?? null) : null,
    path: `input/${file.id}-${safePathSegment(file.name, `file-${file.id}.txt`)}`,
  }));
  return {
    manifest,
    uploads: selected.map((file, index) => ({
      remotePath: `${E2B_WORKSPACE_DIR}/input/${file.id}-${safePathSegment(file.name, `file-${index + 1}.txt`)}`,
      content: truncate(file.content, MAX_FILE_BYTES),
    })),
  };
}

function buildTaskScript(code?: string) {
  const userCode =
    code?.trim() ||
    [
      "print('Nova workspace inventory')",
      "for path in sorted(INPUT_DIR.iterdir()):",
      "    print(f'- {path.name}')",
    ].join("\n");
  return [
    "from pathlib import Path",
    `WORKSPACE_DIR = Path(${JSON.stringify(E2B_WORKSPACE_DIR)})`,
    "INPUT_DIR = WORKSPACE_DIR / 'input'",
    "OUTPUT_DIR = WORKSPACE_DIR / 'output'",
    "OUTPUT_DIR.mkdir(parents=True, exist_ok=True)",
    "# The sandbox below is isolated for the requested task (not the user's computer).",
    userCode,
    "",
  ].join("\n");
}

export function persistentSandboxConfig(workspaceId: number, ownerId: number) {
  return {
    template: "base",
    metadata: {
      "nova.owner": String(ownerId),
      "nova.workspace": String(workspaceId),
      "nova.persistent": "true",
    },
    timeoutMs: PERSISTENT_SANDBOX_TIMEOUT_MS,
    lifecycle: { onTimeout: "pause" as const, autoResume: true },
    allowInternetAccess: true,
  };
}

const persistentSandboxInFlight = new Map<string, Promise<E2BSandboxLike>>();

async function runCommand(
  sandbox: E2BSandboxLike,
  command: string,
  options: Record<string, unknown>
): Promise<E2BCommandResult> {
  try {
    return await sandbox.commands.run(command, options);
  } catch (error) {
    const result = error as Partial<E2BCommandResult>;
    if (typeof result.exitCode === "number") {
      return {
        exitCode: result.exitCode,
        stdout: typeof result.stdout === "string" ? result.stdout : "",
        stderr: typeof result.stderr === "string" ? result.stderr : "",
        error:
          typeof result.error === "string" ? result.error : safeE2BError(error),
      };
    }
    throw error;
  }
}

// Install and configure OpenCode inside the persistent E2B sandbox. Provisioning is
// best effort because a transient package-network error should not prevent other VM use.
async function provisionOpencodeOnSandbox(sandbox: E2BSandboxLike) {
  const config = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "opencode/big-pickle",
  });
  const encodedConfig = Buffer.from(config, "utf8").toString("base64");
  const script = [
    "set -e",
    'if ! command -v opencode >/dev/null 2>&1 && [ ! -x "$HOME/.opencode/bin/opencode" ]; then',
    "  curl -fsSL https://opencode.ai/install | bash",
    "fi",
    'grep -q \'opencode/bin\' "$HOME/.bashrc" 2>/dev/null || printf \'\\nexport PATH="$HOME/.opencode/bin:$PATH"\\n\' >> "$HOME/.bashrc"',
    'mkdir -p "$HOME/.config/opencode"',
    `printf '%s' '${encodedConfig}' | base64 -d > "$HOME/.config/opencode/opencode.json"`,
  ].join("\n");
  try {
    await runCommand(sandbox, script, {
      cwd: E2B_WORKSPACE_DIR,
      timeoutMs: 180_000,
    });
  } catch (error) {
    console.warn(
      `[E2B] opencode provisioning skipped for sandbox ${sandbox.sandboxId}: ${safeE2BError(error)}`
    );
  }
}

async function createOrGetPersistentSandbox(
  client: E2BClientLike,
  workspaceId: number,
  ownerId: number,
  knownSandboxId?: string | null
): Promise<E2BSandboxLike> {
  if (knownSandboxId) {
    const sandbox = await client.connect(knownSandboxId, {
      timeoutMs: PERSISTENT_SANDBOX_TIMEOUT_MS,
    });
    await sandbox.setTimeout?.(PERSISTENT_SANDBOX_TIMEOUT_MS);
    await provisionOpencodeOnSandbox(sandbox);
    return sandbox;
  }

  reserveSandboxCreation();
  const sandbox = await client.create(
    persistentSandboxConfig(workspaceId, ownerId)
  );
  await provisionOpencodeOnSandbox(sandbox);
  return sandbox;
}

export async function ensurePersistentSandbox(
  client: E2BClientLike,
  workspaceId: number,
  ownerId: number,
  knownSandboxId?: string | null
): Promise<E2BSandboxLike> {
  const key = `${ownerId}:${workspaceId}:${knownSandboxId ?? "new"}`;
  const existing = persistentSandboxInFlight.get(key);
  if (existing) return existing;

  const pending = createOrGetPersistentSandbox(
    client,
    workspaceId,
    ownerId,
    knownSandboxId
  );
  persistentSandboxInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (persistentSandboxInFlight.get(key) === pending)
      persistentSandboxInFlight.delete(key);
  }
}

export async function recoverPersistentSandbox(
  client: E2BClientLike,
  workspaceId: number,
  ownerId: number,
  knownSandboxId?: string | null
): Promise<E2BSandboxLike> {
  try {
    return await createOrGetPersistentSandbox(
      client,
      workspaceId,
      ownerId,
      knownSandboxId
    );
  } catch {
    return ensurePersistentSandbox(client, workspaceId, ownerId);
  }
}

async function uploadBundleToSandbox(
  sandbox: E2BSandboxLike,
  files: E2BWorkspaceFile[],
  folders: E2BWorkspaceFolder[],
  task: string,
  code?: string
) {
  if (sandbox.files.remove)
    await sandbox.files
      .remove(`${E2B_WORKSPACE_DIR}/input`)
      .catch(() => undefined);
  await sandbox.files.makeDir?.(`${E2B_WORKSPACE_DIR}/input`);
  await sandbox.files.makeDir?.(`${E2B_WORKSPACE_DIR}/output`);
  const bundle = buildE2BWorkspaceBundle(files, folders);
  await sandbox.files.write(
    `${E2B_WORKSPACE_DIR}/nova-manifest.json`,
    JSON.stringify({ task, files: bundle.manifest }, null, 2)
  );
  for (const file of bundle.uploads)
    await sandbox.files.write(file.remotePath, file.content);
  await sandbox.files.write(
    `${E2B_WORKSPACE_DIR}/.nova-task.py`,
    buildTaskScript(code)
  );
}

function commandOutput(result: E2BCommandResult) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

export async function runE2BTask(
  client: E2BClientLike,
  input: E2BTaskInput
): Promise<E2BTaskResult> {
  validateE2BCode(input.code);
  reserveSandboxCreation();
  const sandbox = await client.create({
    ...persistentSandboxConfig(input.workspaceId, input.ownerId),
    metadata: {
      "nova.owner": String(input.ownerId),
      "nova.workspace": String(input.workspaceId),
      "nova.run": String(input.runId),
    },
    timeoutMs: 1_200_000,
    lifecycle: { onTimeout: "kill" as const },
  });

  try {
    await input.onSandboxCreated?.(sandbox.sandboxId);
    const bundle = buildE2BWorkspaceBundle(input.files, input.folders);
    await uploadBundleToSandbox(
      sandbox,
      input.files,
      input.folders,
      input.task,
      input.code
    );
    const response = await runCommand(sandbox, "python3 .nova-task.py", {
      cwd: E2B_WORKSPACE_DIR,
      timeoutMs: RUN_TIMEOUT_MS,
    });
    const output = sanitizeE2BOutput(commandOutput(response));
    if (response.exitCode !== 0) throw new Error(output);
    return {
      sandboxId: sandbox.sandboxId,
      output,
      uploadedFileCount: bundle.uploads.length,
    };
  } finally {
    if (sandbox.kill) await sandbox.kill().catch(() => undefined);
  }
}

class E2BTaskExitError extends Error {}

async function runTaskInPersistentSandbox(
  sandbox: E2BSandboxLike,
  input: {
    task: string;
    code?: string;
    files: E2BWorkspaceFile[];
    folders: E2BWorkspaceFolder[];
  }
): Promise<E2BTaskResult> {
  const key = sandbox.sandboxId;
  const previous = sandboxExecutionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  sandboxExecutionLocks.set(key, queued);
  await previous;
  try {
    await uploadBundleToSandbox(
      sandbox,
      input.files,
      input.folders,
      input.task,
      input.code
    );
    const response = await runCommand(sandbox, "python3 .nova-task.py", {
      cwd: E2B_WORKSPACE_DIR,
      timeoutMs: RUN_TIMEOUT_MS,
    });
    const output = sanitizeE2BOutput(commandOutput(response));
    if (response.exitCode !== 0) throw new E2BTaskExitError(output);
    return {
      sandboxId: sandbox.sandboxId,
      output,
      uploadedFileCount: Math.min(input.files.length, MAX_WORKSPACE_FILES),
    };
  } finally {
    release();
    if (sandboxExecutionLocks.get(key) === queued)
      sandboxExecutionLocks.delete(key);
  }
}

export async function runE2BTaskInPersistentSandbox(
  client: E2BClientLike,
  input: {
    workspaceId: number;
    ownerId: number;
    sandboxId?: string | null;
    task: string;
    code?: string;
    files: E2BWorkspaceFile[];
    folders: E2BWorkspaceFolder[];
  }
): Promise<E2BTaskResult> {
  validateE2BCode(input.code);
  const sandbox = await ensurePersistentSandbox(
    client,
    input.workspaceId,
    input.ownerId,
    input.sandboxId
  );
  try {
    return await runTaskInPersistentSandbox(sandbox, input);
  } catch (error) {
    if (error instanceof E2BTaskExitError) throw error;
    throw new Error(
      `E2B task outcome is uncertain; Nova will not rerun it automatically: ${safeE2BError(error)}`
    );
  }
}

export async function initWorkspacePersistentVm(
  workspaceId: number,
  ownerId: number,
  knownSandboxId?: string | null
): Promise<string | undefined> {
  const client = getE2BClient();
  if (!client) return undefined;

  try {
    const sandbox = await ensurePersistentSandbox(
      client,
      workspaceId,
      ownerId,
      knownSandboxId
    );
    return sandbox.sandboxId;
  } catch (error) {
    if (knownSandboxId)
      console.warn(
        `[E2B] Stored sandbox lookup failed for workspace ${workspaceId}: ${safeE2BError(error)}`
      );
    try {
      const sandbox = await ensurePersistentSandbox(
        client,
        workspaceId,
        ownerId
      );
      return sandbox.sandboxId;
    } catch (provisionError) {
      console.error(
        `[E2B] Persistent sandbox provisioning failed for workspace ${workspaceId}: ${safeE2BError(provisionError)}`
      );
      return undefined;
    }
  }
}

export type OpencodeChatResult = {
  reply: string;
  sandboxId: string;
};

// Run the OpenCode CLI agent inside the user's persistent E2B sandbox.
export async function runOpencodeChatInPersistentSandbox(
  client: E2BClientLike,
  input: {
    workspaceId: number;
    ownerId: number;
    sandboxId?: string | null;
    model: string;
    prompt: string;
    onChunk?: (chunk: string) => void | Promise<void>;
  }
): Promise<OpencodeChatResult> {
  const sandbox = await ensurePersistentSandbox(
    client,
    input.workspaceId,
    input.ownerId,
    input.sandboxId
  );
  const runOpencode = async (target: E2BSandboxLike) => {
    await provisionOpencodeOnSandbox(target);
    if (!/^[\w./:-]+$/.test(input.model))
      throw new Error("Unsupported opencode model identifier.");
    const encodedPrompt = Buffer.from(input.prompt, "utf8").toString("base64");
    const script = [
      "set -e",
      'export PATH="$HOME/.opencode/bin:$PATH"',
      'mkdir -p "$HOME/.opencode-chat"',
      'PROMPT_FILE="$(mktemp "$HOME/.opencode-chat/prompt.XXXXXXXX")"',
      `trap 'rm -f "$PROMPT_FILE"' EXIT`,
      `printf '%s' '${encodedPrompt}' | base64 -d > "$PROMPT_FILE"`,
      `opencode run -m ${JSON.stringify(input.model)} --format json < "$PROMPT_FILE"`,
    ].join("\n");
    const response = await runCommand(target, script, {
      cwd: E2B_WORKSPACE_DIR,
      timeoutMs: OPENCODE_CHAT_TIMEOUT_MS,
    });
    const output = response.stdout ?? "";
    if (response.exitCode !== 0)
      throw new Error(
        `opencode exited with code ${response.exitCode}: ${safeE2BError(output || response.stderr || response.error)}`
      );
    const lines = output.split("\n");
    const reply: string[] = [];
    for (const line of lines) {
      let event: { type?: string; part?: { type?: string; text?: string } };
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "text" && typeof event.part?.text === "string")
        reply.push(event.part.text);
    }
    return reply.join("");
  };

  let reply: string;
  let sandboxId: string;
  try {
    reply = await runOpencode(sandbox);
    sandboxId = sandbox.sandboxId;
  } catch (error) {
    throw new Error(
      `OpenCode outcome is uncertain; Nova will not rerun it automatically: ${safeE2BError(error)}`
    );
  }

  const chunks = reply.match(/[\s\S]{1,64}/g) ?? [];
  for (const chunk of chunks) await input.onChunk?.(chunk);
  return { reply, sandboxId };
}
