/**
 * Router-level test for the onboarding country question: the country rides
 * in with the starter answers, normalised to an uppercase ISO 3166-1 code
 * that shared/countries.ts recognises, and comes back on the query the
 * onboarding modal and the reply-language wiring read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

type OnboardingAnswers = {
  source: string | null;
  useCase: string | null;
  experience: string | null;
  country: string | null;
  completedAt: Date | null;
};

const getUserOnboarding = vi.fn(
  async (_userId: number): Promise<OnboardingAnswers | null> => null
);
const saveUserOnboarding = vi.fn(async () => undefined);

vi.mock("./db", () => ({ getUserOnboarding, saveUserOnboarding }));

const { appRouter } = await import("./routers");

function contextFor(user: User): TrpcContext {
  return {
    user,
    banned: false,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
function userRow(id: number): User {
  return {
    id,
    openId: `user-${id}`,
    email: `user${id}@example.com`,
    name: null,
    loginMethod: "test",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    bannedAt: null,
    username: null,
    onboardingSource: null,
    onboardingUseCase: null,
    onboardingExperience: null,
    onboardingCompletedAt: null,
    onboardingCountry: null,
  };
}

describe("auth.saveOnboarding country", () => {
  beforeEach(() => {
    getUserOnboarding.mockClear();
    saveUserOnboarding.mockClear();
  });

  it("stores the country normalised to an uppercase ISO code", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.auth.saveOnboarding({
      country: "mx",
      completed: true,
    });
    expect(result).toEqual({ success: true });
    expect(saveUserOnboarding).toHaveBeenCalledWith(
      1,
      { source: null, useCase: null, experience: null, country: "MX" },
      true
    );
  });

  it("rejects a malformed or unknown country", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(
      caller.auth.saveOnboarding({ country: "USA" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.auth.saveOnboarding({ country: "XX" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(saveUserOnboarding).not.toHaveBeenCalled();
  });

  it("passes country null when the question is left blank", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await caller.auth.saveOnboarding({ completed: true });
    expect(saveUserOnboarding).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ country: null }),
      true
    );
  });
});

describe("auth.onboarding country", () => {
  beforeEach(() => {
    getUserOnboarding.mockClear();
  });

  it("returns the stored country with the answers", async () => {
    getUserOnboarding.mockResolvedValueOnce({
      source: "X",
      useCase: "build",
      experience: "some",
      country: "FR",
      completedAt: new Date(),
    });
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.auth.onboarding();
    expect(result).toEqual({
      completed: true,
      source: "X",
      useCase: "build",
      experience: "some",
      country: "FR",
    });
  });

  it("returns country null when nothing was saved", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.auth.onboarding();
    expect(result.completed).toBe(false);
    expect(result.country).toBeNull();
  });
});
