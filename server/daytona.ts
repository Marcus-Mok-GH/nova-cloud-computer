import { Daytona } from "@daytona/sdk";

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
    .replace(/^[_\.]+/, "")
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
  const blocked = /\b(?:subprocess|socket|requests|urllib|http\.client|ftplib|telnetlib|os\.(?:system|popen)|shutil\.rmtree)\b/i;
  if (blocked.test(code)) throw new Error("That VM task uses a blocked process or network capability. Use the supplied workspace files and standard Python only.");
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
    "# The user/agent program below runs without network access and may only use this sandbox bundle.",
    userCode,
    "",
  ].join("\n");
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
    networkBlockAll: true,
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
