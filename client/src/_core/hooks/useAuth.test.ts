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
    const now = 1700000000000;
    vi.setSystemTime(now);

    expect(getLastActiveTimestamp()).toBeNull();

    updateLastActiveTimestamp();

    expect(getLastActiveTimestamp()).toBe(now);
    expect(mockLocalStorage.getItem(LAST_ACTIVE_KEY)).toBe(String(now));
  });

  it("clears the last active timestamp from localStorage", () => {
    updateLastActiveTimestamp();
    expect(getLastActiveTimestamp()).not.toBeNull();

    clearLastActiveTimestamp();
    expect(getLastActiveTimestamp()).toBeNull();
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
});
