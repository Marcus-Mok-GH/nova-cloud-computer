import { describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@shared/const";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const signedInUser: NonNullable<TrpcContext["user"]> = {
  id: 1,
  openId: "neon-user-id",
  email: "sample@example.com",
  name: "Sample User",
  loginMethod: "neon_magic_link",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function createContext(user: TrpcContext["user"], clearCookie = vi.fn()): TrpcContext {
  return { user, req: { headers: {} } as TrpcContext["req"], res: { clearCookie } as TrpcContext["res"] };
}

describe("auth.me", () => {
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

  it("rejects deleteAccount when not authenticated", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.auth.deleteAccount()).rejects.toThrow();
  });
});
