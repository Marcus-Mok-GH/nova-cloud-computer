import { describe, expect, it } from "vitest";
import { getDynamicProxyPath, normalizeProxiedSessionCookie } from "./[...path]";

describe("dynamic Neon Auth Vercel proxy", () => {
  it("preserves a dynamic endpoint path without mixing it into callback query parameters", () => {
    expect(getDynamicProxyPath(["get-session"])).toBe("get-session");
    expect(getDynamicProxyPath("magic-link/verify")).toBe("magic-link/verify");
  });

  it("removes upstream cookie domains before returning a first-party session", () => {
    expect(normalizeProxiedSessionCookie("session=value; Domain=neon.example; Path=/; Secure")).toBe(
      "session=value; Path=/; Secure",
    );
  });
});
