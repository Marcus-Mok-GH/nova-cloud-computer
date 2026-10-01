export const COOKIE_NAME = "app_session_id";
export const SEVEN_DAYS_MS = 1000 * 60 * 60 * 24 * 7;
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
/**
 * The account that holds the top-level `developer` rank. The developer rank
 * supersedes admin and grants unlimited Nova credits, so it is pinned to this
 * one address rather than assignable from the admin console.
 */
export const SOLE_DEVELOPER_EMAIL = 'mokmarcus068@gmail.com';
export function isDeveloperEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === SOLE_DEVELOPER_EMAIL;
}
/**
 * Marker prefixed to the assistant reply persisted when the AI service itself
 * failed. It is an internal detection marker: the client recognizes it to
 * render the offline/error state and substitutes its own generic copy, so the
 * marker (and any legacy raw detail after it) is never shown to users.
 * Messages persisted before the rename still carry the legacy prefix, which
 * the client also recognizes.
 */
export const MISTRAL_UNAVAILABLE_PREFIX = "Nova AI service error: ";
export const LEGACY_MISTRAL_UNAVAILABLE_PREFIX = "Mistral inference gateway error: ";

// One-time nonce cookie that binds an OAuth login to the browser that started
// it. The `__Host-` prefix forces the cookie host-only (Secure, Path=/, no
// Domain), so a sibling *.manus.space site cannot plant a matching value in a
// victim's browser.
export const OAUTH_STATE_COOKIE = "__Host-oauth_state";

// `state` carries the callback redirect URI (used at token exchange) plus the
// CSRF nonce. Defined here so the client encoder and server decoder never drift.
export type OAuthState = { redirectUri: string; nonce?: string };

export const encodeOAuthState = (state: OAuthState): string =>
  btoa(JSON.stringify(state));

export const decodeOAuthState = (state: string): OAuthState => {
  let decoded: string;
  try {
    decoded = atob(state);
  } catch {
    // Malformed base64 (e.g. attacker-supplied garbage). Return no nonce so the
    // callback's CSRF guard rejects it with 403 - never throw, since the caller
    // runs outside the request handler's try/catch.
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
    // Legacy links: `state` was a bare base64(redirectUri) with no nonce.
  }
  return { redirectUri: decoded };
};
