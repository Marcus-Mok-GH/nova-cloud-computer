import { describe, expect, it } from "vitest";
import { normalizeProxiedSessionCookie } from "./neon-auth";

describe("Neon Auth Vercel proxy cookie handling", () => {
  it("removes an upstream auth-domain attribute so the browser stores the session on Nova’s origin", () => {
    expect(
      normalizeProxiedSessionCookie(
        "__Secure-neonauth.session_token=opaque; Domain=ep-wispy-salad.neonauth.example; Path=/; HttpOnly; Secure; SameSite=None",
      ),
    ).toBe("__Secure-neonauth.session_token=opaque; Path=/; HttpOnly; Secure; SameSite=None");
  });
});
