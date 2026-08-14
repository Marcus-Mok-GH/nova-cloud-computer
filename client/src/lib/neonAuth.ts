import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/neon-js/auth/vanilla/adapters";

const remoteAuthUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;
export function getNeonAuthProxyRequestUrl(
  authRequestUrl: string | URL,
  authBaseUrl: string,
  appOrigin?: string,
  appHostname?: string,
) {
  const requestUrl = new URL(authRequestUrl, authBaseUrl);
  if (!appOrigin || !appHostname?.endsWith(".vercel.app")) return requestUrl.toString();

  const basePath = new URL(authBaseUrl).pathname.replace(/\/$/, "");
  const proxyUrl = new URL("/api/neon-auth", appOrigin);
  const relativePath = requestUrl.pathname.startsWith(basePath)
    ? requestUrl.pathname.slice(basePath.length).replace(/^\/+/, "")
    : requestUrl.pathname.replace(/^\/+/, "");

  proxyUrl.searchParams.set("proxyPath", relativePath);
  requestUrl.searchParams.forEach((value, key) => proxyUrl.searchParams.append(key, value));
  return proxyUrl.toString();
}

export const neonAuthFetchOptions = {
  fetchOptions: {
    credentials: "include" as const,
    customFetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
      if (typeof window === "undefined" || !remoteAuthUrl) return fetch(input, init);
      const request = input instanceof Request ? input : null;
      const proxyUrl = getNeonAuthProxyRequestUrl(
        request ? request.url : (input as string | URL),
        remoteAuthUrl,
        window.location.origin,
        window.location.hostname,
      );
      return fetch(proxyUrl, {
        method: init?.method ?? request?.method,
        headers: init?.headers ?? request?.headers,
        body: init?.body ?? (request?.method === "GET" || request?.method === "HEAD" ? undefined : request?.body),
        credentials: "include",
      });
    },
  },
};

/** Neon Auth owns session cookies; Nova forwards only short-lived JWTs to its tRPC API. */
export const neonAuth = remoteAuthUrl
  ? createAuthClient(remoteAuthUrl, {
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
