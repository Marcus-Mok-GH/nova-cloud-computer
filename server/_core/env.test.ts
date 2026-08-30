import { afterEach, describe, expect, it } from "vitest";
import { resolveNeonAuthVerificationConfig, resolvePublicBaseUrl } from "./env";

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

describe("resolvePublicBaseUrl", () => {
  const oldBaseUrl = process.env.PUBLIC_BASE_URL;

  afterEach(() => {
    if (oldBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldBaseUrl;
    delete process.env.NOVA_PUBLIC_BASE_URL;
    delete process.env.PUBLIC_APP_URL;
    delete process.env.OAUTH_SERVER_URL;
  });

  it("preserves a configured path prefix while dropping query and hash", () => {
    process.env.PUBLIC_BASE_URL = "https://example.com/nova?utm=1#top";
    expect(resolvePublicBaseUrl()).toBe("https://example.com/nova");
  });

  it("strips trailing slashes without changing the origin", () => {
    process.env.PUBLIC_BASE_URL = "https://example.com/";
    expect(resolvePublicBaseUrl()).toBe("https://example.com");
  });

  it("falls back to the OAUTH_SERVER_URL origin when no public base URL is set", () => {
    process.env.OAUTH_SERVER_URL = "https://example.com/api/oauth";
    expect(resolvePublicBaseUrl()).toBe("https://example.com");
  });
});
