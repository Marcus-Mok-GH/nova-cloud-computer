import { afterEach, describe, expect, it } from "vitest";
import { resolveNeonAuthVerificationConfig, resolvePublicBaseUrl, resolveTranscriptionConfig } from "./env";

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
describe("resolveTranscriptionConfig", () => {
  const names = ["TRANSCRIPTION_API_KEY", "TRANSCRIPTION_API_BASE_URL", "TRANSCRIPTION_MODEL", "POLLINATIONS_API_KEY"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]])) as Record<string, string | undefined>;

  afterEach(() => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it("opts into the Pollinations unified API when only POLLINATIONS_API_KEY is set", () => {
    delete process.env.TRANSCRIPTION_API_KEY;
    delete process.env.TRANSCRIPTION_API_BASE_URL;
    delete process.env.TRANSCRIPTION_MODEL;
    process.env.POLLINATIONS_API_KEY = "sk-poll";
    expect(resolveTranscriptionConfig()).toEqual({
      transcriptionApiBaseUrl: "https://gen.pollinations.ai/v1",
      transcriptionApiKey: "sk-poll",
      transcriptionModel: "openai/whisper-large-v3",
    });
  });

  it("keeps legacy OpenAI defaults for a bare TRANSCRIPTION_API_KEY so it is never sent to Pollinations", () => {
    delete process.env.POLLINATIONS_API_KEY;
    delete process.env.TRANSCRIPTION_API_BASE_URL;
    delete process.env.TRANSCRIPTION_MODEL;
    process.env.TRANSCRIPTION_API_KEY = "sk-openai-legacy";
    expect(resolveTranscriptionConfig()).toEqual({
      transcriptionApiBaseUrl: "https://api.openai.com/v1",
      transcriptionApiKey: "sk-openai-legacy",
      transcriptionModel: "whisper-1",
    });
  });

  it("prefers the legacy key when both keys are set without an explicit base URL", () => {
    process.env.POLLINATIONS_API_KEY = "sk-poll";
    process.env.TRANSCRIPTION_API_KEY = "sk-openai-legacy";
    delete process.env.TRANSCRIPTION_API_BASE_URL;
    expect(resolveTranscriptionConfig().transcriptionApiKey).toBe("sk-openai-legacy");
    expect(resolveTranscriptionConfig().transcriptionApiBaseUrl).toBe("https://api.openai.com/v1");
  });

  it("honors an explicit OpenAI-compatible base URL over the Pollinations default, with POLLINATIONS_API_KEY as key fallback", () => {
    delete process.env.TRANSCRIPTION_API_KEY;
    process.env.POLLINATIONS_API_KEY = "sk-poll";
    process.env.TRANSCRIPTION_API_BASE_URL = "https://api.groq.com/openai/v1/";
    delete process.env.TRANSCRIPTION_MODEL;
    expect(resolveTranscriptionConfig()).toEqual({
      transcriptionApiBaseUrl: "https://api.groq.com/openai/v1",
      transcriptionApiKey: "sk-poll",
      transcriptionModel: "whisper-1",
    });
  });

  it("lets TRANSCRIPTION_MODEL and TRANSCRIPTION_API_KEY override everything", () => {
    process.env.POLLINATIONS_API_KEY = "sk-poll";
    process.env.TRANSCRIPTION_API_KEY = "sk-explicit";
    delete process.env.TRANSCRIPTION_API_BASE_URL;
    process.env.TRANSCRIPTION_MODEL = "custom-model";
    expect(resolveTranscriptionConfig().transcriptionApiKey).toBe("sk-explicit");
    expect(resolveTranscriptionConfig().transcriptionModel).toBe("custom-model");
  });
});
