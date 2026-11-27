import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { apiKeys, type ApiKey } from "../drizzle/schema";
import { getDb, getOrCreateWorkspace } from "./db";

/** Keys are shown in full exactly once, at creation time. */
export const API_KEY_PREFIX = "nova_sk_";
/**
 * The prefix of a WORKSPACE key - the key type that drives the agent's
 * computer (files, terminal, automations, deployments) instead of calling the
 * model.
 *
 * The prefixes are deliberately different so the two key TYPES can never be
 * confused: a workspace key is rejected by the inference API before it can
 * spend a credit, and an inference key is rejected by the workspace API
 * before it can touch the workspace.
 */
export const WORKSPACE_API_KEY_PREFIX = "nova_wk_";
/**
 * What a key is allowed to do.
 *
 * `inference` calls the OpenAI-compatible model API. `workspace` drives the
 * agent's computer. They are separate key types rather than one key with
 * extra permissions, so a key handed to a third party can be scoped to exactly
 * one job.
 */
export const API_KEY_SCOPES = ["inference", "workspace"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export const DEFAULT_API_KEY_SCOPE: ApiKeyScope = "inference";

/** The prefix that identifies each scope's keys. */
export function apiKeyPrefixForScope(scope: ApiKeyScope): string {
  return scope === "workspace" ? WORKSPACE_API_KEY_PREFIX : API_KEY_PREFIX;
}

/** The scope a key value belongs to, from its prefix alone. */
export function scopeForApiKeyValue(key: string): ApiKeyScope | null {
  if (key.startsWith(WORKSPACE_API_KEY_PREFIX)) return "workspace";
  if (key.startsWith(API_KEY_PREFIX)) return "inference";
  return null;
}

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
export function generateApiKeyRecord(name: string, scope: ApiKeyScope = DEFAULT_API_KEY_SCOPE) {
  const prefix = apiKeyPrefixForScope(scope);
  const key = `${prefix}${randomBytes(24).toString("hex")}`;
  return {
    key,
    keyHash: hashApiKey(key),
    keyPreview: `${prefix}${key.slice(prefix.length, prefix.length + 8)}…`,
    name: name.trim().slice(0, MAX_API_KEY_NAME_LENGTH),
    scope,
  };
}

export type SafeApiKey = Pick<ApiKey, "id" | "name" | "keyPreview" | "scope" | "createdAt" | "lastUsedAt">;

function toSafeApiKey(row: ApiKey): SafeApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPreview: row.keyPreview,
    scope: (row.scope as ApiKeyScope | undefined) ?? DEFAULT_API_KEY_SCOPE,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export type CreateApiKeyDeps = {
  create?: (
    ownerId: number,
    values: { name: string; keyHash: string; keyPreview: string; scope: ApiKeyScope }
  ) => Promise<ApiKey>;
  countFor?: (ownerId: number) => Promise<number>;
};

export type RenameApiKeyDeps = {
  rename?: (ownerId: number, keyId: number, name: string) => Promise<ApiKey | null>;
};

async function defaultCreate(
  ownerId: number,
  values: { name: string; keyHash: string; keyPreview: string; scope: ApiKeyScope }
) {
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
export async function createApiKeyForUser(
  ownerId: number,
  name: string,
  scope: ApiKeyScope = DEFAULT_API_KEY_SCOPE,
  deps: CreateApiKeyDeps = {}
) {
  const create = deps.create ?? defaultCreate;
  const countFor = deps.countFor ?? defaultCountFor;
  if ((await countFor(ownerId)) >= MAX_API_KEYS_PER_OWNER) throw new ApiKeyLimitError();
  const generated = generateApiKeyRecord(name, scope);
  const row = await create(ownerId, {
    name: generated.name,
    keyHash: generated.keyHash,
    keyPreview: generated.keyPreview,
    scope: generated.scope,
  });
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
 * Resolves an incoming bearer key to its owner, enforcing the key's SCOPE.
 *
 * The key itself is never stored, only its SHA-256 hash, so lookups hash the
 * presented value first. The scope check happens BEFORE the lookup is
 * believed: a workspace key presented to the inference API is refused without
 * touching the database at all, and an inference key presented to the
 * workspace API is refused the same way. That separation is the whole point of
 * having two key types.
 *
 * lastUsedAt is updated best-effort so a logging hiccup can never fail a
 * call.
 */
export async function findOwnerByApiKey(
  presentedKey: string,
  options: {
    /** The scope the caller requires. A key of another scope never resolves. */
    scope?: ApiKeyScope;
    lookup?: (keyHash: string) => Promise<{ ownerId: number; scope?: string | null } | null>;
    touch?: (ownerId: number) => Promise<void>;
  } = {}
) {
  const { scope: requiredScope, lookup, touch } = options;
  // A key whose prefix says it is the other type is refused before any
  // database work happens.
  if (requiredScope && scopeForApiKeyValue(presentedKey) !== requiredScope) return null;
  const resolve =
    lookup ??
    (async (keyHash: string) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db
        .select({ ownerId: apiKeys.ownerId, scope: apiKeys.scope })
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1);
      return row ?? null;
    });
  const markUsed =
    touch ??
    (async (ownerId: number) => {
      const db = await getDb();
      if (!db) return;
      await db.update(apiKeys).set({ lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(apiKeys.ownerId, ownerId)).catch(() => undefined);
    });
  const row = await resolve(hashApiKey(presentedKey));
  if (!row) return null;
  // The stored scope is authoritative: a row whose scope does not match the
  // caller's requirement is refused even if its prefix says otherwise.
  const storedScope = (row.scope as ApiKeyScope | null | undefined) ?? DEFAULT_API_KEY_SCOPE;
  if (requiredScope && storedScope !== requiredScope) return null;
  await markUsed(row.ownerId);
  return row.ownerId;
}

/** The workspace an API key's owner controls - used to confirm provisioning. */
export async function getApiKeyWorkspaceId(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  return workspace.id;
}
