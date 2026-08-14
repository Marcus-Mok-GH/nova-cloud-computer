import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/neon-js/auth/vanilla/adapters";

const remoteAuthUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;
export function resolveNeonAuthUrl(
  authUrl: string | undefined,
  appOrigin?: string,
  appHostname?: string,
) {
  if (!authUrl || !appOrigin || !appHostname?.endsWith(".vercel.app")) return authUrl;
  return `${appOrigin.replace(/\/$/, "")}/api/neon-auth`;
}

const authUrl = resolveNeonAuthUrl(
  remoteAuthUrl,
  typeof window === "undefined" ? undefined : window.location.origin,
  typeof window === "undefined" ? undefined : window.location.hostname,
);

export const neonAuthFetchOptions = {
  fetchOptions: {
    credentials: "include" as const,
  },
};

/** Neon Auth owns session cookies; Nova forwards only short-lived JWTs to its tRPC API. */
export const neonAuth = authUrl
  ? createAuthClient(authUrl, {
      adapter: BetterAuthVanillaAdapter(neonAuthFetchOptions),
    })
  : null;

type NeonTokenResult = { data?: { token?: string | null; session?: { token?: string | null } | null } | null };
type NeonAuthTokenClient = {
  getSession: () => Promise<NeonTokenResult>;
  token: () => Promise<NeonTokenResult>;
};

function isSignedJwt(token: string | null | undefined) {
  return Boolean(token && token.split(".").length === 3);
}

export function extractNeonJwt(result: NeonTokenResult) {
  const token = result.data?.token;
  if (isSignedJwt(token)) return token!;
  const sessionToken = result.data?.session?.token;
  return isSignedJwt(sessionToken) ? sessionToken! : null;
}

/**
 * `getSession()` consumes Neon’s magic-link verifier when one is present in the
 * callback URL. Only after that exchange can `token()` yield the signed JWT
 * Nova sends to its protected API.
 */
export async function exchangeNeonVerifierAndGetJwt(client: NeonAuthTokenClient) {
  const session = await client.getSession();
  const sessionJwt = extractNeonJwt(session);
  if (sessionJwt) return sessionJwt;
  return extractNeonJwt(await client.token());
}

export async function getNeonAccessToken() {
  if (!neonAuth) return null;
  return exchangeNeonVerifierAndGetJwt(neonAuth);
}
