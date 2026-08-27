import { describe, expect, it } from "vitest";
import { resolveNeonAuthVerificationConfig } from "./env";

describe("resolveNeonAuthVerificationConfig", () => {
  const baseUrl = "https://ep-wispy-salad-au8m5tie.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth";

  it("derives Neon JWT verification values from the configured API base URL", () => {
    expect(resolveNeonAuthVerificationConfig(baseUrl)).toEqual({
      baseUrl,
      issuer: "https://ep-wispy-salad-au8m5tie.neonauth.c-10.us-east-1.aws.neon.tech",
      audience: "https://ep-wispy-salad-au8m5tie.neonauth.c-10.us-east-1.aws.neon.tech",
      jwksUrl: `${baseUrl}/.well-known/jwks.json`,
    });
  });

  it("uses the API base URL instead of stale issuer, audience, or JWKS overrides", () => {
    expect(resolveNeonAuthVerificationConfig(`${baseUrl}/`, {
      issuer: `${baseUrl}/incorrect-issuer`,
      audience: "https://stale.example",
      jwksUrl: "https://stale.example/.well-known/jwks.json",
    })).toEqual({
      baseUrl,
      issuer: "https://ep-wispy-salad-au8m5tie.neonauth.c-10.us-east-1.aws.neon.tech",
      audience: "https://ep-wispy-salad-au8m5tie.neonauth.c-10.us-east-1.aws.neon.tech",
      jwksUrl: `${baseUrl}/.well-known/jwks.json`,
    });
  });

  it("retains explicit values only when no proxy base URL is configured", () => {
    expect(resolveNeonAuthVerificationConfig(undefined, {
      issuer: "https://issuer.example",
      audience: "https://audience.example",
      jwksUrl: "https://issuer.example/.well-known/jwks.json",
    })).toEqual({
      baseUrl: "",
      issuer: "https://issuer.example",
      audience: "https://audience.example",
      jwksUrl: "https://issuer.example/.well-known/jwks.json",
    });
  });
});
