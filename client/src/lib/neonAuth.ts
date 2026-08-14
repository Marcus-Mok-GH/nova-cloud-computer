import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/neon-js/auth/vanilla/adapters";

const remoteAuthUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;
export const neonAuthFetchOptions = {
  fetchOptions: { credentials: "include" as const },
};

export function resolveNeonAuthUrl(
  authUrl: string | undefined,
  appOrigin?: string,
  appHostname?: string,
) {
  if (!authUrl || !appOrigin || !appHostname?.endsWith(".vercel.app")) return authUrl;
  return `${appOrigin.replace(/\/$/, "")}/neon-auth`;
}

const authUrl = resolveNeonAuthUrl(
  remoteAuthUrl,
  typeof window === "undefined" ? undefined : window.location.origin,
  typeof window === "undefined" ? undefined : window.location.hostname,
);

/** Neon Auth owns session cookies; Nova forwards only short-lived JWTs to its tRPC API. */
export const neonAuth = authUrl
  ? createAuthClient(authUrl, {
      adapter: BetterAuthVanillaAdapter(neonAuthFetchOptions),
    })
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
