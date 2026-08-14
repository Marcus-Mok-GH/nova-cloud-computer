import { createAuthClient } from "@neondatabase/neon-js/auth";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;

/** Neon Auth owns session cookies; Nova forwards only short-lived JWTs to its tRPC API. */
export const neonAuth = authUrl
  ? createAuthClient(authUrl)
  : null;

type NeonTokenResult = { data?: { token?: string | null } | null };
type NeonAuthTokenClient = {
  getSession: () => Promise<unknown>;
  token: () => Promise<NeonTokenResult>;
};

export function extractNeonJwt(result: NeonTokenResult) {
  return result.data?.token ?? null;
}

/**
 * `getSession()` consumes Neon’s magic-link verifier when one is present in the
 * callback URL. Only after that exchange can `token()` yield the signed JWT
 * Nova sends to its protected API.
 */
export async function exchangeNeonVerifierAndGetJwt(client: NeonAuthTokenClient) {
  await client.getSession();
  return extractNeonJwt(await client.token());
}

export async function getNeonAccessToken() {
  if (!neonAuth) return null;
  return exchangeNeonVerifierAndGetJwt(neonAuth);
}
