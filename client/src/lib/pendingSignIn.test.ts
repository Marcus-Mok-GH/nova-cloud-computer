import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PendingSignInModule = typeof import("./pendingSignIn");

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  } as Storage;
}

/** Import a fresh module instance, as a page reload would. */
async function loadModule(): Promise<PendingSignInModule> {
  vi.resetModules();
  return import("./pendingSignIn");
}

describe("pending sign-in step", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", createStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the email awaiting a code after a reload", async () => {
    const { rememberPendingSignIn } = await loadModule();
    rememberPendingSignIn("person@example.com");
    const reloaded = await loadModule();
    expect(reloaded.readPendingSignIn()).toBe("person@example.com");
  });

  it("forgets a step whose code has expired", async () => {
    const { PENDING_SIGNIN_TTL_MS, readPendingSignIn, rememberPendingSignIn } = await loadModule();
    rememberPendingSignIn("person@example.com", 1_000);
    expect(readPendingSignIn(1_000 + PENDING_SIGNIN_TTL_MS)).toBe("person@example.com");
    expect(readPendingSignIn(1_000 + PENDING_SIGNIN_TTL_MS + 1)).toBeNull();
    expect(sessionStorage.getItem("nova_pending_signin")).toBeNull();
  });

  it("clears the step on request and ignores unusable stored values", async () => {
    const { clearPendingSignIn, readPendingSignIn, rememberPendingSignIn } = await loadModule();
    rememberPendingSignIn("person@example.com");
    clearPendingSignIn();
    expect(readPendingSignIn()).toBeNull();

    sessionStorage.setItem("nova_pending_signin", "not json");
    expect(readPendingSignIn()).toBeNull();
  });

  it("survives a missing sessionStorage", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    const { clearPendingSignIn, readPendingSignIn, rememberPendingSignIn } = await loadModule();
    expect(() => rememberPendingSignIn("person@example.com")).not.toThrow();
    expect(readPendingSignIn()).toBeNull();
    expect(() => clearPendingSignIn()).not.toThrow();
  });
});
