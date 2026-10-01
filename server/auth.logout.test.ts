import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@shared/const";
import type { TrpcContext } from "./_core/context";

const sendDeletionOtpSpy = vi.fn(async (email: string) => undefined);
const verifyDeletionOtpSpy = vi.fn(async (input: { email: string; otp: string }) => ({ valid: true }));
const deleteUserSpy = vi.fn(async (userId: number) => true);

vi.mock("./accountDeletion", () => ({
  sendAccountDeletionOtp: (email: string) => sendDeletionOtpSpy(email),
  verifyAccountDeletionOtp: (input: { email: string; otp: string }) => verifyDeletionOtpSpy(input),
}));
vi.mock("./db", () => ({
  deleteUserAccount: (userId: number) => deleteUserSpy(userId),
  requestAgentStopForUser: vi.fn(),
  cancelActiveAgentVmRunsForUser: vi.fn(),
}));

const { appRouter } = await import("./routers");

const signedInUser: NonNullable<TrpcContext["user"]> = {
  id: 1,
  openId: "neon-user-id",
  email: "sample@example.com",
  name: "Sample User",
  loginMethod: "neon_email_otp",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function createContext(user: TrpcContext["user"], clearCookie = vi.fn()): TrpcContext {
  return { user, req: { headers: {} } as TrpcContext["req"], res: { clearCookie } as TrpcContext["res"] };
}

describe("auth router", () => {
  beforeEach(() => { vi.clearAllMocks(); deleteUserSpy.mockResolvedValue(true); verifyDeletionOtpSpy.mockResolvedValue({ valid: true }); });
  it("returns the current Neon-authenticated Nova user", async () => {
    const caller = appRouter.createCaller(createContext(signedInUser));
    await expect(caller.auth.me()).resolves.toEqual(signedInUser);
  });

  it("returns null when no verified Neon identity is present", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.auth.me()).resolves.toBeNull();
  });

  it("clears Nova's first-party fallback session on logout", async () => {
    const clearCookie = vi.fn();
    const caller = appRouter.createCaller(createContext(signedInUser, clearCookie));

    await expect(caller.auth.logout()).resolves.toEqual({ success: true });
    expect(clearCookie).toHaveBeenCalledWith(COOKIE_NAME, expect.objectContaining({ httpOnly: true, path: "/" }));
  });

  it("rejects the deletion-code flow when not authenticated", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.auth.requestDeletionCode()).rejects.toThrow();
    await expect(caller.auth.confirmDeleteAccount({ code: "123456" })).rejects.toThrow();
  });

  it("refuses to email a deletion code for an account without an email address", async () => {
    const caller = appRouter.createCaller(createContext({ ...signedInUser, email: null }));
    await expect(caller.auth.requestDeletionCode()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(sendDeletionOtpSpy).not.toHaveBeenCalled();
  });

  it("emails a deletion code to the account address, then deletes after the code is verified", async () => {
    const caller = appRouter.createCaller(createContext(signedInUser));
    await expect(caller.auth.requestDeletionCode()).resolves.toEqual({ success: true, email: "sample@example.com" });
    expect(sendDeletionOtpSpy).toHaveBeenCalledWith("sample@example.com");
    await expect(caller.auth.confirmDeleteAccount({ code: "123456" })).resolves.toEqual({ success: true });
    expect(verifyDeletionOtpSpy).toHaveBeenCalledWith({ email: "sample@example.com", otp: "123456" });
    expect(deleteUserSpy).toHaveBeenCalledWith(1);
  });

  it("refuses the delete step when the emailed code is wrong and keeps the account", async () => {
    verifyDeletionOtpSpy.mockResolvedValueOnce({ valid: false, error: "Invalid OTP" });
    const caller = appRouter.createCaller(createContext(signedInUser));
    await expect(caller.auth.confirmDeleteAccount({ code: "000000" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(deleteUserSpy).not.toHaveBeenCalled();
  });

  it("rejects a deletion code that is not six digits", async () => {
    const caller = appRouter.createCaller(createContext(signedInUser));
    await expect(caller.auth.confirmDeleteAccount({ code: "12a456" })).rejects.toThrow();
    await expect(caller.auth.confirmDeleteAccount({ code: "12345" })).rejects.toThrow();
    expect(verifyDeletionOtpSpy).not.toHaveBeenCalled();
    expect(deleteUserSpy).not.toHaveBeenCalled();
  });

  it("reports a failed account delete as not found after the code verified", async () => {
    deleteUserSpy.mockResolvedValueOnce(false);
    const caller = appRouter.createCaller(createContext(signedInUser));
    await expect(caller.auth.confirmDeleteAccount({ code: "123456" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("emails a new code when the send step is retried", async () => {
    const caller = appRouter.createCaller(createContext(signedInUser));
    await caller.auth.requestDeletionCode();
    await caller.auth.requestDeletionCode();
    expect(sendDeletionOtpSpy).toHaveBeenCalledTimes(2);
  });

  it("reports a failed send without leaking provider internals", async () => {
    sendDeletionOtpSpy.mockRejectedValueOnce(new Error("socket hang up to https://auth.internal"));
    const caller = appRouter.createCaller(createContext(signedInUser));
    await expect(caller.auth.requestDeletionCode()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not email a verification code right now. Try again shortly." });
    expect(deleteUserSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the verification service is unreachable", async () => {
    verifyDeletionOtpSpy.mockRejectedValueOnce(new Error("Nova's authentication service is not configured"));
    const caller = appRouter.createCaller(createContext(signedInUser));
    await expect(caller.auth.confirmDeleteAccount({ code: "123456" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "Nova could not verify that code right now. Try again shortly." });
    expect(deleteUserSpy).not.toHaveBeenCalled();
  });
});
