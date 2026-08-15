import { describe, expect, it, vi } from "vitest";
import { buildDaytonaWorkspaceBundle, runDaytonaTask, sanitizeDaytonaOutput, validateDaytonaCode, type DaytonaClientLike } from "./daytona";

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
      networkBlockAll: true,
      ttlMinutes: 20,
      labels: expect.objectContaining({ "nova.owner": "12", "nova.workspace": "4", "nova.run": "7" }),
    }));
    expect(onSandboxCreated).toHaveBeenCalledWith("sbx-private");
    expect(uploadFile).toHaveBeenCalledWith(expect.any(Buffer), "/home/daytona/workspace/input/2-notes.md");
    expect(executeCommand).toHaveBeenCalledWith("python3 .nova-task.py", "/home/daytona/workspace", undefined, 30);
    expect(remove).toHaveBeenCalledWith(10, false);
    expect(result).toMatchObject({ sandboxId: "sbx-private", output: "analysis complete", uploadedFileCount: 1 });
  });

  it("blocks network and process-launching code before a sandbox is created", () => {
    expect(() => validateDaytonaCode("import requests\nrequests.get('https://example.com')")).toThrow(/blocked process or network/i);
    expect(() => validateDaytonaCode("import subprocess\nsubprocess.run(['ls'])")).toThrow(/blocked process or network/i);
  });

  it("keeps bundle paths safe and strips terminal escapes from bounded output", () => {
    const bundle = buildDaytonaWorkspaceBundle([{ id: 4, name: "../../secrets.txt", content: "safe", mimeType: "text/plain", folderId: null }], []);
    expect(bundle.uploads[0]?.remotePath).toBe("/home/daytona/workspace/input/4-secrets.txt");
    expect(sanitizeDaytonaOutput("\u001b[31mhello\u001b[0m\0")).toBe("hello");
  });
});
