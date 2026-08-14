import { describe, expect, it } from "vitest";
import { extractNeonJwt } from "./neonAuth";

describe("extractNeonJwt", () => {
  it("returns the JWT from Neon Auth's token API response", () => {
    expect(extractNeonJwt({ data: { token: "header.payload.signature" } })).toBe("header.payload.signature");
  });

  it("does not substitute an opaque browser session token when no JWT is returned", () => {
    expect(extractNeonJwt({ data: {} })).toBeNull();
    expect(extractNeonJwt({})).toBeNull();
  });
});
