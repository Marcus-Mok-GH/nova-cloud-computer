import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentVmRuns, workspaceFiles, workspaceFolders, workspaces } from "../drizzle/schema";

/** Operation log shared with the ./e2b mock to assert the reset ordering. */
const order: string[] = [];
let activeWorkspace: { id: number; ownerId: number; persistentSandboxId: string | null } = { id: 51, ownerId: 7, persistentSandboxId: "sbx-old" };
let storedRuns: Array<{ id: number; status: string }> = [];
let storedFiles: Array<{ id: number }> = [];
let storedFolders: Array<{ id: number }> = [];

/** Recursively pulls drizzle Param values out of a where-condition tree. */
function paramValues(condition: unknown, depth = 0): unknown[] {
  if (!condition || typeof condition !== "object" || depth > 6) return [];
  if (Array.isArray(condition))
    return condition.flatMap(item => paramValues(item, depth + 1));
  if (Array.isArray((condition as { queryChunks?: unknown[] }).queryChunks)) {
    return ((condition as { queryChunks: unknown[] }).queryChunks).flatMap(chunk => paramValues(chunk, depth + 1));
  }
  const maybe = condition as { value?: unknown; brand?: unknown; encoder?: unknown };
  if ("brand" in maybe && "encoder" in maybe) return [maybe.value];
  return Object.values(condition).flatMap(value => paramValues(value, depth + 1));
}

const fakeDb = {
  select: vi.fn(() => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          if (table === workspaces) return [activeWorkspace];
          return [];
        },
      }),
    }),
  })),
  insert: vi.fn(() => ({ values: () => ({ onConflictDoNothing: async () => undefined }) })),
  update: vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (condition: unknown) => ({
        then: async (resolve: (value: unknown) => unknown) => {
          if (table === workspaces) {
            order.push("detach-sandbox-id");
            activeWorkspace = { ...activeWorkspace, persistentSandboxId: (values.persistentSandboxId as string | null) ?? null };
            return resolve(undefined);
          }
          if (table === agentVmRuns) {
            const [workspaceId] = paramValues(condition).slice(-1);
            void workspaceId;
            const cancelled = storedRuns.filter(run => ["queued", "running"].includes(run.status));
            for (const run of cancelled) run.status = "cancelled";
            order.push("cancel-active-runs");
            return resolve(undefined);
          }
          return resolve(undefined);
        },
        returning: async () => {
          if (table !== agentVmRuns) return [];
          const cancelled = storedRuns.filter(run => ["queued", "running"].includes(run.status));
          for (const run of cancelled) run.status = "cancelled";
          order.push("cancel-active-runs");
          return cancelled.map(run => ({ id: run.id }));
        },
      }),
    }),
  })),
  delete: vi.fn((table: unknown) => ({
    where: (condition: unknown) => {
      const [workspaceId] = paramValues(condition);
      if (table === workspaceFiles) {
        if (workspaceId !== activeWorkspace.id) return { returning: async () => [] };
        const removed = storedFiles;
        storedFiles = [];
        order.push("delete-files");
        return { returning: async () => removed.map(file => ({ id: file.id })) };
      }
      if (table === workspaceFolders) {
        if (workspaceId !== activeWorkspace.id) return { returning: async () => [] };
        const removed = storedFolders;
        storedFolders = [];
        order.push("delete-folders");
        return { returning: async () => removed.map(folder => ({ id: folder.id })) };
      }
      return { returning: async () => [] };
    },
  })),
};

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => fakeDb) }));
vi.mock("./modelSecrets", () => ({ encryptModelApiKey: vi.fn(), decryptModelApiKey: vi.fn(), encryptPrivateCredential: vi.fn(), decryptPrivateCredential: vi.fn() }));
vi.mock("./e2b", () => ({
  destroyPersistentSandbox: vi.fn(async (sandboxId: string) => {
    order.push(`destroy-${sandboxId}`);
    return true;
  }),
  getE2BClient: vi.fn(() => undefined),
  initWorkspacePersistentVm: vi.fn(async (workspaceId: number, ownerId: number, knownSandboxId?: string | null) => {
    expect(knownSandboxId).toBeNull();
    void workspaceId; void ownerId;
    order.push("provision-fresh-sandbox");
    return "sbx-new";
  }),
}));

const { factoryResetWorkspaceForUser } = await import("./db");
const { destroyPersistentSandbox, initWorkspacePersistentVm } = await import("./e2b");

describe("Workspace factory reset", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://test";
    order.length = 0;
    activeWorkspace = { id: 51, ownerId: 7, persistentSandboxId: "sbx-old" };
    storedRuns = [
      { id: 1, status: "running" },
      { id: 2, status: "queued" },
      { id: 3, status: "completed" },
    ];
    storedFiles = [{ id: 11 }, { id: 12 }, { id: 13 }];
    storedFolders = [{ id: 21 }, { id: 22 }];
    vi.clearAllMocks();
  });

  it("wipes files and folders, cancels active runs, and swaps in a fresh sandbox", async () => {
    const result = await factoryResetWorkspaceForUser(7);
    expect(result).toEqual({
      success: true,
      cancelledRuns: 2,
      deletedFiles: 3,
      deletedFolders: 2,
      previousSandboxId: "sbx-old",
      sandboxId: "sbx-new",
    });
    // Runs cancel before anything is destroyed, files go before folders
    // (foreign key), the old machine dies before the fresh one is provisioned.
    expect(order).toEqual([
      "cancel-active-runs",
      "delete-files",
      "delete-folders",
      "destroy-sbx-old",
      "detach-sandbox-id",
      "provision-fresh-sandbox",
    ]);
    expect(storedFiles).toHaveLength(0);
    expect(storedFolders).toHaveLength(0);
    expect(storedRuns.every(run => run.status !== "queued" && run.status !== "running")).toBe(true);
  });

  it("never destroys a sandbox that was never provisioned", async () => {
    activeWorkspace = { id: 51, ownerId: 7, persistentSandboxId: null };
    // With no recorded sandbox, getOrCreateWorkspace attempts its own backfill
    // provisioning first; make that come back empty so the reset is the only
    // successful provisioning pass.
    vi.mocked(initWorkspacePersistentVm).mockImplementationOnce(async () => null);
    const result = await factoryResetWorkspaceForUser(7);
    expect(destroyPersistentSandbox).not.toHaveBeenCalled();
    expect(result).toMatchObject({ previousSandboxId: null, sandboxId: "sbx-new" });
    expect(initWorkspacePersistentVm).toHaveBeenCalledWith(51, 7, null);
  });

  it("still provisions a fresh sandbox when the old machine refuses to die", async () => {
    vi.mocked(destroyPersistentSandbox).mockResolvedValueOnce(false);
    const result = await factoryResetWorkspaceForUser(7);
    expect(result).toMatchObject({ success: true, previousSandboxId: "sbx-old", sandboxId: "sbx-new" });
  });
});
