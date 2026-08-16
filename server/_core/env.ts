export const ENV = {
  // Retained for optional legacy modules that are not part of the Vercel runtime.
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  nvidiaNimApiUrl: (process.env.NVIDIA_NIM_API_URL && process.env.NVIDIA_NIM_API_URL.trim().length > 0) ? process.env.NVIDIA_NIM_API_URL : "https://integrate.api.nvidia.com/v1",
  nvidiaNimApiKey: process.env.NVIDIA_NIM_API_KEY ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  neonAuthBaseUrl: process.env.NEON_AUTH_BASE_URL ?? "",
  /** Prefer an application-specific secret; Vercel-managed Postgres credentials provide a secure fallback. */
  modelCredentialSecret: process.env.MODEL_CREDENTIAL_SECRET ?? process.env.POSTGRES_PASSWORD ?? process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
};
