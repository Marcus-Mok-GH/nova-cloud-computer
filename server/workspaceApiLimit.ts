import { createHash } from "node:crypto";

/**
 * A per-key request budget for the workspace API.
 *
 * A workspace key drives the agent's computer: it can write to its shell,
 * delete files and take sites offline. A runaway script (or a leaked key)
 * must not be able to hammer it without limit, so every workspace request
 * is counted against its key's budget.
 *
 * Two budgets apply: a short window that stops a runaway loop, and a daily
 * ceiling that stops a slow drip. BOTH are enforced in this process only -
 * serverless deployments run several instances, so this is a best-effort
 * brake against a runaway client, NOT a hard quota. A hard limit would need
 * a database round-trip on every request, and this module holds no secret:
 * a key is identified by its HASH, so the raw key never enters memory.
 */

/** Requests allowed per key in the short window. */
export const WORKSPACE_API_REQUESTS_PER_WINDOW = 300;
/** The short window's length. */
export const WORKSPACE_API_WINDOW_MS = 60_000;
/** Requests allowed per key in a day. */
export const WORKSPACE_API_DAILY_LIMIT = 20_000;
/** A day's length. */
export const WORKSPACE_API_DAY_MS = 24 * 60 * 60_000;

/** The most keys whose budgets are tracked at once. */
const MAX_TRACKED_KEYS = 1_000;

type Bucket = { count: number; resetAt: number };

const windowBuckets = new Map<string, Bucket>();
const dailyBuckets = new Map<string, Bucket>();

/** Clears the in-process limiter. Exported for tests. */
export function resetWorkspaceApiLimits() {
  windowBuckets.clear();
  dailyBuckets.clear();
}

/** Identifies a key without keeping the secret: only its hash is stored. */
export function workspaceApiLimitKey(presentedKey: string): string {
  return createHash("sha256").update(presentedKey).digest("hex");
}

function bump(
  buckets: Map<string, Bucket>,
  key: string,
  limit: number,
  windowMs: number,
  now: number
): { allowed: boolean; retryAfterMs: number } {
  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  // Keep the map bounded: drop the entry that expires first.
  if (buckets.size >= MAX_TRACKED_KEYS) {
    let oldestKey: string | null = null;
    let oldestReset = Number.POSITIVE_INFINITY;
    buckets.forEach((entry, candidate) => {
      if (entry.resetAt < oldestReset) {
        oldestReset = entry.resetAt;
        oldestKey = candidate;
      }
    });
    if (oldestKey) buckets.delete(oldestKey);
  }
  buckets.set(key, bucket);
  if (bucket.count > limit) {
    return { allowed: false, retryAfterMs: Math.max(1, bucket.resetAt - now) };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Counts one workspace request against its key's budgets.
 *
 * Returns whether the request may proceed, and how long the caller should
 * wait when it may not.
 */
export function checkWorkspaceApiRateLimit(
  limitKey: string,
  now = Date.now()
): { allowed: boolean; retryAfterMs: number } {
  const window = bump(
    windowBuckets,
    limitKey,
    WORKSPACE_API_REQUESTS_PER_WINDOW,
    WORKSPACE_API_WINDOW_MS,
    now
  );
  if (!window.allowed) return window;
  return bump(
    dailyBuckets,
    limitKey,
    WORKSPACE_API_DAILY_LIMIT,
    WORKSPACE_API_DAY_MS,
    now
  );
}
