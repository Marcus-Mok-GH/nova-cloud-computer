import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildE2BWorkspaceBundle,
  E2B_WORKSPACE_DIR,
  ensurePersistentSandbox,
  persistentSandboxConfig,
  resetSandboxCreationCount,
  reserveSandboxCreation,
  runE2BTask,
  runE2BTaskInPersistentSandbox,
  sanitizeE2BOutput,
  validateE2BCode,
  type E2BClientLike,
  type E2BSandboxLike,
} from "./e2b";

describe("E2B sandbox service", () => {
  beforeEach(() => {
    delete process.env.E2B_MAX_SANDBOX_CREATIONS;
    resetSandboxCreationCount();
  });

  function sandboxWith(
    run: E2BSandboxLike["commands"]["run"] = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    }))
  ) {
    return {
      sandboxId: "sbx-test",
      commands: { run },
      files: {
        makeDir: vi.fn(async () => true),
        write: vi.fn(async () => undefined),
        read: vi.fn(async () => new Uint8Array()),
        list: vi.fn(async () => []),
      },
      setTimeout: vi.fn(async () => undefined),
      kill: vi.fn(async () => true),
    } as unknown as E2BSandboxLike;
  }

  it("creates a bounded sandbox, uploads a scoped bundle, records its ID, and kills it", async () => {
    const write = vi.fn(async () => undefined);
    const run = vi.fn(async (command: string) =>
      command.startsWith("python")
        ? { stdout: "analysis complete\n", stderr: "", exitCode: 0 }
        : { stdout: "", stderr: "", exitCode: 0 }
    );
    const sandbox = sandboxWith(run);
    sandbox.sandboxId = "sbx-private";
    sandbox.files.write = write;
    const create = vi.fn(async () => sandbox);
    const onSandboxCreated = vi.fn(async () => undefined);
    const client: E2BClientLike = { create, connect: vi.fn() };

    const result = await runE2BTask(client, {
      runId: 7,
      workspaceId: 4,
      ownerId: 12,
      task: "Inspect my notes",
      files: [
        {
          id: 2,
          name: "notes.md",
          content: "Private note",
          mimeType: "text/markdown",
          folderId: null,
        },
      ],
      folders: [],
      onSandboxCreated,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "base",
        timeoutMs: 1_200_000,
        metadata: expect.objectContaining({
          "nova.owner": "12",
          "nova.workspace": "4",
          "nova.run": "7",
        }),
      })
    );
    expect(onSandboxCreated).toHaveBeenCalledWith("sbx-private");
    expect(write).toHaveBeenCalledWith(
      `${E2B_WORKSPACE_DIR}/input/2-notes.md`,
      "Private note"
    );
    expect(run).toHaveBeenCalledWith(
      "python3 .nova-task.py",
      expect.objectContaining({ cwd: E2B_WORKSPACE_DIR, timeoutMs: 30_000 })
    );
    expect(sandbox.kill).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      sandboxId: "sbx-private",
      output: "analysis complete",
      uploadedFileCount: 1,
    });
  });
  it("blocks sandbox creation at the configured no-card safety cap", async () => {
    process.env.E2B_MAX_SANDBOX_CREATIONS = "0";
    const create = vi.fn();
    const client: E2BClientLike = { create, connect: vi.fn() };

    expect(() => reserveSandboxCreation()).toThrow(/no-card safety limit/i);
    await expect(
      runE2BTask(client, {
        runId: 7,
        workspaceId: 4,
        ownerId: 12,
        task: "Blocked task",
        files: [],
        folders: [],
      })
    ).rejects.toThrow(/no-card safety limit/i);
    await expect(ensurePersistentSandbox(client, 4, 12)).rejects.toThrow(
      /no-card safety limit/i
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("defines a private persistent sandbox with pause-and-resume lifecycle", () => {
    expect(persistentSandboxConfig(41, 7)).toEqual(
      expect.objectContaining({
        template: "base",
        metadata: expect.objectContaining({
          "nova.owner": "7",
          "nova.workspace": "41",
          "nova.persistent": "true",
        }),
        timeoutMs: 3_600_000,
        lifecycle: { onTimeout: "pause", autoResume: true },
        allowInternetAccess: true,
      })
    );
  });

  it("connects to the stored sandbox instead of creating a duplicate", async () => {
    const sandbox = sandboxWith();
    const connect = vi.fn(async () => sandbox);
    const client: E2BClientLike = { connect, create: vi.fn() };

    await expect(
      ensurePersistentSandbox(client, 41, 7, "sbx-durable")
    ).resolves.toBe(sandbox);
    expect(connect).toHaveBeenCalledWith(
      "sbx-durable",
      expect.objectContaining({ timeoutMs: 3_600_000 })
    );
    expect(sandbox.setTimeout).toHaveBeenCalledWith(3_600_000);
    expect(client.create).not.toHaveBeenCalled();
  });

  it("creates only one replacement when concurrent callers have no stored sandbox", async () => {
    const sandbox = sandboxWith();
    const create = vi.fn(async () => sandbox);
    const client: E2BClientLike = { connect: vi.fn(), create };

    const [first, second] = await Promise.all([
      ensurePersistentSandbox(client, 41, 7),
      ensurePersistentSandbox(client, 41, 7),
    ]);
    expect(first).toBe(sandbox);
    expect(second).toBe(sandbox);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not retry a user program that returned a non-zero exit code", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "bad input", stderr: "", exitCode: 2 });
    const sandbox = sandboxWith(run);
    const client: E2BClientLike = {
      connect: vi.fn(async () => sandbox),
      create: vi.fn(),
    };

    await expect(
      runE2BTaskInPersistentSandbox(client, {
        workspaceId: 41,
        ownerId: 7,
        sandboxId: "sbx-durable",
        task: "Run the task",
        files: [],
        folders: [],
      })
    ).rejects.toThrow("bad input");
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("allows network and process-launching Python but bounds code size", () => {
    expect(() =>
      validateE2BCode("import requests\nrequests.get('https://example.com')")
    ).not.toThrow();
    expect(() =>
      validateE2BCode("import subprocess\nsubprocess.run(['ls'])")
    ).not.toThrow();
    expect(() => validateE2BCode("x".repeat(20000))).toThrow(/12 KB/i);
    expect(() => validateE2BCode("   ")).not.toThrow();
  });

  it("keeps bundle paths safe and strips terminal escapes from bounded output", () => {
    const bundle = buildE2BWorkspaceBundle(
      [
        {
          id: 4,
          name: "../../secrets.txt",
          content: "safe",
          mimeType: "text/plain",
          folderId: null,
        },
      ],
      []
    );
    expect(bundle.uploads[0]?.remotePath).toBe(
      `${E2B_WORKSPACE_DIR}/input/4-secrets.txt`
    );
    expect(sanitizeE2BOutput("\u001b[31mhello\u001b[0m\0")).toBe("hello");
  });
});
