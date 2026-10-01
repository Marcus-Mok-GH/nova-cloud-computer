import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = global.fetch;
const envState = { neonAuthBaseUrl: "" };

vi.mock("./_core/env", () => ({ ENV: envState }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  envState.neonAuthBaseUrl = "https://auth.example.com/neondb/auth";
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.clearAllMocks();
});

describe("account deletion OTP helpers", () => {
  it("sends a deletion code through Neon Auth as an email-verification OTP", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: "success" }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { sendAccountDeletionOtp } = await import("./accountDeletion");
    await expect(sendAccountDeletionOtp("User@Example.com ")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth.example.com/neondb/auth/email-otp/send-verification-otp",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ email: "user@example.com", type: "email-verification" });
  });

  it("throws when Neon Auth is not configured", async () => {
    envState.neonAuthBaseUrl = "";
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { sendAccountDeletionOtp } = await import("./accountDeletion");
    await expect(sendAccountDeletionOtp("user@example.com")).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the OTP send request fails", async () => {
    global.fetch = vi.fn(async () => jsonResponse({ error: "nope" }, 500)) as unknown as typeof fetch;
    const { sendAccountDeletionOtp } = await import("./accountDeletion");
    await expect(sendAccountDeletionOtp("user@example.com")).rejects.toThrow(/could not send/);
  });

  it("accepts a valid code from the side-effect-free check endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ valid: true }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { verifyAccountDeletionOtp } = await import("./accountDeletion");
    await expect(verifyAccountDeletionOtp({ email: "user@example.com", otp: "123456" })).resolves.toEqual({ valid: true });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ email: "user@example.com", otp: "123456", type: "email-verification" });
  });

  it("surfaces the provider's error message for a wrong code", async () => {
    global.fetch = vi.fn(async () => jsonResponse({ valid: false, error: { message: "Invalid OTP" } })) as unknown as typeof fetch;
    const { verifyAccountDeletionOtp } = await import("./accountDeletion");
    await expect(verifyAccountDeletionOtp({ email: "user@example.com", otp: "000000" })).resolves.toEqual({ valid: false, error: "Invalid OTP" });
  });

  it("falls back to a generic message when verification fails without a provider message", async () => {
    global.fetch = vi.fn(async () => jsonResponse({ valid: false })) as unknown as typeof fetch;
    const { verifyAccountDeletionOtp } = await import("./accountDeletion");
    await expect(verifyAccountDeletionOtp({ email: "user@example.com", otp: "000000" })).resolves.toMatchObject({ valid: false, error: expect.stringMatching(/not valid or has expired/) });
  });

  it("reports a network failure as a retryable verification error", async () => {
    global.fetch = vi.fn(async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch;
    const { verifyAccountDeletionOtp } = await import("./accountDeletion");
    await expect(verifyAccountDeletionOtp({ email: "user@example.com", otp: "123456" })).resolves.toMatchObject({ valid: false, error: expect.stringMatching(/could not reach/) });
  });
});
