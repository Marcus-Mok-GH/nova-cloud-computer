import { createAuthClient } from "@neondatabase/neon-js/auth";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;

/** Neon Auth owns session cookies; Nova forwards only short-lived JWTs to its tRPC API. */
export const neonAuth = authUrl
  ? createAuthClient(authUrl)
  : null;

export async function getNeonAccessToken() {
  if (!neonAuth) return null;
  const result = await neonAuth.token();
  return result.data?.token ?? null;
}
