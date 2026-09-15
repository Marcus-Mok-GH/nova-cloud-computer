/**
 * Email handling for the sign-in OTP flow.
 *
 * Reading the email straight from the form at submit time matters: autofill,
 * password managers, and IME input can update the input element without
 * React's onChange ever firing. Submitting that stale React state sent an
 * empty or partial email upstream, and Neon's generic INVALID_EMAIL reply
 * surfaced as the misleading "Invalid email address format" dead end even
 * though the address on screen was perfectly valid.
 */

export const EMAIL_INPUT_NAME = "email";

/**
 * Matches a normal, deliverable-looking address. Deliberately permissive
 * about the domain: temporary and disposable email providers are valid
 * sign-in destinations, so no blocklist filtering happens client-side.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reads the email from the submitted form, trimmed of stray whitespace. */
export function readSubmittedEmail(form: FormData) {
  const value = form.get(EMAIL_INPUT_NAME);
  return (typeof value === "string" ? value : "").trim();
}

/** Whether the submitted value looks like a usable email address. */
export function isValidSignInEmail(email: string) {
  return EMAIL_PATTERN.test(email);
}

/**
 * Neon maps several upstream failures (rejected domains, provider hiccups)
 * to the generic INVALID_EMAIL error, which the SDK renders as
 * "Invalid email address format". Since the value was already validated
 * locally, relay something actionable instead.
 */
export function friendlyOtpSendError(
  message: string | undefined,
  fallback: string
) {
  if (!message) return fallback;
  if (/invalid email/i.test(message)) {
    return "Nova's sign-in service could not send a code to that address. Double-check the email or try a different one.";
  }
  return message;
}
