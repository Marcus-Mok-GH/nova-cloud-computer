import { describe, expect, it, vi } from "vitest";
import {
  NEON_JWT_STORAGE_KEY,
  clearRememberedNeonJwt,
  exchangeNeonVerifierAndGetJwt,
  extractNeonJwt,
  getRememberedNeonJwt,
  getNeonJwtFromTokenEndpoint,
  neonAuthFetchOptions,
  rememberNeonJwt,
  resolveNeonAuthUrl,
} from "./neonAuth";

function createJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("extractNeonJwt", () => {
  it("returns the JWT from Neon Auth's token API response", () => {
    expect(extractNeonJwt({ data: { token: "header.payload.signature" } })).toBe("header.payload.signature");
  });

  it("uses Neon’s signed session header but rejects opaque browser session tokens", () => {
    expect(extractNeonJwt({ data: { session: { token: "header.payload.signature" } } })).toBe(
      "header.payload.signature",
    );
    expect(extractNeonJwt({ data: { session: { token: "opaque-session" } } })).toBeNull();
    expect(extractNeonJwt({})).toBeNull();
  });

  it("exchanges a callback verifier before requesting the signed JWT", async () => {
    const getSession = vi.fn(async () => ({ data: { session: { token: "opaque-session" } } }));
    const token = vi.fn(async () => ({ data: { token: "header.payload.signature" } }));

    await expect(exchangeNeonVerifierAndGetJwt({ getSession, token })).resolves.toBe(
      "header.payload.signature",
    );
    expect(getSession).toHaveBeenCalledOnce();
    expect(token).toHaveBeenCalledOnce();
    expect(getSession.mock.invocationCallOrder[0]).toBeLessThan(token.mock.invocationCallOrder[0]);
  });

  it("uses the verified JWT injected onto the session by Neon’s signed-session response header", async () => {
    const getSession = vi.fn(async () => ({ data: { session: { token: "header.payload.signature" } } }));
    const token = vi.fn(async () => ({ data: { token: "unexpected" } }));

    await expect(exchangeNeonVerifierAndGetJwt({ getSession, token })).resolves.toBe("header.payload.signature");
    expect(token).not.toHaveBeenCalled();
  });

  it("falls back to Neon’s same-origin token endpoint when the session client does not expose its signed header", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: "header.payload.signature" }), { status: 200 }));

    await expect(getNeonJwtFromTokenEndpoint("https://nova.example/api/neon-auth/", fetchImpl)).resolves.toBe(
      "header.payload.signature",
    );
    expect(fetchImpl).toHaveBeenCalledWith("https://nova.example/api/neon-auth/token", { credentials: "include" });
  });

  it("persists a signed JWT in localStorage until its expiration", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    const now = 1_700_000_000_000;
    const token = createJwt({ exp: Math.floor((now + 60_000) / 1000) });

    expect(rememberNeonJwt(token, now)).toBe(token);
    expect(getRememberedNeonJwt(now + 1_000)).toBe(token);

    expect(getRememberedNeonJwt(now + 61_000)).toBeNull();
    expect(storage.has(NEON_JWT_STORAGE_KEY)).toBe(false);

    vi.unstubAllGlobals();
  });

  it("clears the remembered JWT from localStorage", () => {
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem,
    });

    clearRememberedNeonJwt();

    expect(removeItem).toHaveBeenCalledWith(NEON_JWT_STORAGE_KEY);
    vi.unstubAllGlobals();
  });

  it("includes session cookies for the cross-origin Neon Auth client", () => {
    expect(neonAuthFetchOptions.fetchOptions.credentials).toBe("include");
  });

  it("uses Nova’s same-origin dynamic auth base path on Vercel while preserving direct local development access", () => {
    const neonUrl = "https://example.neonauth.example.com/neondb/auth";
    expect(resolveNeonAuthUrl(neonUrl, "https://nova-cloud-computer.vercel.app", "nova-cloud-computer.vercel.app")).toBe(
      "https://nova-cloud-computer.vercel.app/api/neon-auth",
    );
    expect(resolveNeonAuthUrl(neonUrl, "http://localhost:3000", "localhost")).toBe(neonUrl);
  });
});
