import { describe, expect, it } from "vitest";
import {
  getNeonAuthPathFromCatchall,
  getNeonAuthPathFromRequestUrl,
  normalizeProxiedSessionCookie,
} from "./[...path]";

describe("Neon Auth catch-all dispatch", () => {
  it("reserves only the Neon Auth namespace while retaining its endpoint path", () => {
    expect(getNeonAuthPathFromCatchall(["neon-auth", "get-session"])).toBe("get-session");
    expect(getNeonAuthPathFromCatchall("neon-auth/magic-link/verify")).toBe("magic-link/verify");
    expect(getNeonAuthPathFromCatchall(["trpc", "auth.me"])).toBeNull();
  });

  it("falls back to the original URL when Vercel omits the catch-all query parameter", () => {
    expect(getNeonAuthPathFromRequestUrl("/api/neon-auth/get-session?neon_auth_session_verifier=one-time")).toBe(
      "get-session",
    );
    expect(getNeonAuthPathFromRequestUrl("/api/trpc/auth.me")).toBeNull();
  });

  it("removes an upstream cookie domain before returning the first-party session cookie", () => {
    expect(normalizeProxiedSessionCookie("session=value; Domain=neon.example; Path=/; Secure")).toBe(
      "session=value; Path=/; Secure",
    );
  });
});
