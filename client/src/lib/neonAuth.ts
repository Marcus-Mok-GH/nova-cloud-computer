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

export async function getNeonJwtFromTokenEndpoint(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
) {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/token`, { credentials: "include" });
    if (!response.ok) return null;
    const payload = await response.json() as { token?: string | null };
    return isSignedJwt(payload.token) ? payload.token! : null;
  } catch {
    return null;
  }
}

/** Retrieves the signed Neon session JWT after a completed sign-in flow. */
export async function exchangeNeonVerifierAndGetJwt(client: NeonAuthTokenClient) {
  const session = await client.getSession();
  const sessionJwt = extractNeonJwt(session);
  if (sessionJwt) return sessionJwt;
  return extractNeonJwt(await client.token());
}

export async function getNeonAccessToken() {
  if (!neonAuth || !authUrl) return null;
  const session = await neonAuth.getSession();
  return extractNeonJwt(session) ?? getNeonJwtFromTokenEndpoint(authUrl);
}
