import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentStopRequests, agentVmRuns, users, workspaces } from "../drizzle/schema";

type StoredStop = { id: number; ownerId: number; chatId: number | null; createdAt: Date };
type StoredRun = { id: number; workspaceId: number; chatId: number | null; status: string; errorMessage: string | null; completedAt: Date | null };
const ownerWorkspace = { id: 51, ownerId: 7, name: "Nova", description: null, createdAt: new Date(), updatedAt: new Date() };
const otherWorkspace = { id: 52, ownerId: 8, name: "Other", description: null, createdAt: new Date(), updatedAt: new Date() };
let activeWorkspace = ownerWorkspace;
let stops: StoredStop[] = [];
let runs: StoredRun[] = [];
let nextStopId = 1;

/** Recursively pulls drizzle Param values out of a where-condition tree. */
function paramValues(condition: unknown): unknown[] {
  if (!condition || typeof condition !== "object") return [];
  if (Array.isArray((condition as { queryChunks?: unknown[] }).queryChunks)) {
    return ((condition as { queryChunks: unknown[] }).queryChunks).flatMap(paramValues);
  }
  const maybe = condition as { value?: unknown; brand?: unknown; encoder?: unknown };
  if ("brand" in maybe && "encoder" in maybe) return [maybe.value];
  return [];
}

const fakeDb = {
  execute: vi.fn(async () => ({ rows: [{ now: new Date("2026-09-16T05:30:00.000Z") }] })),
  select: vi.fn((fields?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      if (table === workspaces) return { where: () => ({ limit: async () => [activeWorkspace] }) };
      if (table === agentStopRequests) {
        return {
          where: (condition: unknown) => {
            const params = paramValues(condition);
            const [ownerId, startedAt] = [params[0], params[1]];
            const chatId = params.length > 2 ? (params[2] as number) : undefined;
            return {
              limit: async () =>
                stops
                  .filter(stop => stop.ownerId === ownerId)
                  .filter(stop => chatId === undefined || stop.chatId === null || stop.chatId === chatId)
                  .filter(stop => !startedAt || stop.createdAt > new Date(startedAt as string))
                  .slice(0, 1),
            };
          },
        };
      }
      if (table === agentVmRuns && fields && "id" in fields) {
        return { where: () => ({ returning: async () => runs.filter(run => run.workspaceId === activeWorkspace.id) }) };
      }
      return { where: () => ({ limit: async () => [] }) };
    },
  })),
  insert: vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        if (table !== agentStopRequests) return [];
        const row: StoredStop = { id: nextStopId++, ownerId: values.ownerId as number, chatId: (values.chatId as number | null) ?? null, createdAt: new Date("2026-09-16T05:15:00.000Z") };
        stops.push(row);
        return [row];
      },
    }),
  })),
  update: vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (condition: unknown) => ({
        returning: async () => {
          if (table !== agentVmRuns) return [];
          const params = paramValues(condition);
          // inArray status values are inlined (not bound params) in this
          // drizzle version, so params are [workspaceId] unscoped and
          // [workspaceId, chatId] when the cancel is chat-scoped.
          const chatId = params.length > 1 ? (params[params.length - 1] as number) : undefined;
          const affected = runs
            .filter(run => run.workspaceId === activeWorkspace.id && ["queued", "running"].includes(run.status))
            .filter(run => chatId === undefined || run.chatId === chatId);
          for (const run of affected) {
            Object.assign(run, values);
            run.status = "cancelled";
          }
          return affected;
        },
      }),
    }),
  })),
  delete: vi.fn(() => ({
    where: (condition: unknown) => {
      const [ownerId] = paramValues(condition);
      stops = stops.filter(stop => stop.ownerId !== ownerId);
      return {};
    },
  })),
};

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => fakeDb) }));
vi.mock("./modelSecrets", () => ({ encryptModelApiKey: vi.fn(), decryptModelApiKey: vi.fn(), encryptPrivateCredential: vi.fn(), decryptPrivateCredential: vi.fn() }));

const { getDatabaseTime, requestAgentStopForUser, hasAgentStopAfter, cancelActiveAgentVmRunsForUser } = await import("./db");

describe("Agent stop requests", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://test";
    activeWorkspace = ownerWorkspace;
    stops = [];
    runs = [];
    nextStopId = 1;
    vi.clearAllMocks();
  });

  it("returns the database clock", async () => {
    expect(await getDatabaseTime()).toEqual(new Date("2026-09-16T05:30:00.000Z"));
  });

  it("records a fresh stop request, replacing any older one", async () => {
    const first = await requestAgentStopForUser(7);
    expect(first).toMatchObject({ ownerId: 7 });
    await requestAgentStopForUser(7);
    expect(stops.filter(stop => stop.ownerId === 7)).toHaveLength(1);
  });

  it("flags only runs that started before the stop request", async () => {
    const startedBefore = new Date("2026-09-16T05:00:00.000Z");
    await requestAgentStopForUser(7);
    expect(await hasAgentStopAfter(7, undefined, startedBefore)).toBe(true);
    const startedAfter = new Date("2026-09-16T06:00:00.000Z");
    expect(await hasAgentStopAfter(7, undefined, startedAfter)).toBe(false);
  });

  it("scopes a chat stop to its conversation, but a workspace-wide stop matches every chat", async () => {
    const startedBefore = new Date("2026-09-16T05:00:00.000Z");
    await requestAgentStopForUser(7, 31);
    expect(await hasAgentStopAfter(7, 31, startedBefore)).toBe(true);
    expect(await hasAgentStopAfter(7, 32, startedBefore)).toBe(false);

    await requestAgentStopForUser(7);
    expect(await hasAgentStopAfter(7, 32, startedBefore)).toBe(true);
  });

  it("keeps other owners' flags isolated", async () => {
    await requestAgentStopForUser(7);
    expect(await hasAgentStopAfter(8, undefined, new Date("2026-09-16T05:00:00.000Z"))).toBe(false);
  });

  it("cancels queued and running VM runs only for the owner's workspace", async () => {
    runs.push({ id: 1, workspaceId: 51, chatId: null, status: "running", errorMessage: null, completedAt: null });
    runs.push({ id: 2, workspaceId: 51, chatId: null, status: "queued", errorMessage: null, completedAt: null });
    const cancelled = await cancelActiveAgentVmRunsForUser(7);
    expect(cancelled).toBe(2);

    activeWorkspace = otherWorkspace;
    runs.push({ id: 3, workspaceId: 52, chatId: null, status: "running", errorMessage: null, completedAt: null });
    expect(await cancelActiveAgentVmRunsForUser(8)).toBe(1);
  });

  it("cancels only the given chat's VM runs when the cancel is chat-scoped", async () => {
    runs.push({ id: 1, workspaceId: 51, chatId: 31, status: "running", errorMessage: null, completedAt: null });
    runs.push({ id: 2, workspaceId: 51, chatId: 32, status: "running", errorMessage: null, completedAt: null });
    expect(await cancelActiveAgentVmRunsForUser(7, 31)).toBe(1);
    expect(runs.find(run => run.id === 2)?.status).toBe("running");
  });
});
