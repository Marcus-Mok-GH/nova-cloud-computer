import { describe, expect, it } from "vitest";
import {
  EMAIL_INPUT_NAME,
  friendlyOtpSendError,
  isValidSignInEmail,
  readSubmittedEmail,
} from "./signInEmail";

function formWithEmail(value: string | null) {
  const form = new FormData();
  if (value !== null) form.append(EMAIL_INPUT_NAME, value);
  return form;
}

describe("readSubmittedEmail", () => {
  it("reads and trims the live input value", () => {
    expect(readSubmittedEmail(formWithEmail("  user@example.com \n"))).toBe(
      "user@example.com"
    );
  });

  it("returns an empty string when the field is missing", () => {
    expect(readSubmittedEmail(new FormData())).toBe("");
  });
});

describe("isValidSignInEmail", () => {
  it("accepts temporary and disposable email domains", () => {
    expect(isValidSignInEmail("novaverify1789469673@uberip.com")).toBe(true);
    expect(isValidSignInEmail("someone@mail.temp-mail.org")).toBe(true);
  });

  it("accepts ordinary addresses", () => {
    expect(isValidSignInEmail("marcus@example.com")).toBe(true);
  });

  it("rejects values that cannot carry an OTP", () => {
    expect(isValidSignInEmail("")).toBe(false);
    expect(isValidSignInEmail("notanemail")).toBe(false);
    expect(isValidSignInEmail("user@")).toBe(false);
    expect(isValidSignInEmail("@example.com")).toBe(false);
    expect(isValidSignInEmail("user @example.com")).toBe(false);
  });
});

describe("friendlyOtpSendError", () => {
  it("turns the generic invalid-email dead end into an actionable message", () => {
    expect(friendlyOtpSendError("Invalid email address format", "fallback")).toBe(
      "Nova's sign-in service could not send a code to that address. Double-check the email or try a different one."
    );
  });

  it("keeps other upstream messages intact", () => {
    expect(friendlyOtpSendError("Too many requests. Try later.", "fallback")).toBe(
      "Too many requests. Try later."
    );
  });

  it("falls back when no message is available", () => {
    expect(friendlyOtpSendError(undefined, "Nova could not send that sign-in code.")).toBe(
      "Nova could not send that sign-in code."
    );
  });
});
