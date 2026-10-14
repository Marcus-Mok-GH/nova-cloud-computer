import { AiGatewayClientError } from "./aiGateway";

/**
 * Maximum characters of a model error quoted back to the person who sent the
 * message. Mirrors the gateway's own upstream cap so a chatty provider
 * cannot flood a chat bubble or a Telegram message.
 */
const DISCLOSED_DETAIL_CHARS = 600;

/** Error kinds whose raw text is deployment-internal, or not a failure at all. */
const UNDISCLOSED_MODEL_ERROR_KINDS = new Set([
  // A missing or rejected credential (401/403, no gateway configured) names
  // the deployment's own setup rather than what the message did wrong, and
  // the raw text may quote the configured key. The curated lead the caller
  // already wrote says it all.
  "configuration",
  // A /stop abort is a user action, not a failure to report.
  "stopped",
]);

/**
 * Credential shapes an upstream error may echo back - `Bearer <token>` lines
 * and key-shaped values (`sk-...`, `key_...`, `token-...`). A provider that
 * rejects a credential often quotes it in its error, and that quote must
 * never reach a chat, a Telegram message or the public inference API.
 */
export function redactModelCredentials(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [private credential]")
    .replace(
      /\b(?:sk|key|token|api[-_]?key)[-_=][A-Za-z0-9_=-]{6,}\b/gi,
      "[private credential]"
    );
}

/**
 * The full error detail appended when the model call itself fails. A generic
 * "something went wrong" notice hides the one clue that explains the failure,
 * so the model's own error text is disclosed instead - in the web chat and in
 * Telegram, which both render the reply it is appended to. The text is
 * credential-redacted and length-capped before it is shown. Errors that never
 * came from the model call (database, sandbox, internal wrappers) return "",
 * and their cause stays in the server log: it can name Nova internals.
 * `lead` is the reply already written for this failure - when it already
 * contains the same text, there is nothing extra to disclose.
 */
export function modelFailureDetail(
  error: unknown,
  lead: string,
  modelLabel: string
): string {
  if (!(error instanceof AiGatewayClientError)) return "";
  if (UNDISCLOSED_MODEL_ERROR_KINDS.has(error.kind)) return "";
  const detail = redactModelCredentials(error.message.trim()).slice(
    0,
    DISCLOSED_DETAIL_CHARS
  );
  if (!detail || lead.includes(detail)) return "";
  return `\n\nError details (${modelLabel}, ${error.kind}):\n${detail}`;
}
