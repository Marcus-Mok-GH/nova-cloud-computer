import { describe, expect, it } from "vitest";
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

function createContext(user: TrpcContext["user"]): TrpcContext {
  return { user, req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
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
});
