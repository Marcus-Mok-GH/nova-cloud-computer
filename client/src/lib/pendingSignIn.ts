/**
 * Remembers the sign-in OTP step across a page refresh.
 *
 * The step (which email a code was sent to) lives in component state, so a
 * reload used to drop someone who was mid-code back onto the email form. The
 * pending email is kept per tab in sessionStorage, and only for as long as the
 * emailed code can still be used.
 */

const STORAGE_KEY = "nova_pending_signin";

/** Covers the emailed code's lifetime (Neon codes expire in minutes), then the step restarts at the email form. */
export const PENDING_SIGNIN_TTL_MS = 10 * 60 * 1000;

type PendingSignIn = { email: string; requestedAt: number };

function getStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Keeps the code step open for `email` across reloads. */
export function rememberPendingSignIn(email: string, now = Date.now()) {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify({ email, requestedAt: now } satisfies PendingSignIn));
  } catch {
    // Storage unavailable: the step simply won't survive a reload.
  }
}

/** The email awaiting a code, or null when there is no live pending step. */
export function readPendingSignIn(now = Date.now()): string | null {
  try {
    const raw = getStorage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<PendingSignIn>;
    if (
      typeof stored.email !== "string" ||
      !stored.email ||
      typeof stored.requestedAt !== "number" ||
      now - stored.requestedAt > PENDING_SIGNIN_TTL_MS
    ) {
      clearPendingSignIn();
      return null;
    }
    return stored.email;
  } catch {
    return null;
  }
}

/** Drops the pending step, e.g. after signing in or choosing another email. */
export function clearPendingSignIn() {
  try {
    getStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}
