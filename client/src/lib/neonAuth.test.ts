import { describe, expect, it, vi } from "vitest";
import {
  exchangeNeonVerifierAndGetJwt,
  extractNeonJwt,
  getNeonAuthProxyRequestUrl,
  neonAuthFetchOptions,
} from "./neonAuth";

describe("extractNeonJwt", () => {
  it("returns the JWT from Neon Auth's token API response", () => {
    expect(extractNeonJwt({ data: { token: "header.payload.signature" } })).toBe("header.payload.signature");
  });

  it("does not substitute an opaque browser session token when no JWT is returned", () => {
    expect(extractNeonJwt({ data: {} })).toBeNull();
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

  it("includes session cookies for the cross-origin Neon Auth client", () => {
    expect(neonAuthFetchOptions.fetchOptions.credentials).toBe("include");
    expect(neonAuthFetchOptions.fetchOptions.customFetchImpl).toEqual(expect.any(Function));
  });

  it("routes Vercel Neon SDK calls through Nova’s static proxy without dropping callback queries", () => {
    const neonUrl = "https://example.neonauth.example.com/neondb/auth";
    expect(
      getNeonAuthProxyRequestUrl(
        `${neonUrl}/get-session?neon_auth_session_verifier=verifier-123`,
        neonUrl,
        "https://nova-cloud-computer.vercel.app",
        "nova-cloud-computer.vercel.app",
      ),
    ).toBe(
      "https://nova-cloud-computer.vercel.app/api/neon-auth?proxyPath=get-session&neon_auth_session_verifier=verifier-123",
    );
    expect(getNeonAuthProxyRequestUrl(`${neonUrl}/get-session`, neonUrl, "http://localhost:3000", "localhost")).toBe(
      `${neonUrl}/get-session`,
    );
  });
});
