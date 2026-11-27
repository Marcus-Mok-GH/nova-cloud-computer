import { describe, expect, it, vi } from "vitest";
import {
  API_KEY_PREFIX,
  ApiKeyLimitError,
  createApiKeyForUser,
  findOwnerByApiKey,
  generateApiKeyRecord,
  MAX_API_KEYS_PER_OWNER,
  MAX_WORKSPACE_API_KEYS_PER_OWNER,
  scopeForApiKeyValue,
  WORKSPACE_API_KEY_PREFIX,
  type ApiKeyScope,
} from "./apiKeys";

/**
 * The two key TYPES must never be interchangeable.
 *
 * An inference key calls the model API; a workspace key drives the agent's
 * computer. A key handed to a third party is scoped to exactly one job, so a
 * workspace key must not be able to spend inference credits and an inference
 * key must not be able to touch the workspace.
 */
describe("key scopes", () => {
  it("gives each scope its own prefix", () => {
    expect(API_KEY_PREFIX).not.toBe(WORKSPACE_API_KEY_PREFIX);
    const inference = generateApiKeyRecord("scripts", "inference");
    const workspace = generateApiKeyRecord("scripts", "workspace");
    expect(inference.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(workspace.key.startsWith(WORKSPACE_API_KEY_PREFIX)).toBe(true);
    // Neither prefix is a prefix of the other, so a value can only ever
    // parse as one scope.
    expect(inference.key.startsWith(WORKSPACE_API_KEY_PREFIX)).toBe(false);
    expect(workspace.key.startsWith(API_KEY_PREFIX)).toBe(false);
  });

  it("reads the scope back from the key value", () => {
    expect(scopeForApiKeyValue(generateApiKeyRecord("a", "inference").key)).toBe("inference");
    expect(scopeForApiKeyValue(generateApiKeyRecord("a", "workspace").key)).toBe("workspace");
    expect(scopeForApiKeyValue("something-else")).toBeNull();
  });

  it("defaults to the inference scope for an existing key", () => {
    // A key created before scopes existed is an inference key.
    const record = generateApiKeyRecord("legacy");
    expect(record.scope).toBe("inference");
  });

  it("stores the scope with the key", async () => {
    const create = vi.fn(async (_ownerId: number, values: { name: string; scope: ApiKeyScope }) => ({
      id: 9,
      ownerId: 1,
      name: values.name,
      keyHash: "hash",
      keyPreview: "preview",
      scope: values.scope,
      lastUsedAt: null,
      createdAt: new Date("2026-11-27T00:00:00Z"),
      updatedAt: new Date("2026-11-27T00:00:00Z"),
    }));
    const created = await createApiKeyForUser(1, "ops", "workspace", {
      create,
      countFor: vi.fn(async () => 0),
    });
    expect(create).toHaveBeenCalledWith(1, {
      name: "ops",
      keyHash: created.key.length > 0 ? expect.any(String) : expect.any(String),
      keyPreview: expect.any(String),
      scope: "workspace",
    });
    expect(created.apiKey.scope).toBe("workspace");
    expect(created.key.startsWith(WORKSPACE_API_KEY_PREFIX)).toBe(true);
  });
});

describe("the per-scope key budget", () => {
  it("counts each scope against its own limit", async () => {
    // A workspace key can write to the agent's shell, so it gets a smaller
    // budget of its own rather than sharing the inference budget.
    const countFor = vi.fn(async (_ownerId: number, scope: ApiKeyScope) =>
      scope === "workspace" ? MAX_WORKSPACE_API_KEYS_PER_OWNER : MAX_API_KEYS_PER_OWNER
    );
    const create = vi.fn(async (_ownerId: number, values: { name: string; scope: ApiKeyScope }) => ({
      id: 1,
      ownerId: 1,
      name: values.name,
      keyHash: "hash",
      keyPreview: "preview",
      scope: values.scope,
      lastUsedAt: null,
      createdAt: new Date("2026-11-27T00:00:00Z"),
      updatedAt: new Date("2026-11-27T00:00:00Z"),
    }));

    await expect(
      createApiKeyForUser(1, "ops", "workspace", { create, countFor })
    ).rejects.toBeInstanceOf(ApiKeyLimitError);
    // The count was asked for the WORKSPACE scope, not the owner's total.
    expect(countFor).toHaveBeenCalledWith(1, "workspace");
    expect(create).not.toHaveBeenCalled();
  });

  it("lets an inference key be created while the workspace budget is full", async () => {
    const countFor = vi.fn(async (_ownerId: number, scope: ApiKeyScope) =>
      scope === "workspace" ? MAX_WORKSPACE_API_KEYS_PER_OWNER : 0
    );
    const create = vi.fn(async (_ownerId: number, values: { name: string; scope: ApiKeyScope }) => ({
      id: 2,
      ownerId: 1,
      name: values.name,
      keyHash: "hash",
      keyPreview: "preview",
      scope: values.scope,
      lastUsedAt: null,
      createdAt: new Date("2026-11-27T00:00:00Z"),
      updatedAt: new Date("2026-11-27T00:00:00Z"),
    }));
    const created = await createApiKeyForUser(1, "scripts", "inference", { create, countFor });
    expect(created.apiKey.scope).toBe("inference");
  });

  it("names the scope in the limit message", async () => {
    const countFor = vi.fn(async () => MAX_WORKSPACE_API_KEYS_PER_OWNER);
    await expect(
      createApiKeyForUser(1, "ops", "workspace", {
        create: vi.fn(),
        countFor,
      })
    ).rejects.toThrow(/workspace keys/i);
  });
});

describe("findOwnerByApiKey scope enforcement", () => {
  it("resolves an owner for a key of the required scope", async () => {
    const key = generateApiKeyRecord("a", "workspace").key;
    const lookup = vi.fn(async () => ({ ownerId: 42, scope: "workspace" as const }));
    const touch = vi.fn(async () => {});
    const ownerId = await findOwnerByApiKey(key, { scope: "workspace", lookup, touch });
    expect(ownerId).toBe(42);
    expect(touch).toHaveBeenCalledWith(42);
  });

  it("refuses a workspace key on the inference scope without touching the database", async () => {
    // The prefix alone is enough to refuse: no lookup happens at all, so a
    // workspace key can never spend an inference credit.
    const lookup = vi.fn(async () => ({ ownerId: 42, scope: "workspace" }));
    const ownerId = await findOwnerByApiKey(generateApiKeyRecord("a", "workspace").key, {
      scope: "inference",
      lookup,
      touch: vi.fn(async () => {}),
    });
    expect(ownerId).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses an inference key on the workspace scope", async () => {
    const lookup = vi.fn(async () => ({ ownerId: 42, scope: "inference" }));
    const ownerId = await findOwnerByApiKey(generateApiKeyRecord("a", "inference").key, {
      scope: "workspace",
      lookup,
      touch: vi.fn(async () => {}),
    });
    expect(ownerId).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a key whose stored scope disagrees with its prefix", async () => {
    // The stored scope is authoritative: a row whose scope was changed must
    // not keep working under the scope its prefix advertises.
    const ownerId = await findOwnerByApiKey(generateApiKeyRecord("a", "workspace").key, {
      scope: "workspace",
      lookup: async () => ({ ownerId: 42, scope: "inference" }),
      touch: vi.fn(async () => {}),
    });
    expect(ownerId).toBeNull();
  });

  it("resolves a key with no scope requirement, as before", async () => {
    const ownerId = await findOwnerByApiKey(generateApiKeyRecord("a", "inference").key, {
      lookup: async () => ({ ownerId: 7, scope: "inference" }),
      touch: vi.fn(async () => {}),
    });
    expect(ownerId).toBe(7);
  });
});
