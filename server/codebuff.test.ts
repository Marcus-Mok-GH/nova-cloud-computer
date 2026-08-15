import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clientOptions: undefined as Record<string, unknown> | undefined,
  run: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
  artifacts: [] as Array<Record<string, unknown>>,
  credentials: { apiKey: "cb_private_key_123456789" } as { apiKey: string } | undefined,
}));

vi.mock("@codebuff/sdk", () => ({
  CodebuffClient: vi.fn().mockImplementation((options: Record<string, unknown>) => { state.clientOptions = options; return { run: state.run }; }),
}));
vi.mock("./db", () => ({
  getCodebuffSettingsForUser: vi.fn(async () => ({ configured: Boolean(state.credentials), updatedAt: new Date() })),
  getCodebuffCredentialsForUser: vi.fn(async () => state.credentials),
  getActiveAgentVmRunForUser: vi.fn(async () => undefined),
  getWorkspaceFilesByIdsForUser: vi.fn(async (_owner: number, ids: number[]) => ids.map(id => ({ id, name: id === 9 ? "notes.md" : "main.ts", content: id === 9 ? "launch notes" : "export const main = true;" }))),
  createAgentVmRunForUser: vi.fn(async () => ({ id: 42, provider: "codebuff", task: "plan", status: "queued" })),
  updateAgentVmRunForUser: vi.fn(async (_owner: number, _id: number, update: Record<string, unknown>) => { state.updates.push(update); return { id: 42, provider: "codebuff", ...update }; }),
  createWorkspaceFileForUser: vi.fn(async (_owner: number, file: Record<string, unknown>) => { state.artifacts.push(file); return { id: 88, ...file }; }),
}));
const { getCodebuffPlannerStatus, startCodebuffPlannerRun } = await import("./codebuff");

describe("Codebuff planning adapter", () => {
  beforeEach(() => {
    state.clientOptions = undefined; state.updates = []; state.artifacts = []; state.credentials = { apiKey: "cb_private_key_123456789" };
    state.run.mockReset();
    state.run.mockResolvedValue({ output: { type: "structuredOutput", value: { summary: "Review the release work.", steps: ["Read notes", "Prepare draft"], cautions: ["Confirm scope"] } } });
  });

  it("runs a bounded tool-free planner with exactly the selected workspace bundle and saves a private result artifact", async () => {
    const result = await startCodebuffPlannerRun(7, { prompt: "Plan the release", fileIds: [9, 11] });
    expect(result.plan).toMatchObject({ summary: "Review the release work.", selectedFileNames: ["notes.md", "main.ts"] });
    expect(state.clientOptions).toMatchObject({ apiKey: "cb_private_key_123456789", maxAgentSteps: 6, env: {} });
    expect(state.clientOptions?.projectFiles).toEqual({ "workspace/9-notes.md": "launch notes", "workspace/11-main.ts": "export const main = true;" });
    const agents = state.clientOptions?.agentDefinitions as Array<{ toolNames: string[] }>;
    expect(agents[0]?.toolNames).toEqual([]);
    expect(state.artifacts[0]).toMatchObject({ name: "codebuff-plan-42.md", mimeType: "text/markdown" });
    expect(state.artifacts[0]?.content).toContain("Selected files sent to Codebuff");
    expect(JSON.stringify(result)).not.toContain("cb_private_key_123456789");
  });

  it("does not instantiate the SDK when no private key is configured", async () => {
    state.credentials = undefined;
    const result = await startCodebuffPlannerRun(7, { prompt: "Plan the release", fileIds: [9] });
    expect(result).toMatchObject({ configured: false, run: null, plan: null });
    expect(state.clientOptions).toBeUndefined();
  });

  it("returns only a safe bounded configuration status", async () => {
    await expect(getCodebuffPlannerStatus(7)).resolves.toMatchObject({ configured: true, provider: "codebuff", limits: { execution: "planning_only", maxAgentSteps: 6, maxSelectedFiles: 12 } });
  });
});
