import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { SEVEN_DAYS_MS } from "@shared/const";
import {
  LAST_ACTIVE_KEY,
  clearLastActiveTimestamp,
  getLastActiveTimestamp,
  isSessionExpiredDueToInactivity,
  updateLastActiveTimestamp,
} from "./useAuth";

// Create in-memory storage mock for Node environment
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
};

describe("Inactivity & Session Persistence", () => {
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("exports SEVEN_DAYS_MS equal to 7 days in milliseconds", () => {
    expect(SEVEN_DAYS_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(SEVEN_DAYS_MS).toBe(604_800_000);
  });

  it("updates and retrieves the last active timestamp in localStorage", () => {
    const userId = 42;
    const now = 1700000000000;
    vi.setSystemTime(now);

    expect(getLastActiveTimestamp(userId)).toBeNull();

    updateLastActiveTimestamp(userId);

    expect(getLastActiveTimestamp(userId)).toBe(now);
    expect(mockLocalStorage.getItem(`${LAST_ACTIVE_KEY}_user_${userId}`)).toBe(String(now));
  });

  it("clears the last active timestamp from localStorage", () => {
    const userId = 42;
    updateLastActiveTimestamp(userId);
    expect(getLastActiveTimestamp(userId)).not.toBeNull();

    clearLastActiveTimestamp(userId);
    expect(getLastActiveTimestamp(userId)).toBeNull();
  });

  it("correctly evaluates session expiration due to inactivity", () => {
    const now = 1700000000000;

    // Active 1 day ago -> Not expired
    const active1DayAgo = now - 1 * 24 * 60 * 60 * 1000;
    expect(isSessionExpiredDueToInactivity(active1DayAgo, now)).toBe(false);

    // Active 6.9 days ago -> Not expired
    const active6DaysAgo = now - (6.9 * 24 * 60 * 60 * 1000);
    expect(isSessionExpiredDueToInactivity(active6DaysAgo, now)).toBe(false);

    // Active exactly 7 days ago -> Not expired
    const active7DaysAgo = now - SEVEN_DAYS_MS;
    expect(isSessionExpiredDueToInactivity(active7DaysAgo, now)).toBe(false);

    // Active 7 days + 1 second ago -> Expired!
    const active7DaysAnd1SecAgo = now - (SEVEN_DAYS_MS + 1000);
    expect(isSessionExpiredDueToInactivity(active7DaysAnd1SecAgo, now)).toBe(true);

    // Active 10 days ago -> Expired!
    const active10DaysAgo = now - (10 * 24 * 60 * 60 * 1000);
    expect(isSessionExpiredDueToInactivity(active10DaysAgo, now)).toBe(true);
  });

  it("handles null or invalid timestamp gracefully", () => {
    expect(isSessionExpiredDueToInactivity(null)).toBe(false);
    expect(isSessionExpiredDueToInactivity(NaN)).toBe(false);
  });

  it("scopes last-active timestamp to specific user IDs, preventing cross-account leakage", () => {
    const userId1 = 101;
    const userId2 = 202;

    const now = 1700000000000;
    const staleTimestamp = now - (8 * 24 * 60 * 60 * 1000); // 8 days ago (expired)
    const freshTimestamp = now - (1 * 24 * 60 * 60 * 1000); // 1 day ago (fresh)

    vi.setSystemTime(now);

    // User 1 signs in and gets a stale timestamp (simulating old activity)
    vi.setSystemTime(staleTimestamp);
    updateLastActiveTimestamp(userId1);

    // Advance time to now
    vi.setSystemTime(now);

    // Verify User 1's timestamp is stale and would trigger expiration
    const user1Timestamp = getLastActiveTimestamp(userId1);
    expect(user1Timestamp).toBe(staleTimestamp);
    expect(isSessionExpiredDueToInactivity(user1Timestamp, now)).toBe(true);

    // User 2 signs in (different account) - should NOT inherit User 1's timestamp
    const user2Timestamp = getLastActiveTimestamp(userId2);
    expect(user2Timestamp).toBeNull(); // No timestamp yet for User 2

    // User 2 should NOT be expired (null timestamp doesn't cause expiration)
    expect(isSessionExpiredDueToInactivity(user2Timestamp, now)).toBe(false);

    // User 2 records activity now
    updateLastActiveTimestamp(userId2);
    const user2NewTimestamp = getLastActiveTimestamp(userId2);
    expect(user2NewTimestamp).toBe(now);
    expect(isSessionExpiredDueToInactivity(user2NewTimestamp, now)).toBe(false);

    // Verify User 1's stale timestamp is still intact and independent
    expect(getLastActiveTimestamp(userId1)).toBe(staleTimestamp);
    expect(getLastActiveTimestamp(userId2)).toBe(now);

    // Cleanup: clear User 1's timestamp
    clearLastActiveTimestamp(userId1);
    expect(getLastActiveTimestamp(userId1)).toBeNull();
    // User 2's timestamp should remain unaffected
    expect(getLastActiveTimestamp(userId2)).toBe(now);
  });

  it("does not update or retrieve timestamps when userId is undefined", () => {
    const now = 1700000000000;
    vi.setSystemTime(now);

    // Attempt to update without userId - should be no-op
    updateLastActiveTimestamp(undefined);
    expect(mockLocalStorage.getItem(LAST_ACTIVE_KEY)).toBeNull();

    // Attempt to get without userId - should return null
    expect(getLastActiveTimestamp(undefined)).toBeNull();

    // Verify that we can still set a timestamp with a valid userId
    updateLastActiveTimestamp(123);
    expect(getLastActiveTimestamp(123)).toBe(now);

    // But undefined still returns null
    expect(getLastActiveTimestamp(undefined)).toBeNull();
  });
});
