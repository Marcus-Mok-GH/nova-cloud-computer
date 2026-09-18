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
  /** HMAC secret guarding the /api/agent/continue self-invocation endpoint that chains segmented runs past the 300s limit. Empty disables continuation chaining. */
  agentContinueSecret: process.env.AGENT_CONTINUE_SECRET ?? "",
  /** Composio project API key enabling connector toolkits (GitHub, etc.). Empty string when unset. */
  composioApiKey: process.env.COMPOSIO_API_KEY ?? "",
  /** Exa AI API key powering the researcher sub-agent's deep web search. Empty string when unset. */
  exaApiKey: process.env.EXA_API_KEY ?? "",
  /** Netlify personal access token powering free live website deployments. Empty string when unset. */
  netlifyApiToken: process.env.NETLIFY_API_TOKEN ?? "",
  /** Voice-note transcription provider (see resolveTranscriptionConfig: Pollinations unified API by default, legacy OpenAI keys keep OpenAI). */
  ...resolveTranscriptionConfig(),
  /** Composio REST base URL (defaults to the hosted v3.1 API). */
  composioApiUrl: process.env.COMPOSIO_API_URL ?? "https://backend.composio.dev",
  /** How long the Telegram webhook waits for the model's own send_progress_update before sending a deterministic "still working" fallback note. Overridable so tests do not wait the real delay. */
};
