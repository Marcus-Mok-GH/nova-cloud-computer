import { describe, expect, it } from "vitest";
import { getNeonAuthPathFromCatchall, normalizeProxiedSessionCookie } from "./[...path]";

describe("Neon Auth catch-all dispatch", () => {
  it("reserves only the Neon Auth namespace while retaining its endpoint path", () => {
    expect(getNeonAuthPathFromCatchall(["neon-auth", "get-session"])).toBe("get-session");
    expect(getNeonAuthPathFromCatchall("neon-auth/magic-link/verify")).toBe("magic-link/verify");
    expect(getNeonAuthPathFromCatchall(["trpc", "auth.me"])).toBeNull();
  });

  it("removes an upstream cookie domain before returning the first-party session cookie", () => {
    expect(normalizeProxiedSessionCookie("session=value; Domain=neon.example; Path=/; Secure")).toBe(
      "session=value; Path=/; Secure",
    );
  });
});
