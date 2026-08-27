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
  neonAuthBaseUrl: process.env.NEON_AUTH_BASE_URL ?? "",
  // Neon Auth JWTs use the project root URL as issuer/audience. Keep these
  // separately configurable because the Auth API base URL normally contains
  // a path (for example /neondb/auth), while JWT iss/aud do not.
  neonAuthIssuer: process.env.NEON_AUTH_ISSUER?.trim() || (process.env.NEON_AUTH_BASE_URL ? new URL(process.env.NEON_AUTH_BASE_URL).origin : ""),
  neonAuthAudience: process.env.NEON_AUTH_AUDIENCE?.trim() || (process.env.NEON_AUTH_BASE_URL ? new URL(process.env.NEON_AUTH_BASE_URL).origin : ""),
  neonAuthJwksUrl: process.env.NEON_AUTH_JWKS_URL?.trim() || (process.env.NEON_AUTH_BASE_URL ? `${process.env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}/.well-known/jwks.json` : ""),
  /** Prefer an application-specific secret; Vercel-managed Postgres credentials provide a secure fallback. */
  modelCredentialSecret: process.env.MODEL_CREDENTIAL_SECRET ?? process.env.POSTGRES_PASSWORD ?? process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
