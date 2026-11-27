import { beforeEach, describe, expect, it } from "vitest";
import {
  checkWorkspaceApiRateLimit,
  resetWorkspaceApiLimits,
  WORKSPACE_API_DAILY_LIMIT,
  WORKSPACE_API_REQUESTS_PER_WINDOW,
  WORKSPACE_API_WINDOW_MS,
  workspaceApiLimitKey,
} from "./workspaceApiLimit";

/**
 * The workspace API's per-key request budget.
 *
 * A workspace key can write to the agent's shell, so a runaway script must
 * not be able to hammer it. The budget is per KEY (two keys are two
 * credentials, each with its own allowance) and the raw key is never stored -
 * only its hash.
 */
describe("the workspace API request budget", () => {
  beforeEach(() => {
    resetWorkspaceApiLimits();
  });

  it("identifies a key by its hash, never by the secret", () => {
    const hash = workspaceApiLimitKey("nova_wk_secret");
    expect(hash).not.toContain("nova_wk_secret");
    expect(hash).toHaveLength(64);
    // The same key always maps to the same budget.
    expect(workspaceApiLimitKey("nova_wk_secret")).toBe(hash);
  });

  it("allows requests up to the window limit", () => {
    const key = workspaceApiLimitKey("nova_wk_a");
    for (let i = 0; i < WORKSPACE_API_REQUESTS_PER_WINDOW; i++) {
      expect(checkWorkspaceApiRateLimit(key).allowed).toBe(true);
    }
  });

  it("refuses the request after the window limit", () => {
    const key = workspaceApiLimitKey("nova_wk_a");
    for (let i = 0; i < WORKSPACE_API_REQUESTS_PER_WINDOW; i++) {
      checkWorkspaceApiRateLimit(key);
    }
    const refused = checkWorkspaceApiRateLimit(key);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
  });

  it("gives each key its own budget", () => {
    const first = workspaceApiLimitKey("nova_wk_a");
    const second = workspaceApiLimitKey("nova_wk_b");
    for (let i = 0; i < WORKSPACE_API_REQUESTS_PER_WINDOW; i++) {
      checkWorkspaceApiRateLimit(first);
    }
    // One key's runaway must not lock out a different key.
    expect(checkWorkspaceApiRateLimit(second).allowed).toBe(true);
    expect(checkWorkspaceApiRateLimit(first).allowed).toBe(false);
  });

  it("starts a fresh window when the old one expires", () => {
    const key = workspaceApiLimitKey("nova_wk_a");
    const now = 1_000_000;
    for (let i = 0; i < WORKSPACE_API_REQUESTS_PER_WINDOW; i++) {
      checkWorkspaceApiRateLimit(key, now);
    }
    expect(checkWorkspaceApiRateLimit(key, now).allowed).toBe(false);
    // Once the window has rolled over, the key works again.
    expect(checkWorkspaceApiRateLimit(key, now + WORKSPACE_API_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("counts the daily ceiling as well", () => {
    const key = workspaceApiLimitKey("nova_wk_a");
    const now = 1_000_000;
    // Walk past the daily ceiling one window at a time.
    let elapsed = 0;
    for (let window = 0; window * WORKSPACE_API_REQUESTS_PER_WINDOW <= WORKSPACE_API_DAILY_LIMIT; window++) {
      for (let i = 0; i < WORKSPACE_API_REQUESTS_PER_WINDOW; i++) {
        checkWorkspaceApiRateLimit(key, now + elapsed);
      }
      elapsed += WORKSPACE_API_WINDOW_MS + 1;
    }
    // The next request is over the daily ceiling, even though the short
    // window has rolled over.
    expect(checkWorkspaceApiRateLimit(key, now + elapsed).allowed).toBe(false);
  });
});
