import { describe, expect, it, vi } from "vitest";
import { exchangeNeonVerifierAndGetJwt, extractNeonJwt, neonAuthFetchOptions } from "./neonAuth";

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
    expect(neonAuthFetchOptions).toEqual({ fetchOptions: { credentials: "include" } });
  });
});
