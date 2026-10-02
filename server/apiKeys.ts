import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { apiKeys, type ApiKey } from "../drizzle/schema";
import { getDb, getOrCreateWorkspace } from "./db";

/** Keys are shown in full exactly once, at creation time. */
export const API_KEY_PREFIX = "nova_sk_";
/** How many keys one account can hold at once. */
export const MAX_API_KEYS_PER_OWNER = 5;
/** Upper bound for the human-readable name stored with a key. */
export const MAX_API_KEY_NAME_LENGTH = 120;

export class ApiKeyLimitError extends Error {
  constructor() {
    super(`You can keep up to ${MAX_API_KEYS_PER_OWNER} API keys at once. Revoke one before creating another.`);
    this.name = "ApiKeyLimitError";
  }
}

export class ApiKeyStorageError extends Error {
  constructor() {
    super("Nova could not save the API key. Please try again.");
    this.name = "ApiKeyStorageError";
  }
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generates a fresh API key value plus the fields Nova persists for it. */
export function generateApiKeyRecord(name: string) {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  return {
    key,
    keyHash: hashApiKey(key),
    keyPreview: `${API_KEY_PREFIX}${key.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8)}…`,
    name: name.trim().slice(0, MAX_API_KEY_NAME_LENGTH),
  };
}

export type SafeApiKey = Pick<ApiKey, "id" | "name" | "keyPreview" | "createdAt" | "lastUsedAt">;

function toSafeApiKey(row: ApiKey): SafeApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPreview: row.keyPreview,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export type CreateApiKeyDeps = {
  create?: (ownerId: number, values: { name: string; keyHash: string; keyPreview: string }) => Promise<ApiKey>;
  countFor?: (ownerId: number) => Promise<number>;
};

export type RenameApiKeyDeps = {
  rename?: (ownerId: number, keyId: number, name: string) => Promise<ApiKey | null>;
};

async function defaultCreate(ownerId: number, values: { name: string; keyHash: string; keyPreview: string }) {
  const db = await getDb();
  if (!db) throw new ApiKeyStorageError();
  const [row] = await db.insert(apiKeys).values({ ownerId, ...values }).returning();
  if (!row) throw new ApiKeyStorageError();
  return row;
}

async function defaultCountFor(ownerId: number) {
  const db = await getDb();
  if (!db) return MAX_API_KEYS_PER_OWNER;
  return db.$count(apiKeys, eq(apiKeys.ownerId, ownerId));
}

/** Creates a new key and returns the full value exactly once. */
export async function createApiKeyForUser(ownerId: number, name: string, deps: CreateApiKeyDeps = {}) {
  const create = deps.create ?? defaultCreate;
  const countFor = deps.countFor ?? defaultCountFor;
  if ((await countFor(ownerId)) >= MAX_API_KEYS_PER_OWNER) throw new ApiKeyLimitError();
  const generated = generateApiKeyRecord(name);
  const row = await create(ownerId, { name: generated.name, keyHash: generated.keyHash, keyPreview: generated.keyPreview });
  return { key: generated.key, apiKey: toSafeApiKey(row) };
}

export async function listApiKeysForUser(ownerId: number) {
  const db = await getDb();
  if (!db) throw new ApiKeyStorageError();
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.ownerId, ownerId)).orderBy(desc(apiKeys.createdAt));
  return rows.map(toSafeApiKey);
}

async function defaultRename(ownerId: number, keyId: number, name: string): Promise<ApiKey | null> {
  const db = await getDb();
  if (!db) throw new ApiKeyStorageError();
  const [row] = await db.update(apiKeys).set({ name, updatedAt: new Date() }).where(and(eq(apiKeys.id, keyId), eq(apiKeys.ownerId, ownerId))).returning();
  return row ?? null;
}

/** Renames one of the caller's own keys. Returns null when the id does not belong to them. */
export async function renameApiKeyForUser(ownerId: number, keyId: number, name: string, deps: RenameApiKeyDeps = {}) {
  const rename = deps.rename ?? defaultRename;
  const trimmed = name.trim().slice(0, MAX_API_KEY_NAME_LENGTH);
  const row = await rename(ownerId, keyId, trimmed);
  return row ? toSafeApiKey(row) : null;
}

/** Deletes one of the caller's own keys. Returns false when the id does not belong to them. */
export async function revokeApiKeyForUser(ownerId: number, keyId: number) {
  const db = await getDb();
  if (!db) throw new ApiKeyStorageError();
  const deleted = await db.delete(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.ownerId, ownerId))).returning({ id: apiKeys.id });
  return deleted.length > 0;
}

/**
 * Resolves an incoming bearer key to its owner. The key itself is never
 * stored, only its SHA-256 hash, so lookups hash the presented value first.
 * lastUsedAt is updated best-effort so a logging hiccup can never fail an
 * inference call.
 */
export async function findOwnerByApiKey(presentedKey: string, deps: { lookup?: (keyHash: string) => Promise<{ ownerId: number } | null>; touch?: (ownerId: number) => Promise<void> } = {}) {
  const lookup =
    deps.lookup ??
    (async (keyHash: string) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db.select({ ownerId: apiKeys.ownerId }).from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
      return row ?? null;
    });
  const touch =
    deps.touch ??
    (async (ownerId: number) => {
      const db = await getDb();
      if (!db) return;
      await db.update(apiKeys).set({ lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(apiKeys.ownerId, ownerId)).catch(() => undefined);
    });
  const row = await lookup(hashApiKey(presentedKey));
  if (!row) return null;
  await touch(row.ownerId);
  return row.ownerId;
}

/** The workspace an API key's owner controls - used to confirm provisioning. */
export async function getApiKeyWorkspaceId(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  return workspace.id;
}
