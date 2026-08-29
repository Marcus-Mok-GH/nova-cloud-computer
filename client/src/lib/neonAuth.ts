import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/neon-js/auth/vanilla/adapters";

const remoteAuthUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;

function isLocalHostname(hostname: string | undefined) {
  return !hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function resolveNeonAuthUrl(
  authUrl: string | undefined,
  appOrigin?: string,
  appHostname?: string,
) {
  if (!authUrl || !appOrigin || isLocalHostname(appHostname)) return authUrl;
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
  disableDefaultFetchPlugins: true,
};

/** Neon Auth owns session cookies; Nova forwards only short-lived JWTs to its tRPC API. */
export const neonAuth = authUrl
  ? createAuthClient(authUrl, {
      adapter: BetterAuthVanillaAdapter(neonAuthFetchOptions),
    })
  : null;

export const NEON_JWT_STORAGE_KEY = "nova_neon_access_token";

type StoredNeonJwt = { token: string; expiresAt: number };
type NeonTokenResult = { data?: { token?: string | null; session?: { token?: string | null } | null } | null };
type NeonAuthTokenClient = {
  getSession: () => Promise<NeonTokenResult>;
  token: () => Promise<NeonTokenResult>;
};

function isSignedJwt(token: string | null | undefined) {
  return Boolean(token && token.split(".").length === 3);
}

function getJwtExpirationMs(token: string) {
  try {
    const [, payload] = token.split(".");
    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, "=");
    const decodedPayload = JSON.parse(atob(paddedPayload)) as { exp?: unknown };
    return typeof decodedPayload.exp === "number" ? decodedPayload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberNeonJwt(token: string | null | undefined, now = Date.now()) {
  if (!isSignedJwt(token)) return null;
  const expiresAt = getJwtExpirationMs(token!);
  if (!expiresAt || expiresAt <= now) return token!;
  try {
    getStorage()?.setItem(NEON_JWT_STORAGE_KEY, JSON.stringify({ token: token!, expiresAt } satisfies StoredNeonJwt));
  } catch {
    // Ignore storage failures; the cookie-backed session remains the source of truth.
  }
  return token!;
}

export function getRememberedNeonJwt(now = Date.now()) {
  try {
    const raw = getStorage()?.getItem(NEON_JWT_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredNeonJwt>;
    if (!isSignedJwt(stored.token) || typeof stored.expiresAt !== "number" || stored.expiresAt <= now) {
      clearRememberedNeonJwt();
      return null;
    }
    return stored.token!;
  } catch {
    return null;
  }
}

export function clearRememberedNeonJwt() {
  try {
    getStorage()?.removeItem(NEON_JWT_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
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
    return rememberNeonJwt(payload.token);
  } catch {
    return null;
  }
}

/**
 * `getSession()` consumes Neon’s magic-link verifier when one is present in the
 * callback URL. Only after that exchange can `token()` yield the signed JWT
 * Nova sends to its protected API.
 */
export async function exchangeNeonVerifierAndGetJwt(client: NeonAuthTokenClient) {
  const session = await client.getSession();
  const sessionJwt = rememberNeonJwt(extractNeonJwt(session));
  if (sessionJwt) return sessionJwt;
  return rememberNeonJwt(extractNeonJwt(await client.token()));
}

export async function getNeonAccessToken() {
  if (!neonAuth || !authUrl) return null;
  const remembered = getRememberedNeonJwt();
  if (remembered) return remembered;
  const session = await neonAuth.getSession();
  return rememberNeonJwt(extractNeonJwt(session)) ?? getNeonJwtFromTokenEndpoint(authUrl);
}
