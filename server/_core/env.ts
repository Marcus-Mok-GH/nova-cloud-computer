type NeonAuthVerificationOverrides = {
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
};

/**
 * Neon Auth exposes its API below `/neondb/auth`, but signs access tokens with
 * the endpoint origin as both issuer and audience. Deriving all verification
 * values from the proxy base URL keeps the server and browser on one source of
 * truth and prevents stale optional overrides from invalidating valid tokens.
 */
export function resolveNeonAuthVerificationConfig(
  baseUrl: string | undefined,
  overrides: NeonAuthVerificationOverrides = {},
) {
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/$/, "") ?? "";
  if (!normalizedBaseUrl) {
    return {
      baseUrl: "",
      issuer: overrides.issuer?.trim() ?? "",
      audience: overrides.audience?.trim() ?? "",
      jwksUrl: overrides.jwksUrl?.trim() ?? "",
    };
  }

  const origin = new URL(normalizedBaseUrl).origin;
  return {
    baseUrl: normalizedBaseUrl,
    issuer: origin,
    audience: origin,
    jwksUrl: `${normalizedBaseUrl}/.well-known/jwks.json`,
  };
}

const neonAuthVerification = resolveNeonAuthVerificationConfig(process.env.NEON_AUTH_BASE_URL, {
  issuer: process.env.NEON_AUTH_ISSUER,
  audience: process.env.NEON_AUTH_AUDIENCE,
  jwksUrl: process.env.NEON_AUTH_JWKS_URL,
});

export function resolvePublicBaseUrl() {
  const candidate = (process.env.NOVA_PUBLIC_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? process.env.PUBLIC_APP_URL ?? "").trim();
  if (!candidate) {
    if (process.env.OAUTH_SERVER_URL) {
      try {
        return new URL(process.env.OAUTH_SERVER_URL).origin;
      } catch {
        return "";
      }
    }
    return "";
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return candidate.replace(/\/+$/, "");
  }
  // Keep any configured path prefix so webhook routes stay under it (e.g. /nova/api/telegram/...).
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}


/**
 * Voice-note transcription provider selection. Pollinations' unified API
 * (https://gen.pollinations.ai) is the default, but only when a Pollinations
 * key is present: setting POLLINATIONS_API_KEY (and no explicit
 * TRANSCRIPTION_API_BASE_URL / TRANSCRIPTION_API_KEY) opts into Pollinations,
 * while a legacy TRANSCRIPTION_API_KEY - which in existing deployments is an
 * OpenAI credential - keeps the former OpenAI endpoint and model, so that key
 * is never sent to Pollinations. TRANSCRIPTION_API_BASE_URL overrides the
 * endpoint for any OpenAI-compatible provider (OpenAI, Groq, Pollinations,
 * ...); TRANSCRIPTION_MODEL overrides the model; TRANSCRIPTION_API_KEY takes
 * precedence over POLLINATIONS_API_KEY.
 */
export function resolveTranscriptionConfig() {
  const pollinationsKey = (process.env.POLLINATIONS_API_KEY ?? "").trim();
  const explicitKey = (process.env.TRANSCRIPTION_API_KEY ?? "").trim();
  const explicitBaseUrl = (process.env.TRANSCRIPTION_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const explicitModel = (process.env.TRANSCRIPTION_MODEL ?? "").trim();
  const usePollinations = !explicitBaseUrl && !!pollinationsKey && !explicitKey;
  const apiBaseUrl = explicitBaseUrl || (usePollinations ? "https://gen.pollinations.ai/v1" : "https://api.openai.com/v1");
  return {
    transcriptionApiBaseUrl: apiBaseUrl,
    transcriptionApiKey: explicitKey || pollinationsKey,
    transcriptionModel: explicitModel || (apiBaseUrl.includes("gen.pollinations.ai") ? "openai/whisper-large-v3" : "whisper-1"),
  };
}

/**
 * Resolves the coder sub-agent's NVIDIA NIM API key. The dedicated
 * NVIDIA_NIM_API_KEY wins; otherwise the deployment's pre-Mistral gateway
 * names - NVIDIA_API_KEY or NOVA_NVIDIA_GATEWAY_TOKEN - work as fallbacks
 * because they authenticate against the same hosted NIM endpoint, so an
 * already-configured deployment needs no new secrets. Empty string when
 * none is set.
 */
export function resolveNimApiKey(source: NodeJS.ProcessEnv = process.env) {
  return (
    source.NVIDIA_NIM_API_KEY ??
    source.NVIDIA_API_KEY ??
    source.NOVA_NVIDIA_GATEWAY_TOKEN ??
    ""
  );
}

export const ENV = {
  // Retained for optional legacy modules that are not part of the Vercel runtime.
  appId: process.env.VITE_APP_ID ?? "",
  /** Prefer a dedicated session secret, then retain backward compatibility with legacy and existing server-only secrets. */
  cookieSecret: process.env.NOVA_SESSION_SECRET ?? process.env.JWT_SECRET ?? process.env.MODEL_CREDENTIAL_SECRET ?? process.env.POSTGRES_PASSWORD ?? process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  neonAuthBaseUrl: neonAuthVerification.baseUrl,
  neonAuthIssuer: neonAuthVerification.issuer,
  neonAuthAudience: neonAuthVerification.audience,
  neonAuthJwksUrl: neonAuthVerification.jwksUrl,
  /** Prefer an application-specific secret; Vercel-managed Postgres credentials provide a secure fallback. */
  modelCredentialSecret: process.env.MODEL_CREDENTIAL_SECRET ?? process.env.POSTGRES_PASSWORD ?? process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  /** Public HTTPS base URL used to register the Telegram webhook (NOVA_PUBLIC_BASE_URL > PUBLIC_BASE_URL > PUBLIC_APP_URL). Falls back to the OAUTH_SERVER_URL origin. */
  publicBaseUrl: resolvePublicBaseUrl(),
  /** Server-wide Telegram bot that works without any per-user configuration; the app auto-registers its webhook. Empty string when unset. */
  defaultTelegramBotToken: process.env.DEFAULT_TELEGRAM_BOT_TOKEN ?? "",
  /** Prefer a dedicated HMAC secret for /api/agent/continue; existing server-only secrets provide a secure fallback so continuation chaining works without extra setup. Empty disables chaining. */
  agentContinueSecret: process.env.AGENT_CONTINUE_SECRET ?? process.env.NOVA_SESSION_SECRET ?? process.env.POSTGRES_PASSWORD ?? process.env.DATABASE_URL ?? "",
  /** Composio project API key enabling connector toolkits (GitHub, etc.). Empty string when unset. */
  composioApiKey: process.env.COMPOSIO_API_KEY ?? "",
  /** Exa AI API key powering the researcher sub-agent's deep web search. Empty string when unset. */
  exaApiKey: process.env.EXA_API_KEY ?? "",
  /** Resolved by resolveNimApiKey: the dedicated name, then the legacy gateway names. */
  nimApiKey: resolveNimApiKey(),
  /** NVIDIA NIM OpenAI-compatible base URL: the hosted NIM endpoint by default, a self-hosted NIM container works too. */
  nimApiUrl: process.env.NVIDIA_NIM_API_URL ?? "https://integrate.api.nvidia.com/v1",
  /**
   * The coding model the coder sub-agent calls on NVIDIA NIM. On the hosted
   * endpoint this defaults to the strongest coding model NIM serves;
   * deepseek-ai/deepseek-v4-flash-0731 is the faster, cheaper alternative. A
   * self-hosted or custom endpoint registers different served model IDs
   * (e.g. 'moonshotai/kimi-k3'), so NVIDIA_NIM_CODER_MODEL
   * must be set explicitly there - it resolves to empty until it is.
   */
  nimCoderModel:
    process.env.NVIDIA_NIM_CODER_MODEL ??
    ((process.env.NVIDIA_NIM_API_URL ?? "https://integrate.api.nvidia.com/v1") ===
    "https://integrate.api.nvidia.com/v1"
      ? "moonshotai/kimi-k3"
      : ""),
  /** Netlify personal access token powering free live website deployments. Empty string when unset. */
  netlifyApiToken: process.env.NETLIFY_API_TOKEN ?? "",
  /** Voice-note transcription provider (see resolveTranscriptionConfig: Pollinations unified API by default, legacy OpenAI keys keep OpenAI). */
  ...resolveTranscriptionConfig(),
  /** Composio REST base URL (defaults to the hosted v3.1 API). */
  composioApiUrl: process.env.COMPOSIO_API_URL ?? "https://backend.composio.dev",
  /** How long the Telegram webhook waits for the model's own send_progress_update before sending a deterministic "still working" fallback note. Overridable so tests do not wait the real delay. */
};
