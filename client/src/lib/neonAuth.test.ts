// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
  // The remembered JWT is module-level state shared by every test in this file.
  beforeEach(() => {
    clearRememberedNeonJwt();
  });
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

  it("reads the mapped vanilla adapter's access token off the session, but rejects opaque values", () => {
    expect(extractNeonJwt({ data: { session: { access_token: "header.payload.signature" } } })).toBe(
      "header.payload.signature",
    );
    expect(extractNeonJwt({ data: { session: { access_token: "opaque-session" } } })).toBeNull();
    expect(extractNeonJwt({ data: { session: null } })).toBeNull();
  });

  it("remembers a signed JWT in memory until its expiration, never in localStorage", () => {
    const now = 1_700_000_000_000;
    const token = createJwt({ exp: Math.floor((now + 60_000) / 1000) });

    expect(rememberNeonJwt(token, now)).toBe(token);
    expect(getRememberedNeonJwt(now + 1_000)).toBe(token);

    expect(getRememberedNeonJwt(now + 61_000)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps a JWT with no parseable expiration for a fallback window instead of dropping it", () => {
    const now = 1_700_000_000_000;
    const token = createJwt({ sub: "user-1" });

    expect(rememberNeonJwt(token, now)).toBe(token);
    expect(getRememberedNeonJwt(now + 30 * 60_000)).toBe(token);
    expect(getRememberedNeonJwt(now + 90 * 60_000)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("works even when localStorage is unavailable, so no token can be persisted", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new Error("localStorage must not be read or written"); },
    });
    try {
      const now = 1_700_000_000_000;
      const token = createJwt({ exp: Math.floor((now + 60_000) / 1000) });
      expect(rememberNeonJwt(token, now)).toBe(token);
      expect(getRememberedNeonJwt(now + 1_000)).toBe(token);
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: original });
    }
  });

  it("drops the remembered JWT when cleared", () => {
    rememberNeonJwt(createJwt({ exp: Math.floor((Date.now() + 60_000) / 1000) }));
    clearRememberedNeonJwt();
    expect(getRememberedNeonJwt()).toBeNull();
  });

  it("includes session cookies for the cross-origin Neon Auth client", () => {
    expect(neonAuthFetchOptions.fetchOptions.credentials).toBe("include");
  });

  it("uses Nova’s same-origin auth proxy for every remote deployment while preserving direct local development access", () => {
    const neonUrl = "https://example.neonauth.example.com/neondb/auth";
    expect(resolveNeonAuthUrl(neonUrl, "https://nova-cloud-computer.vercel.app", "nova-cloud-computer.vercel.app")).toBe(
      "https://nova-cloud-computer.vercel.app/api/neon-auth",
    );
    expect(resolveNeonAuthUrl(neonUrl, "https://nova.example.com", "nova.example.com")).toBe(
      "https://nova.example.com/api/neon-auth",
    );
    expect(resolveNeonAuthUrl(neonUrl, "http://localhost:3000", "localhost")).toBe(neonUrl);
  });
});
