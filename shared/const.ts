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
export const AI_UNAVAILABLE_PREFIX = "Nova AI service error: ";
/**
 * Legacy form of the marker above. The literal text is part of message rows
 * already persisted in the database, so it must stay byte-for-byte identical
 * for the client to keep recognizing (and hiding) those older replies.
 */
export const LEGACY_AI_UNAVAILABLE_PREFIX = "Mistral inference gateway error: ";

// Internal chat-ledger row markers. The server writers and the client's
// parser both recognize these byte-for-byte identical prefixes, and the
// literal text is also part of message rows already persisted in the
// database - so they live here, shared by both sides, where they cannot drift.
/** Tool-activity rows: one per tool call, filtered from history and bubbles. */
export const TOOL_ACTIVITY_MESSAGE_PREFIX = "__nova_tool_activity__:";
/** Specialist-acceptance bookkeeping rows - never rendered. */
export const SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX =
  "__nova_specialist_acceptance__:";
/** Workflow-mode marker rows (the conversation's stage) - never rendered. */
export const AGENT_MODE_MESSAGE_PREFIX = "__nova_agent_mode__:";
/** One turn's tappable follow-up suggestions, rendered as chips. */
export const FOLLOW_UP_MESSAGE_PREFIX = "__nova_follow_ups__:";

/**
 * The public name of Nova's built-in model. The inference API never exposes
 * the underlying gateway model id: clients ask for `nova-pro` and the built-in
 * gateway resolves whichever default this deployment is configured with.
 * Server modules share it from here so no copy has to import across a cycle.
 */
export const NOVA_PRO_MODEL_ID = "nova-pro";

// Chat-image attachment limits. The browser composer (which downscales and
// encodes each picked image) and the server endpoint (which validates the
// request body) must enforce the same caps, so they live here where they
// cannot drift.
/** Most images one chat message may carry. */
export const MAX_CHAT_IMAGE_ATTACHMENTS = 4;
/**
 * Combined encoded size of one message's images. Keeps the whole JSON body
 * comfortably inside the endpoint's request-body limit even when every
 * attachment is large.
 */
export const MAX_CHAT_IMAGE_TOTAL_CHARS = 3_500_000;
/**
 * Image types the composer accepts (any case), mapped to the file extension
 * a stored chat image gets. The server parses data URIs with this table, and
 * the browser filters picked files against the same key set.
 */
export const SUPPORTED_CHAT_IMAGE_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Chat file attachments: the non-image assets (documents, audio, archives...)
// the web composer accepts by drag & drop or picker and sends as base64 data
// URIs. Like the image table above, the browser composer and the server's
// request validation enforce the same caps from here so they cannot drift.
/** Most non-image files one chat message may carry. */
export const MAX_CHAT_FILE_ATTACHMENTS = 3;
/**
 * Per-file cap on the encoded data URI. Base64 inflates by ~33%, so this is
 * roughly a 1.9 MB file - large enough for documents, audio clips, and small
 * archives while staying inside the endpoint's 4mb body limit.
 */
export const MAX_CHAT_FILE_DATA_URI_CHARS = 2_600_000;
/**
 * Combined encoded size of one message's images AND files. The endpoint's
 * JSON body limit is 4mb, so this single budget keeps every attachment mix
 * comfortably inside it.
 */
export const MAX_CHAT_ATTACHMENT_TOTAL_CHARS = 3_500_000;
/**
 * Content types never accepted as chat file attachments: active/scriptable
 * documents that could execute if ever rendered or opened from the workspace.
 * Both the browser composer and the server filter against this list.
 */
export const BLOCKED_CHAT_FILE_MIME: readonly string[] = [
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
];

// One-time nonce cookie that binds an OAuth login to the browser that started
// it. The `__Host-` prefix forces the cookie host-only (Secure, Path=/, no
// Domain), so a sibling *.manus.space site cannot plant a matching value in a
// victim's browser.
export const OAUTH_STATE_COOKIE = "__Host-oauth_state";

// `state` carries the callback redirect URI (used at token exchange) plus the
// CSRF nonce. Defined here so the shape read by the server is the shape the
// login flow sends, whoever encodes it.
export type OAuthState = { redirectUri: string; nonce?: string };

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
