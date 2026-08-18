import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./cookies";

function mockRequest(protocol: string, forwardedProto?: string): Request {
  return {
    protocol,
    headers: forwardedProto ? { "x-forwarded-proto": forwardedProto } : {},
  } as Request;
}

describe("getSessionCookieOptions", () => {
  it("uses SameSite=None only on secure requests", () => {
    expect(getSessionCookieOptions(mockRequest("https"))).toMatchObject({
      sameSite: "none",
      secure: true,
    });
  });

  it("uses a local-development-safe SameSite value on insecure requests", () => {
    expect(getSessionCookieOptions(mockRequest("http"))).toMatchObject({
      sameSite: "lax",
      secure: false,
    });
  });

  it("treats forwarded HTTPS requests as secure", () => {
    expect(getSessionCookieOptions(mockRequest("http", "http, https"))).toMatchObject({
      sameSite: "none",
      secure: true,
    });
  });
});
