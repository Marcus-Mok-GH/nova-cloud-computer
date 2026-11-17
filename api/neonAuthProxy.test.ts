import { afterEach, describe, expect, it } from "vitest";
import { getNeonAuthBaseUrls, getProxiedRequestOrigin, isNeonAuthFailoverResponse, isSameOriginProxiedRequest } from "./[...path]";

const VARS = [
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_BACKUP_BASE_URL",
  "NEON_AUTH_BACKUP2_BASE_URL",
];

describe("getNeonAuthBaseUrls", () => {
  afterEach(() => {
    for (const name of VARS) delete process.env[name];
  });

  it("walks primary -> backup -> second backup", () => {
    process.env.NEON_AUTH_BASE_URL = "https://p.example";
    process.env.NEON_AUTH_BACKUP_BASE_URL = "https://b.example";
    process.env.NEON_AUTH_BACKUP2_BASE_URL = "https://b2.example";
    expect(getNeonAuthBaseUrls()).toEqual([
      "https://p.example",
      "https://b.example",
      "https://b2.example",
    ]);
  });

  it("ignores empty or duplicate entries", () => {
    process.env.NEON_AUTH_BASE_URL = "https://p.example";
    process.env.NEON_AUTH_BACKUP_BASE_URL = "https://p.example";
    process.env.NEON_AUTH_BACKUP2_BASE_URL = "https://b2.example/";
    expect(getNeonAuthBaseUrls()).toEqual(["https://p.example", "https://b2.example"]);
  });

  it("returns nothing without a primary", () => {
    process.env.NEON_AUTH_BACKUP2_BASE_URL = "https://b2.example";
    expect(getNeonAuthBaseUrls()).toEqual([]);
  });
});

describe("isNeonAuthFailoverResponse", () => {
  it("treats quota-shaped refusals as failover-worthy", () => {
    const quotaBody =
      '{"message":"Your account or project has exceeded the quota. Upgrade your plan to increase limits.","code":"GENERIC_QUOTA_EXCEEDED"}';
    expect(isNeonAuthFailoverResponse(402, quotaBody)).toBe(true);
    expect(isNeonAuthFailoverResponse(503, "{}")).toBe(false);
    expect(isNeonAuthFailoverResponse(401, quotaBody)).toBe(false);
    expect(isNeonAuthFailoverResponse(404, "not found")).toBe(false);
  });
});

describe("getProxiedRequestOrigin", () => {
  it("reconstructs the browser-facing origin from Vercel's forwarded headers", () => {
    expect(
      getProxiedRequestOrigin({
        headers: { host: "nova-cloud-computer.vercel.app", "x-forwarded-proto": "https" },
      } as any),
    ).toBe("https://nova-cloud-computer.vercel.app");
  });

  it("defaults to https when the platform omits the protocol", () => {
    expect(getProxiedRequestOrigin({ headers: { host: "nova.example" } } as any)).toBe("https://nova.example");
  });

  it("returns null without a host header", () => {
    expect(getProxiedRequestOrigin({ headers: {} } as any)).toBeNull();
  });
});

describe("isSameOriginProxiedRequest", () => {
  const req = (headers: Record<string, string>) => ({ headers } as any);

  it("accepts the deployment's own Origin", () => {
    expect(
      isSameOriginProxiedRequest(
        req({ host: "nova.example", "x-forwarded-proto": "https", origin: "https://nova.example" }),
      ),
    ).toBe(true);
  });

  it("accepts a same-origin Referer when the browser omits Origin", () => {
    expect(
      isSameOriginProxiedRequest(
        req({ host: "nova.example", "x-forwarded-proto": "https", referer: "https://nova.example/sign-in" }),
      ),
    ).toBe(true);
  });

  it("refuses a cross-site Origin", () => {
    expect(
      isSameOriginProxiedRequest(
        req({ host: "nova.example", "x-forwarded-proto": "https", origin: "https://evil.example" }),
      ),
    ).toBe(false);
  });

  it("refuses scheme downgrades even on the same host", () => {
    expect(
      isSameOriginProxiedRequest(req({ host: "nova.example", "x-forwarded-proto": "https", origin: "http://nova.example" })),
    ).toBe(false);
  });

  it("refuses the literal null Origin and requests with no claim at all", () => {
    expect(isSameOriginProxiedRequest(req({ host: "nova.example", origin: "null" }))).toBe(false);
    expect(isSameOriginProxiedRequest(req({ host: "nova.example" }))).toBe(false);
  });
});
