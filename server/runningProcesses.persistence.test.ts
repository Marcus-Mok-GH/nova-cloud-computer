import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentRuns, runningProcesses, workspaces } from "../drizzle/schema";

process.env.DATABASE_URL = "postgres://test";

type StoredProcess = {
  id: number;
  workspaceId: number;
  chatId: string | null;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  heartbeatAt: Date;
  attempts: number;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
};
type StoredRun = {
  id: number;
  workspaceId: number;
  chatId: string;
  status: string;
  segment: number;
  errorMessage: string | null;
  completedAt: Date | null;
};

const workspaceRow = {
  id: 51,
  ownerId: 7,
  name: "Nova",
  description: null,
  persistentSandboxId: "sbx-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};
let processes: StoredProcess[] = [];
let runs: StoredRun[] = [];
let nextProcessId = 1;

/** Recursively pulls parameter values out of a drizzle condition tree (builder Params carry brand/encoder; raw sql templates inline params as bare primitives inside queryChunks). */
function paramValues(condition: unknown): unknown[] {
  const primitive = (value: unknown): value is string | number =>
    typeof value === "string" || typeof value === "number";
  if (primitive(condition)) return [condition];
  if (!condition || typeof condition !== "object") return [];
  const chunks = (condition as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) return chunks.flatMap(paramValues);
  const { value } = condition as { value?: unknown };
  if (primitive(value) || value instanceof Date)
    return [value as string | number | Date];
  if (Array.isArray(value))
    return value.filter(item => primitive(item) || item instanceof Date);
  return [];
}

/**
 * Params split by shape (drizzle keeps eq() values - including enum values -
 * as bound params, while inArray() values are inlined), so each helper's
 * condition is recognized by what it carries: an id, a Date cutoff, and the
 * "running" status guard.
 */
function classifyParams(condition: unknown) {
  const values = paramValues(condition);
  return {
    dates: values.filter((value): value is Date => value instanceof Date),
    numbers: values.filter(
      (value): value is number => typeof value === "number"
    ),
    strings: values.filter(
      (value): value is string => typeof value === "string"
    ),
  };
}

const fakeDb = {
  // The raw conditional claim, mirroring the SQL semantics: stale rows only,
  // capped attempts, one attempt charged per winning claim. The cutoff rides
  // along as an ISO string because the claim runs through raw SQL.
  execute: vi.fn(async (query: unknown) => {
    const { dates, numbers, strings } = classifyParams(query);
    const [id, maxAttempts] = numbers;
    const iso = strings.find(value => /^\d{4}-\d{2}-\d{2}T/.test(value));
    const staleBefore = iso ? new Date(iso) : dates[0];
    const row = processes.find(process => process.id === id);
    if (
      !row ||
      row.status !== "running" ||
      !staleBefore ||
      !(row.heartbeatAt < staleBefore) ||
      typeof maxAttempts !== "number" ||
      row.attempts >= maxAttempts
    )
      return { rows: [] };
    row.attempts += 1;
    row.heartbeatAt = new Date();
    return { rows: [{ id: row.id }] };
  }),
  select: vi.fn((fields?: Record<string, unknown>) => ({
    from: (table: unknown) => ({
      where: (condition: unknown) => {
        const matching = (): unknown[] => {
          if (table === workspaces) return [workspaceRow];
          if (table === agentRuns)
            return runs.filter(run => paramValues(condition).includes(run.id));
          const { dates, numbers, strings } = classifyParams(condition);
          if (fields) {
            // Projected point queries: hasLiveRunningProcessForChat (aliveSince
            // cutoff), hasOpenEditorProcessForChat (kind filter), both with the
            // excluded row id as the last number.
            const aliveSince = dates[0];
            const excludeId = numbers[numbers.length - 1];
            const kind = strings.find(
              value => value === "editor" || value === "agent_run"
            );
            const chatId = strings.find(value => value.startsWith("chat-"));
            return processes.filter(
              process =>
                process.status === "running" &&
                (!aliveSince || process.heartbeatAt > aliveSince) &&
                (kind === undefined || process.kind === kind) &&
                (chatId === undefined || process.chatId === chatId) &&
                (excludeId === undefined || process.id !== excludeId)
            );
          }
          if (dates.length > 0) {
            // listStaleRunningProcesses: live rows older than the cutoff.
            const staleBefore = dates[0];
            return processes.filter(
              process =>
                process.status === "running" &&
                process.heartbeatAt < staleBefore
            );
          }
          // Point lookup by id (the claim's follow-up select).
          const id = numbers[0];
          return processes.filter(process => process.id === id);
        };
        return {
          orderBy: () => ({
            limit: async (n: number) => matching().slice(0, n),
          }),
          limit: async (n: number) => matching().slice(0, n),
        };
      },
      orderBy: () => ({ limit: async (n: number) => processes.slice(0, n) }),
    }),
  })),
  insert: vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        if (table !== runningProcesses) return [];
        const row: StoredProcess = {
          id: nextProcessId++,
          workspaceId: values.workspaceId as number,
          chatId: (values.chatId as string | null) ?? null,
          kind: values.kind as string,
          status: "running",
          payload: (values.payload as Record<string, unknown>) ?? {},
          heartbeatAt: new Date(),
          attempts: 0,
          errorMessage: null,
          startedAt: new Date(),
          completedAt: null,
        };
        processes.push(row);
        return [row];
      },
    }),
  })),
  update: vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (condition: unknown) => {
        const apply = () => {
          const { numbers, strings } = classifyParams(condition);
          const id = numbers[0];
          const liveOnly = strings.includes("running");
          const targets =
            table === runningProcesses
              ? processes.filter(
                  process =>
                    (id === undefined || process.id === id) &&
                    (!liveOnly || process.status === "running")
                )
              : table === agentRuns
                ? runs.filter(
                    run =>
                      paramValues(condition).includes(run.id) &&
                      ["running", "awaiting_continue"].includes(run.status)
                  )
                : [];
          for (const target of targets) Object.assign(target, values);
          return targets;
        };
        // The chain is awaitable without .returning() (heartbeat-style
        // updates) and exposes .returning() for the closing ones.
        return {
          returning: async () => apply(),
          then: (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve().then(apply).then(onFulfilled, onRejected),
        };
      },
    }),
  })),
};

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => fakeDb) }));
vi.mock("./modelSecrets", () => ({
  encryptModelApiKey: vi.fn(),
  decryptModelApiKey: vi.fn(),
  encryptPrivateCredential: vi.fn(),
  decryptPrivateCredential: vi.fn(),
}));

const {
  registerRunningProcess,
  heartbeatRunningProcesses,
  finishRunningProcess,
  listStaleRunningProcesses,
  claimRunningProcess,
  failRunningProcess,
  hasLiveRunningProcessForChat,
  hasOpenEditorProcessForChat,
  getAgentRunById,
  failAgentRunById,
  getWorkspaceById,
} = await import("./db");

const staleBefore = new Date("2026-10-14T07:00:00.000Z");

function seedProcess(overrides: Partial<StoredProcess> = {}): StoredProcess {
  const row: StoredProcess = {
    id: nextProcessId++,
    workspaceId: 51,
    chatId: "chat-abc",
    kind: "editor",
    status: "running",
    payload: { task: "build the site" },
    heartbeatAt: new Date("2026-10-14T06:00:00.000Z"),
    attempts: 0,
    errorMessage: null,
    startedAt: new Date("2026-10-14T05:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
  processes.push(row);
  return row;
}

describe("Running-process ledger helpers", () => {
  beforeEach(() => {
    processes = [];
    runs = [];
    nextProcessId = 1;
    vi.clearAllMocks();
  });

  it("registers a live row with its stored payload before the work starts", async () => {
    const row = await registerRunningProcess({
      workspaceId: 51,
      chatId: "chat-abc",
      kind: "editor",
      payload: {
        task: "build the site",
        context: "the existing app",
        language: "ts",
      },
    });
    expect(row?.status).toBe("running");
    expect(row?.payload).toEqual({
      task: "build the site",
      context: "the existing app",
      language: "ts",
    });
    expect(row?.attempts).toBe(0);
    expect(row?.heartbeatAt).toBeInstanceOf(Date);
  });

  it("beats the heartbeat of live rows only, and closes only live rows", async () => {
    const live = seedProcess({
      heartbeatAt: new Date("2026-10-14T06:00:00.000Z"),
    });
    const closed = seedProcess({
      status: "completed",
      heartbeatAt: new Date("2026-10-14T06:00:00.000Z"),
    });
    await heartbeatRunningProcesses([live.id, closed.id]);
    expect(live.heartbeatAt.getTime()).toBeGreaterThan(
      new Date("2026-10-14T06:30:00.000Z").getTime()
    );
    expect(closed.heartbeatAt.toISOString()).toBe("2026-10-14T06:00:00.000Z");

    expect(await finishRunningProcess(closed.id, "completed")).toBeUndefined();
    await finishRunningProcess(live.id, "failed", "specialist down");
    expect(live.status).toBe("failed");
    expect(live.errorMessage).toBe("specialist down");
    expect(live.completedAt).not.toBeNull();
  });

  it("lists only live rows whose beacon stopped before the cutoff", async () => {
    const killed = seedProcess({
      heartbeatAt: new Date("2026-10-14T06:50:00.000Z"),
    });
    seedProcess({ heartbeatAt: new Date("2026-10-14T07:00:30.000Z") }); // still beating
    seedProcess({
      status: "completed",
      heartbeatAt: new Date("2026-10-14T06:00:00.000Z"),
    }); // closed
    const stale = await listStaleRunningProcesses(staleBefore, 10);
    expect(stale.map(row => row.id)).toEqual([killed.id]);
  });

  it("claims a stale row exactly once and charges one attempt per claim", async () => {
    const killed = seedProcess({
      heartbeatAt: new Date("2026-10-14T06:50:00.000Z"),
      attempts: 1,
    });
    const first = await claimRunningProcess(killed.id, staleBefore, 2);
    expect(first?.id).toBe(killed.id);
    expect(killed.attempts).toBe(2);
    // A second sweep finds no attempts left, so its claim loses.
    expect(
      await claimRunningProcess(killed.id, staleBefore, 2)
    ).toBeUndefined();
    expect(killed.attempts).toBe(2);

    // A row whose beacon is still beating (after the cutoff) is never claimable.
    const fresh = seedProcess({
      heartbeatAt: new Date("2026-10-14T07:00:30.000Z"),
    });
    expect(await claimRunningProcess(fresh.id, staleBefore, 2)).toBeUndefined();
    expect(fresh.attempts).toBe(0);
  });

  it("dead-letters a row even after it was claimed", async () => {
    const killed = seedProcess({
      heartbeatAt: new Date("2026-10-14T06:50:00.000Z"),
    });
    await claimRunningProcess(killed.id, staleBefore, 2);
    await failRunningProcess(
      killed.id,
      "the platform killed this process on every resume attempt"
    );
    expect(killed.status).toBe("failed");
    expect(killed.errorMessage).toContain("killed");
  });

  it("sees a live sibling process in the same chat, but never the row itself or closed rows", async () => {
    const dead = seedProcess({
      heartbeatAt: new Date("2026-10-14T06:50:00.000Z"),
    });
    const liveSibling = seedProcess({
      heartbeatAt: new Date("2026-10-14T07:00:30.000Z"),
    });
    expect(
      await hasLiveRunningProcessForChat("chat-abc", dead.id, staleBefore)
    ).toBe(true);
    expect(
      await hasLiveRunningProcessForChat(
        "chat-abc",
        liveSibling.id,
        staleBefore
      )
    ).toBe(false);
    liveSibling.status = "completed";
    expect(
      await hasLiveRunningProcessForChat("chat-abc", dead.id, staleBefore)
    ).toBe(false);
  });

  it("sees an open editor row in the chat regardless of its heartbeat, and only that kind", async () => {
    const staleEditor = seedProcess({
      kind: "editor",
      heartbeatAt: new Date("2026-10-14T06:50:00.000Z"),
    });
    seedProcess({
      kind: "agent_run",
      heartbeatAt: new Date("2026-10-14T07:00:30.000Z"),
    });
    seedProcess({
      kind: "editor",
      chatId: "chat-other",
      heartbeatAt: new Date("2026-10-14T07:00:30.000Z"),
    });
    // The stale editor row is still open - it is waiting to be claimed, so a
    // deferred run must keep waiting.
    expect(await hasOpenEditorProcessForChat("chat-abc", 999)).toBe(true);
    // Closed editors no longer hold the chat.
    processes.find(process => process.id === staleEditor.id)!.status =
      "completed";
    expect(await hasOpenEditorProcessForChat("chat-abc", 999)).toBe(false);
  });

  it("closes a run ledger row only while it is still open, and looks runs and workspaces up by id", async () => {
    runs.push({
      id: 9,
      workspaceId: 51,
      chatId: "chat-abc",
      status: "running",
      segment: 3,
      errorMessage: null,
      completedAt: null,
    });
    const run = await getAgentRunById(9);
    expect(run?.segment).toBe(3);
    await failAgentRunById(9, "resume budget spent");
    expect(runs[0].status).toBe("failed");
    expect(runs[0].errorMessage).toBe("resume budget spent");

    runs.push({
      id: 10,
      workspaceId: 51,
      chatId: "chat-abc",
      status: "completed",
      segment: 1,
      errorMessage: null,
      completedAt: new Date(),
    });
    expect(
      await failAgentRunById(10, "must not touch a closed run")
    ).toBeUndefined();
    expect(runs[1].status).toBe("completed");

    const workspace = await getWorkspaceById(51);
    expect(workspace?.ownerId).toBe(7);
    expect(workspace?.persistentSandboxId).toBe("sbx-1");
  });
});
