import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentVmRuns, workspaces } from "../drizzle/schema";

type StoredRun = { id: number; workspaceId: number; provider: string; sandboxId: string | null; task: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "disabled"; resultSummary: string | null; errorMessage: string | null; artifactFileId: number | null; startedAt: Date | null; completedAt: Date | null; createdAt: Date; updatedAt: Date };
const ownerWorkspace = { id: 31, ownerId: 7, name: "Nova", description: null, createdAt: new Date(), updatedAt: new Date() };
const otherWorkspace = { id: 32, ownerId: 8, name: "Other Nova", description: null, createdAt: new Date(), updatedAt: new Date() };
let activeWorkspace = ownerWorkspace;
let runs: StoredRun[] = [];
let nextRunId = 1;

const fakeDb = {
  select: vi.fn((fields?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      if (table === workspaces) return { where: () => ({ limit: async () => [activeWorkspace] }) };
      if (table === agentVmRuns) {
        const workspaceRuns = () => runs.filter(run => run.workspaceId === activeWorkspace.id);
        if (fields && "total" in fields) return { where: async () => [{ total: workspaceRuns().length }] };
        return { where: () => ({ limit: async () => workspaceRuns().slice(0, 1), orderBy: () => ({ limit: async () => workspaceRuns() }) }) };
      }
      return { where: () => ({ limit: async () => [] }) };
    },
  })),
  insert: vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        if (table !== agentVmRuns) return [];
        const run: StoredRun = { id: nextRunId++, workspaceId: values.workspaceId as number, provider: (values.provider as string) ?? "e2b", sandboxId: null, task: values.task as string, status: (values.status as StoredRun["status"]) ?? "queued", resultSummary: null, errorMessage: null, artifactFileId: null, startedAt: null, completedAt: null, createdAt: new Date(), updatedAt: new Date() };
        runs.push(run);
        return [run];
      },
    }),
  })),
  update: vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          if (table !== agentVmRuns) return [];
          const run = runs.find(candidate => candidate.workspaceId === activeWorkspace.id);
          if (!run) return [];
          Object.assign(run, values);
          return [run];
        },
      }),
    }),
  })),
  delete: vi.fn(),
};

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => fakeDb) }));
vi.mock("./modelSecrets", () => ({ encryptModelApiKey: vi.fn(), decryptModelApiKey: vi.fn(), encryptPrivateCredential: vi.fn(), decryptPrivateCredential: vi.fn() }));

const { countAgentVmRunsForUser, createAgentVmRunForUser, getActiveAgentVmRunForUser, listAgentVmRunsForUser, updateAgentVmRunForUser } = await import("./db");

describe("E2B run persistence", () => {
  beforeEach(() => { process.env.DATABASE_URL = "postgres://test"; activeWorkspace = ownerWorkspace; runs = []; nextRunId = 1; vi.clearAllMocks(); });

  it("tracks lifecycle and artifact state only inside the owning workspace", async () => {
    const queued = await createAgentVmRunForUser(7, { task: "Inspect private notes" });
    expect(queued).toMatchObject({ id: 1, status: "queued", provider: "e2b" });
    const running = await updateAgentVmRunForUser(7, queued.id, { status: "running", sandboxId: "sbx-owner", startedAt: new Date() });
    expect(running).toMatchObject({ status: "running", sandboxId: "sbx-owner" });
    expect(await getActiveAgentVmRunForUser(7)).toMatchObject({ id: queued.id, status: "running" });
    const completed = await updateAgentVmRunForUser(7, queued.id, { status: "succeeded", resultSummary: "Notes inspected", artifactFileId: 44, completedAt: new Date() });
    expect(completed).toMatchObject({ status: "succeeded", artifactFileId: 44, resultSummary: "Notes inspected" });
    expect(await listAgentVmRunsForUser(7)).toHaveLength(1);
    expect(await countAgentVmRunsForUser(7)).toBe(1);

    activeWorkspace = otherWorkspace;
    expect(await listAgentVmRunsForUser(8)).toEqual([]);
    expect(await countAgentVmRunsForUser(8)).toBe(0);
    expect(await updateAgentVmRunForUser(8, queued.id, { status: "cancelled" })).toBeUndefined();
  });
});
