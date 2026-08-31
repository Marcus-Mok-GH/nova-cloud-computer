import { describe, expect, it, vi } from "vitest";
import { buildDaytonaWorkspaceBundle, ensurePersistentSandbox, persistentSandboxConfig, recoverPersistentSandbox, runBashCommandInPersistentSandbox, runDaytonaTask, sanitizeBashOutput, sanitizeDaytonaOutput, validateDaytonaCode, type DaytonaClientLike } from "./daytona";

describe("Daytona sandbox service", () => {
  it("creates a bounded network-isolated sandbox, uploads a scoped bundle, records its ID, and always deletes it", async () => {
    const uploadFile = vi.fn(async () => undefined);
    const executeCommand = vi.fn(async (command: string) => command.startsWith("python") ? { result: "analysis complete\n", exitCode: 0 } : { result: "", exitCode: 0 });
    const remove = vi.fn(async () => undefined);
    const create = vi.fn(async () => ({ id: "sbx-private", fs: { uploadFile }, process: { executeCommand }, delete: remove }));
    const onSandboxCreated = vi.fn(async () => undefined);
    const client: DaytonaClientLike = { create };

    const result = await runDaytonaTask(client, {
      runId: 7,
      workspaceId: 4,
      ownerId: 12,
      task: "Inspect my notes",
      files: [{ id: 2, name: "notes.md", content: "Private note", mimeType: "text/markdown", folderId: null }],
      folders: [],
      onSandboxCreated,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      ephemeral: true,
      ttlMinutes: 20,
      labels: expect.objectContaining({ "nova.owner": "12", "nova.workspace": "4", "nova.run": "7" }),
    }));
    expect(onSandboxCreated).toHaveBeenCalledWith("sbx-private");
    expect(uploadFile).toHaveBeenCalledWith(expect.any(Buffer), "/home/daytona/workspace/input/2-notes.md");
    expect(executeCommand).toHaveBeenCalledWith("python3 .nova-task.py", "/home/daytona/workspace", undefined, 30);
    expect(remove).toHaveBeenCalledWith(10, false);
    expect(result).toMatchObject({ sandboxId: "sbx-private", output: "analysis complete", uploadedFileCount: 1 });
  });

  it("defines one private, non-ephemeral computer for each workspace", () => {
    expect(persistentSandboxConfig(41, 7)).toEqual(expect.objectContaining({
      name: "nova-workspace-41",
      labels: expect.objectContaining({ "nova.owner": "7", "nova.workspace": "41", "nova.persistent": "true" }),
      ephemeral: false,
      autoDeleteInterval: -1,
      public: false,
    }));
    expect(persistentSandboxConfig(41, 7)).not.toHaveProperty("networkBlockAll");
  });

  it("automatically wakes a stopped personal workspace without creating a duplicate", async () => {
    const start = vi.fn(async () => undefined);
    const sandbox = {
      id: "sbx-durable",
      state: "stopped" as const,
      start,
      fs: { uploadFile: vi.fn(async () => undefined) },
      process: { executeCommand: vi.fn(async () => ({ result: "", exitCode: 0 })) },
      delete: vi.fn(async () => undefined),
    };
    const client: DaytonaClientLike = { get: vi.fn(async () => sandbox), create: vi.fn() };

    await expect(ensurePersistentSandbox(client, 41, 7)).resolves.toBe(sandbox);
    expect(start).toHaveBeenCalledWith(30);
    expect(client.create).not.toHaveBeenCalled();
  });

  it("automatically refreshes and recovers a recoverable personal workspace failure", async () => {
    const refreshData = vi.fn(async () => undefined);
    const recover = vi.fn(async () => undefined);
    const sandbox = {
      id: "sbx-recovered",
      state: "error" as const,
      recoverable: true,
      refreshData,
      recover,
      fs: { uploadFile: vi.fn(async () => undefined) },
      process: { executeCommand: vi.fn(async () => ({ result: "", exitCode: 0 })) },
      delete: vi.fn(async () => undefined),
    };
    const client: DaytonaClientLike = { get: vi.fn(async () => sandbox), create: vi.fn() };

    await expect(recoverPersistentSandbox(client, 41, 7)).resolves.toBe(sandbox);
    expect(refreshData).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith(30);
    expect(client.create).not.toHaveBeenCalled();
  });

  it("creates one replacement when the provider no longer finds a workspace sandbox", async () => {
    const replacement = {
      id: "sbx-replacement",
      fs: { uploadFile: vi.fn(async () => undefined) },
      process: { executeCommand: vi.fn(async () => ({ result: "", exitCode: 0 })) },
      delete: vi.fn(async () => undefined),
    };
    const client: DaytonaClientLike = {
      get: vi.fn(async () => { throw new Error("not found"); }),
      create: vi.fn(async () => replacement),
    };

    const [first, second] = await Promise.all([
      ensurePersistentSandbox(client, 41, 7),
      ensurePersistentSandbox(client, 41, 7),
    ]);
    expect(first).toBe(replacement);
    expect(second).toBe(replacement);
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it("allows network and process-launching Python in the dedicated VM, but bounds code size", () => {
    expect(() => validateDaytonaCode("import requests\nrequests.get('https://example.com')")).not.toThrow();
    expect(() => validateDaytonaCode("import subprocess\nsubprocess.run(['ls'])")).not.toThrow();
    expect(() => validateDaytonaCode("x".repeat(20000))).toThrow(/12 KB/i);
    expect(() => validateDaytonaCode("   ")).not.toThrow();
  });

  it("keeps bundle paths safe and strips terminal escapes from bounded output", () => {
    const bundle = buildDaytonaWorkspaceBundle([{ id: 4, name: "../../secrets.txt", content: "safe", mimeType: "text/plain", folderId: null }], []);
    expect(bundle.uploads[0]?.remotePath).toBe("/home/daytona/workspace/input/4-secrets.txt");
    expect(sanitizeDaytonaOutput("\u001b[31mhello\u001b[0m\0")).toBe("hello");
  });

  it("runs a shell command in the persistent sandbox and scrubs credentials from its output", async () => {
    const executeCommand = vi.fn(async () => ({ result: "total 0\n", exitCode: 0 }));
    const sandbox = {
      id: "sbx-bash",
      state: "started" as const,
      fs: { uploadFile: vi.fn(async () => undefined) },
      process: { executeCommand },
      delete: vi.fn(async () => undefined),
    };
    const client: DaytonaClientLike = { get: vi.fn(async () => sandbox), create: vi.fn() };

    const result = await runBashCommandInPersistentSandbox(client, { workspaceId: 4, ownerId: 7, command: "ls -la /home/daytona/workspace" });

    expect(executeCommand).toHaveBeenCalledWith("ls -la /home/daytona/workspace", "/home/daytona", undefined, 30);
    expect(result).toEqual({ ok: true, exitCode: 0, output: "total 0", sandboxId: "sbx-bash" });
    expect(client.create).not.toHaveBeenCalled();
  });

  it("sanitizes ANSI escapes and leaked credential lines from bash output", () => {
    expect(sanitizeBashOutput("\u001b[31mred\u001b[0m\u001b[36mcyan\u001b[0m\0\n")).toBe("redcyan");
    expect(sanitizeBashOutput("export DAYTONA_API_KEY=abc123\n")).toBe("export [private credential]");
    expect(sanitizeBashOutput("")).toBe("Command produced no console output.");
  });

  it("rejects an empty shell command before touching any sandbox", async () => {
    const create = vi.fn();
    const client: DaytonaClientLike = { create };
    await expect(runBashCommandInPersistentSandbox(client, { workspaceId: 4, ownerId: 7, command: "   " })).rejects.toThrow(/shell command is required/i);
    expect(create).not.toHaveBeenCalled();
  });
});
