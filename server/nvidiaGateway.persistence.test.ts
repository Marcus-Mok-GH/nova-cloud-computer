import { beforeEach, describe, expect, it, vi } from "vitest";
import { nvidiaInferenceAllowances, workspaces } from "../drizzle/schema";

const ownerWorkspace = { id: 41, ownerId: 7, name: "Nova", description: null, createdAt: new Date(), updatedAt: new Date() };
const otherWorkspace = { id: 42, ownerId: 8, name: "Other Nova", description: null, createdAt: new Date(), updatedAt: new Date() };
let activeWorkspace = ownerWorkspace;
let allowances = new Map<number, number>();

const fakeDb = {
  select: vi.fn(() => ({
    from: (table: unknown) => {
      if (table === workspaces) return { where: () => ({ limit: async () => [activeWorkspace] }) };
      if (table === nvidiaInferenceAllowances) {
        return { where: () => ({ limit: async () => {
          const usedRequests = allowances.get(activeWorkspace.id);
          return usedRequests === undefined ? [] : [{ id: activeWorkspace.id, workspaceId: activeWorkspace.id, usedRequests, createdAt: new Date(), updatedAt: new Date() }];
        } }) };
      }
      return { where: () => ({ limit: async () => [] }) };
    },
  })),
  execute: vi.fn(async () => {
    const previous = allowances.get(activeWorkspace.id) ?? 0;
    if (previous >= 2) return { rows: [] };
    const usedRequests = previous + 1;
    allowances.set(activeWorkspace.id, usedRequests);
    return { rows: [{ usedRequests }] };
  }),
};

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => fakeDb) }));
vi.mock("./modelSecrets", () => ({ encryptModelApiKey: vi.fn(), decryptModelApiKey: vi.fn(), encryptPrivateCredential: vi.fn(), decryptPrivateCredential: vi.fn() }));

const { claimNvidiaInferenceRequestForUser, getNvidiaInferenceAllowanceForUser } = await import("./db");

describe("NVIDIA allowance persistence", () => {
  beforeEach(() => { process.env.DATABASE_URL = "postgres://test"; activeWorkspace = ownerWorkspace; allowances = new Map(); vi.clearAllMocks(); });

  it("claims requests atomically up to the configured cap and keeps workspace counters isolated", async () => {
    expect(await getNvidiaInferenceAllowanceForUser(7)).toMatchObject({ usedRequests: 0 });
    await expect(claimNvidiaInferenceRequestForUser(7, 2)).resolves.toEqual({ usedRequests: 1 });
    await expect(claimNvidiaInferenceRequestForUser(7, 2)).resolves.toEqual({ usedRequests: 2 });
    await expect(claimNvidiaInferenceRequestForUser(7, 2)).resolves.toBeUndefined();
    expect(await getNvidiaInferenceAllowanceForUser(7)).toMatchObject({ usedRequests: 2 });

    activeWorkspace = otherWorkspace;
    expect(await getNvidiaInferenceAllowanceForUser(8)).toMatchObject({ usedRequests: 0 });
    await expect(claimNvidiaInferenceRequestForUser(8, 2)).resolves.toEqual({ usedRequests: 1 });
    expect(await getNvidiaInferenceAllowanceForUser(8)).toMatchObject({ usedRequests: 1 });
  });
});
