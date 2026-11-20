import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Workspace environment variables are secrets: the settings page lists NAMES
 * only, so the list path must never decrypt and the save path must never echo
 * a value back. A blank submitted value keeps an already-stored secret, which
 * is what lets the browser edit the set without downloading anything.
 */
type EnvVarRow = { id: number; workspaceId: number; name: string; encryptedValue: string };

const state = vi.hoisted(() => ({
  rows: [] as EnvVarRow[],
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  deletes: 0,
}));

const encryptSpy = vi.hoisted(() => vi.fn((value: string) => `enc:${value}`));
const decryptSpy = vi.hoisted(() => vi.fn((value: string) => `dec:${value}`));

vi.mock("./core", () => {
  // Drizzle chains read as `select().from().where().orderBy()` or are awaited
  // right after `where()`, so the builder is a Promise with query methods.
  const thenableBuilder = (rows: unknown[]) => Object.assign(Promise.resolve(rows), {
    from: () => thenableBuilder(rows),
    where: () => thenableBuilder(rows),
    orderBy: async () => rows,
    limit: async () => rows,
  });
  return {
    requireDb: async () => ({
      select: () => thenableBuilder(state.rows),
      insert: () => ({ values: async (values: Record<string, unknown>) => { state.inserts.push(values); } }),
      update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { state.updates.push(values); } }) }),
      delete: () => ({ where: async () => { state.deletes += 1; } }),
    }),
  };
});

vi.mock("./workspace", () => ({ getOrCreateWorkspace: async () => ({ id: 41, ownerId: 7, name: "Space" }) }));
vi.mock("../modelSecrets", () => ({ encryptPrivateCredential: encryptSpy, decryptPrivateCredential: decryptSpy }));

import { listWorkspaceEnvVarSummariesForUser, listWorkspaceEnvVarsForUser, saveWorkspaceEnvVarsForUser } from "./envVars";

describe("workspace environment variables", () => {
  beforeEach(() => {
    state.rows = [];
    state.inserts = [];
    state.updates = [];
    state.deletes = 0;
    encryptSpy.mockClear();
    decryptSpy.mockClear();
  });

  it("lists names and configured flags without decrypting any stored value", async () => {
    state.rows = [
      { id: 2, workspaceId: 41, name: "OPENAI_API_KEY", encryptedValue: "enc:aaa" },
      { id: 1, workspaceId: 41, name: "STRIPE_API_KEY", encryptedValue: "enc:bbb" },
    ];
    const summaries = await listWorkspaceEnvVarSummariesForUser(7);
    expect(summaries).toEqual([
      { name: "OPENAI_API_KEY", configured: true },
      { name: "STRIPE_API_KEY", configured: true },
    ]);
    expect(JSON.stringify(summaries)).not.toContain("enc:");
    expect(decryptSpy).not.toHaveBeenCalled();
  });

  it("still resolves full values server-side for deploy-time use", async () => {
    state.rows = [{ id: 1, workspaceId: 41, name: "STRIPE_API_KEY", encryptedValue: "ciphertext-bbb" }];
    await expect(listWorkspaceEnvVarsForUser(7)).resolves.toEqual([
      { name: "STRIPE_API_KEY", value: "dec:ciphertext-bbb" },
    ]);
    expect(decryptSpy).toHaveBeenCalledWith("ciphertext-bbb");
  });

  it("keeps a stored secret when the submitted value is blank and echoes names only", async () => {
    state.rows = [{ id: 1, workspaceId: 41, name: "STRIPE_API_KEY", encryptedValue: "enc:old" }];
    const saved = await saveWorkspaceEnvVarsForUser(7, [{ name: "stripe_api_key", value: "" }]);
    expect(saved).toEqual([{ name: "STRIPE_API_KEY", configured: true }]);
    expect(JSON.stringify(saved)).not.toContain("enc:old");
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
    expect(state.deletes).toBe(0);
    expect(encryptSpy).not.toHaveBeenCalled();
  });

  it("replaces a typed value, adds new names, and removes omitted ones", async () => {
    state.rows = [
      { id: 1, workspaceId: 41, name: "KEPT_KEY", encryptedValue: "enc:kept" },
      { id: 2, workspaceId: 41, name: "GONE_KEY", encryptedValue: "enc:gone" },
    ];
    const saved = await saveWorkspaceEnvVarsForUser(7, [
      { name: "KEPT_KEY", value: "" },
      { name: "NEW_KEY", value: "fresh-secret" },
    ]);
    expect(saved.map(entry => entry.name).sort()).toEqual(["KEPT_KEY", "NEW_KEY"]);
    expect(state.deletes).toBe(1);
    expect(state.inserts).toHaveLength(1);
    expect(state.updates).toHaveLength(0);
    expect(encryptSpy).toHaveBeenCalledTimes(1);
    expect(encryptSpy).toHaveBeenCalledWith("fresh-secret");
  });

  it("drops a blank value for a name that is not stored yet", async () => {
    state.rows = [];
    const saved = await saveWorkspaceEnvVarsForUser(7, [{ name: "NEVER_STORED", value: "" }]);
    expect(saved).toEqual([]);
    expect(state.inserts).toHaveLength(0);
    expect(state.deletes).toBe(0);
  });
});
