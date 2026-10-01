import { ENV } from "./_core/env";

/** Neon Auth (Better Auth) OTP flavour used to confirm destructive actions. */
const DELETION_OTP_TYPE = "email-verification" as const;

type NeonAuthOtpPayload = {
  valid?: boolean;
  message?: string | null;
  error?: { message?: string | null; code?: string | null } | null;
};

function neonAuthEndpoint(path: string) {
  const base = ENV.neonAuthBaseUrl?.trim().replace(/\/+$/, "");
  return base ? `${base}/${path}` : null;
}

/**
 * Asks Neon Auth to email a verification OTP to the account's address, reusing
 * the same SMTP sender as sign-in codes. The code itself lives only in Neon's
 * auth service; Nova never sees or stores it.
 */
export async function sendAccountDeletionOtp(email: string): Promise<void> {
  const endpoint = neonAuthEndpoint("email-otp/send-verification-otp");
  if (!endpoint) throw new Error("Nova's authentication service is not configured, so a deletion code cannot be emailed.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), type: DELETION_OTP_TYPE }),
  });
  if (!response.ok) throw new Error(`Nova's authentication service could not send the deletion code (HTTP ${response.status}).`);
}

/**
 * Checks a candidate code against Neon Auth without consuming it, so a failed
 * database delete leaves the code valid for a retry. Returns the provider's
 * error text when invalid so the client can explain what went wrong.
 */
export async function verifyAccountDeletionOtp(input: { email: string; otp: string }): Promise<{ valid: boolean; error?: string }> {
  const endpoint = neonAuthEndpoint("email-otp/check-verification-otp");
  if (!endpoint) throw new Error("Nova's authentication service is not configured, so a deletion code cannot be verified.");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: input.email.trim().toLowerCase(), otp: input.otp, type: DELETION_OTP_TYPE }),
    });
  } catch {
    return { valid: false, error: "Nova could not reach the authentication service to verify that code. Try again in a moment." };
  }
  let payload: NeonAuthOtpPayload | null = null;
  try {
    payload = await response.json() as NeonAuthOtpPayload;
  } catch {
    // Non-JSON response bodies fall through to the generic messages below.
  }
  if (response.ok && payload?.valid === true) return { valid: true };
  const message = payload?.error?.message ?? payload?.message ?? undefined;
  if (message) return { valid: false, error: message };
  if (!response.ok) return { valid: false, error: `The code could not be verified (HTTP ${response.status}). Send a new code and try again.` };
  return { valid: false, error: "That code is not valid or has expired. Send a new code and try again." };
}
