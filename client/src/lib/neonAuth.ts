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
type NeonTokenResult = {
  data?: {
    token?: string | null;
    session?: { token?: string | null; access_token?: string | null } | null;
  } | null;
};

/**
 * Fallback cache lifetime for a remembered JWT whose `exp` claim cannot be
 * parsed. Without it the token would be used once and never cached, so every
 * page load would have to rebuild a session from scratch.
 */
const REMEMBERED_JWT_FALLBACK_TTL_MS = 60 * 60 * 1000;
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
  const parsedExpiry = getJwtExpirationMs(token!);
  // A token whose expiry cannot be read is still worth caching for a short
  // fallback window: skipping the cache means every page load starts from a
  // bare cookie, and a stale cached token is recovered by the signed-out
  // retry in useAuth rather than bouncing the user to sign in.
  const expiresAt = parsedExpiry ?? now + REMEMBERED_JWT_FALLBACK_TTL_MS;
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
  // The vanilla adapter maps Better Auth's raw session into
  // `{ access_token, ... }` (see mapBetterAuthSession in @neondatabase/auth),
  // while the raw `get-session` response keeps Neon's signed JWT under
  // `session.token`. Both shapes must be read or a valid session looks
  // tokenless on restore.
  const mappedAccessToken = result.data?.session?.access_token;
  if (isSignedJwt(mappedAccessToken)) return mappedAccessToken!;
  const rawSessionToken = result.data?.session?.token;
  return isSignedJwt(rawSessionToken) ? rawSessionToken! : null;
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
