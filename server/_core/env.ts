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

export const ENV = {
  // Retained for optional legacy modules that are not part of the Vercel runtime.
  appId: process.env.VITE_APP_ID ?? "",
  /** Prefer a dedicated session secret, then retain backward compatibility with legacy and existing server-only secrets. */
  cookieSecret: process.env.NOVA_SESSION_SECRET ?? process.env.JWT_SECRET ?? process.env.MODEL_CREDENTIAL_SECRET ?? process.env.POSTGRES_PASSWORD ?? process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  nvidiaNimApiUrl: (process.env.NVIDIA_NIM_API_URL && process.env.NVIDIA_NIM_API_URL.trim().length > 0) ? process.env.NVIDIA_NIM_API_URL : "https://integrate.api.nvidia.com/v1",
  nvidiaNimApiKey: process.env.NVIDIA_NIM_API_KEY ?? "",
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
};
