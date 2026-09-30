import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNeonAuthVerificationConfig, resolveNimApiKey, resolvePublicBaseUrl, resolveTranscriptionConfig } from "./env";

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

describe("resolveNimApiKey", () => {
  it("prefers the dedicated NVIDIA_NIM_API_KEY name", () => {
    expect(
      resolveNimApiKey({
        NVIDIA_NIM_API_KEY: "nim-key",
        NVIDIA_NIM_GATEWAY_TOKEN: "nim-gateway-token",
        NVIDIA_API_KEY: "legacy-key",
        NOVA_NVIDIA_GATEWAY_TOKEN: "token",
      } as NodeJS.ProcessEnv)
    ).toBe("nim-key");
  });

  it("falls back to NVIDIA_NIM_GATEWAY_TOKEN and legacy gateway key names on the same NIM endpoint", () => {
    expect(resolveNimApiKey({ NVIDIA_NIM_GATEWAY_TOKEN: "nim-gateway-token" } as NodeJS.ProcessEnv)).toBe("nim-gateway-token");
    expect(resolveNimApiKey({ NVIDIA_API_KEY: "legacy-key" } as NodeJS.ProcessEnv)).toBe("legacy-key");
    expect(resolveNimApiKey({ NOVA_NVIDIA_GATEWAY_TOKEN: "gateway-token" } as NodeJS.ProcessEnv)).toBe("gateway-token");
  });

  it("skips empty or whitespace-only values to find the first valid credential", () => {
    expect(
      resolveNimApiKey({
        NVIDIA_NIM_API_KEY: "  ",
        NVIDIA_NIM_GATEWAY_TOKEN: "valid-gateway-token",
      } as NodeJS.ProcessEnv)
    ).toBe("valid-gateway-token");
  });

  it("resolves to an empty string when no key is configured", () => {
    expect(resolveNimApiKey({} as NodeJS.ProcessEnv)).toBe("");
  });

  it("prefers the NIM gateway token over both legacy credentials", () => {
    expect(resolveNimApiKey({
      NVIDIA_NIM_GATEWAY_TOKEN: "nim-gateway-token",
      NVIDIA_API_KEY: "legacy-key",
      NOVA_NVIDIA_GATEWAY_TOKEN: "legacy-gateway-token",
    })).toBe("nim-gateway-token");
  });

  it("prefers the legacy API key over the legacy gateway token", () => {
    expect(resolveNimApiKey({
      NVIDIA_API_KEY: "legacy-key",
      NOVA_NVIDIA_GATEWAY_TOKEN: "legacy-gateway-token",
    })).toBe("legacy-key");
  });

  describe.each([
    { label: "empty", blank: "" },
    { label: "spaces", blank: "   " },
    { label: "tabs and line endings", blank: "\t\r\n" },
    { label: "non-breaking spaces", blank: "\u00a0" },
  ])("with $label credentials", ({ blank }) => {
    it("skips a blank primary key for the NIM gateway token", () => {
      expect(resolveNimApiKey({
        NVIDIA_NIM_API_KEY: blank,
        NVIDIA_NIM_GATEWAY_TOKEN: "nim-gateway-token",
        NVIDIA_API_KEY: "legacy-key",
        NOVA_NVIDIA_GATEWAY_TOKEN: "legacy-gateway-token",
      })).toBe("nim-gateway-token");
    });

    it("skips blank dedicated credentials for the legacy API key", () => {
      expect(resolveNimApiKey({
        NVIDIA_NIM_API_KEY: blank,
        NVIDIA_NIM_GATEWAY_TOKEN: blank,
        NVIDIA_API_KEY: "legacy-key",
        NOVA_NVIDIA_GATEWAY_TOKEN: "legacy-gateway-token",
      })).toBe("legacy-key");
    });

    it("uses the legacy gateway token when all earlier credentials are blank", () => {
      expect(resolveNimApiKey({
        NVIDIA_NIM_API_KEY: blank,
        NVIDIA_NIM_GATEWAY_TOKEN: blank,
        NVIDIA_API_KEY: blank,
        NOVA_NVIDIA_GATEWAY_TOKEN: "legacy-gateway-token",
      })).toBe("legacy-gateway-token");
    });

    it("returns an empty string when every credential is blank", () => {
      expect(resolveNimApiKey({
        NVIDIA_NIM_API_KEY: blank,
        NVIDIA_NIM_GATEWAY_TOKEN: blank,
        NVIDIA_API_KEY: blank,
        NOVA_NVIDIA_GATEWAY_TOKEN: blank,
      })).toBe("");
    });
  });

  it.each([
    "NVIDIA_NIM_API_KEY",
    "NVIDIA_NIM_GATEWAY_TOKEN",
    "NVIDIA_API_KEY",
    "NOVA_NVIDIA_GATEWAY_TOKEN",
  ])("trims surrounding whitespace from %s", name => {
    expect(resolveNimApiKey({
      [name]: " \t\u00a0nvapi-Test_+/=.token\r\n ",
    })).toBe("nvapi-Test_+/=.token");
  });

  it("retains primary-key precedence when the primary key needs trimming", () => {
    expect(resolveNimApiKey({
      NVIDIA_NIM_API_KEY: " \tnim-key\r\n",
      NVIDIA_NIM_GATEWAY_TOKEN: "nim-gateway-token",
      NVIDIA_API_KEY: "legacy-key",
      NOVA_NVIDIA_GATEWAY_TOKEN: "legacy-gateway-token",
    })).toBe("nim-key");
  });

  it("skips a mixture of unset, empty, and whitespace-only credentials", () => {
    expect(resolveNimApiKey({
      NVIDIA_NIM_API_KEY: undefined,
      NVIDIA_NIM_GATEWAY_TOKEN: "",
      NVIDIA_API_KEY: "\t ",
      NOVA_NVIDIA_GATEWAY_TOKEN: " \nlegacy-gateway-token\t",
    })).toBe("legacy-gateway-token");
  });

  describe("process environment", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("resolves the gateway token from process.env when no source is passed", () => {
      vi.stubEnv("NVIDIA_NIM_API_KEY", " \t");
      vi.stubEnv("NVIDIA_NIM_GATEWAY_TOKEN", " \nnim-gateway-token\r\n");
      vi.stubEnv("NVIDIA_API_KEY", "legacy-key");
      vi.stubEnv("NOVA_NVIDIA_GATEWAY_TOKEN", "legacy-gateway-token");

      expect(resolveNimApiKey()).toBe("nim-gateway-token");
    });

    it("uses only an explicit source even when process.env has valid credentials", () => {
      vi.stubEnv("NVIDIA_NIM_API_KEY", "environment-nim-key");
      vi.stubEnv("NVIDIA_NIM_GATEWAY_TOKEN", "environment-gateway-token");
      vi.stubEnv("NVIDIA_API_KEY", "environment-legacy-key");
      vi.stubEnv("NOVA_NVIDIA_GATEWAY_TOKEN", "environment-legacy-gateway-token");

      expect(resolveNimApiKey({})).toBe("");
      expect(resolveNimApiKey({
        NOVA_NVIDIA_GATEWAY_TOKEN: "explicit-gateway-token",
      })).toBe("explicit-gateway-token");
    });
  });
});
