import { describe, expect, it } from "vitest";
import { getNeonAuthProxyBody, getNeonAuthProxyHeaders, getNeonAuthProxyUrl } from "./neonAuthProxy";

describe("Neon Auth proxy helpers", () => {
  it("preserves path and query while targeting the configured Neon Auth origin", () => {
    expect(
      getNeonAuthProxyUrl(
        "https://auth.example/neondb/auth/",
        ["sign-in", "magic-link"],
        "?callbackURL=https%3A%2F%2Fnova.example%2Fapp",
      ),
    ).toBe("https://auth.example/neondb/auth/sign-in/magic-link?callbackURL=https%3A%2F%2Fnova.example%2Fapp");
  });

  it("forwards session-safe headers without forwarding the browser host header", () => {
    const headers = getNeonAuthProxyHeaders({
      accept: "application/json",
      cookie: "session=opaque",
      host: "nova-cloud-computer.vercel.app",
      "x-forwarded-host": "nova-cloud-computer.vercel.app",
    });
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("cookie")).toBe("session=opaque");
    expect(headers.has("host")).toBe(false);
    expect(headers.has("x-forwarded-host")).toBe(false);
  });

  it("serializes JSON request bodies while leaving read requests bodyless", () => {
    expect(getNeonAuthProxyBody("POST", { email: "member@example.com" })).toBe('{"email":"member@example.com"}');
    expect(getNeonAuthProxyBody("GET", { ignored: true })).toBeUndefined();
  });
});
