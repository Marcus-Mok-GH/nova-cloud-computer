import { getNeonAccessToken } from "@/lib/neonAuth";

/**
 * Resolves the bearer token for a tRPC request.
 *
 * Auth can be unavailable - Neon itself can be over quota - and that must
 * never block a PUBLIC request. `headers()` is awaited before the fetch is
 * issued, so a rejection here prevents the request from being sent at all and
 * the page shows the auth service's quota message instead of the answer. A
 * protected request that goes out without a token is rejected by the server
 * as UNAUTHORIZED, so failing open here only loses the header, never the gate.
 */
export async function trpcAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = await getNeonAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // An auth outage must not stop a public request (the support bot) or hide
    // the real error behind the auth provider's message.
    return {};
  }
}
