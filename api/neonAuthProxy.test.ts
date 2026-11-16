import { afterEach, describe, expect, it } from "vitest";
import { getNeonAuthBaseUrls, isNeonAuthFailoverResponse } from "./[...path]";

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
