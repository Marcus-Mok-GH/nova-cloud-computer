import { describe, expect, it, vi } from "vitest";
import {
  ApiKeyLimitError,
  API_KEY_PREFIX,
  createApiKeyForUser,
  findOwnerByApiKey,
  generateApiKeyRecord,
  hashApiKey,
  MAX_API_KEYS_PER_OWNER,
  renameApiKeyForUser,
} from "./apiKeys";

describe("API key generation", () => {
  it("creates prefixed keys with hashed and preview fields", () => {
    const record = generateApiKeyRecord("  nightly scripts  ");
    expect(record.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(record.key.length).toBeGreaterThan(API_KEY_PREFIX.length + 40);
    expect(record.keyHash).toBe(hashApiKey(record.key));
    expect(record.keyHash).toHaveLength(64);
    expect(record.keyPreview.startsWith(`${API_KEY_PREFIX}`)).toBe(true);
    expect(record.keyPreview.endsWith("…")).toBe(true);
    expect(record.name).toBe("nightly scripts");
  });

  it("generates unique keys", () => {
    const first = generateApiKeyRecord("one");
    const second = generateApiKeyRecord("two");
    expect(first.key).not.toBe(second.key);
    expect(first.keyHash).not.toBe(second.keyHash);
  });

  it("hashes are deterministic and collision-free for different keys", () => {
    expect(hashApiKey("nova_sk_a")).not.toBe(hashApiKey("nova_sk_b"));
    expect(hashApiKey("nova_sk_a")).toBe(hashApiKey("nova_sk_a"));
  });
});

describe("createApiKeyForUser", () => {
  it("returns the full key exactly once and a safe record for lists", async () => {
    const create = vi.fn(async (_ownerId: number, values: { name: string }) => ({
      id: 7,
      ownerId: 1,
      name: values.name,
      keyHash: "hash",
      keyPreview: "preview",
      lastUsedAt: null,
      createdAt: new Date("2026-09-27T00:00:00Z"),
      updatedAt: new Date("2026-09-27T00:00:00Z"),
    }));
    const created = await createApiKeyForUser(1, "scripts", { create, countFor: vi.fn(async () => 0) });
    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.apiKey).toEqual({ id: 7, name: "scripts", keyPreview: "preview", createdAt: new Date("2026-09-27T00:00:00Z"), lastUsedAt: null });
    expect(JSON.stringify(created.apiKey)).not.toContain(created.key);
  });

  it("refuses to exceed the per-owner key limit", async () => {
    const create = vi.fn(async () => { throw new Error("should not be called"); });
    await expect(
      createApiKeyForUser(1, "too many", { create, countFor: vi.fn(async () => MAX_API_KEYS_PER_OWNER) })
    ).rejects.toBeInstanceOf(ApiKeyLimitError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("renameApiKeyForUser", () => {
  it("renames an owned key and returns the safe record", async () => {
    const row = {
      id: 3,
      ownerId: 1,
      name: "renamed",
      keyHash: "hash",
      keyPreview: "preview",
      lastUsedAt: null,
      createdAt: new Date("2026-09-27T00:00:00Z"),
      updatedAt: new Date("2026-09-27T00:00:00Z"),
    };
    const rename = vi.fn(async (_ownerId: number, _keyId: number, name: string) => ({ ...row, name }));
    const renamed = await renameApiKeyForUser(1, 3, "  renamed  ", { rename });
    expect(rename).toHaveBeenCalledWith(1, 3, "renamed");
    expect(renamed).toEqual({ id: 3, name: "renamed", keyPreview: "preview", createdAt: row.createdAt, lastUsedAt: null });
    expect(JSON.stringify(renamed)).not.toContain("hash");
  });

  it("returns null when the key does not belong to the owner", async () => {
    const renamed = await renameApiKeyForUser(1, 99, "someone else's", { rename: vi.fn(async () => null) });
    expect(renamed).toBeNull();
  });
});

describe("findOwnerByApiKey", () => {
  it("resolves the owner by hashing the presented key", async () => {
    const lookup = vi.fn(async (keyHash: string) => (keyHash === hashApiKey("nova_sk_known") ? { ownerId: 42 } : null));
    const touch = vi.fn(async () => {});
    expect(await findOwnerByApiKey("nova_sk_known", { lookup, touch })).toBe(42);
    expect(lookup).toHaveBeenCalledWith(hashApiKey("nova_sk_known"));
    expect(touch).toHaveBeenCalledWith(42);
  });

  it("returns null for unknown keys", async () => {
    const result = await findOwnerByApiKey("nova_sk_unknown", { lookup: vi.fn(async () => null), touch: vi.fn(async () => {}) });
    expect(result).toBeNull();
  });
});
