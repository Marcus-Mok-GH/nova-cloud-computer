import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@shared/const";

// The pinned developer address from shared/const.ts. Duplicated here so the test
// fails loudly if the constant and this fixture ever drift apart.
const SOLE_DEVELOPER_EMAIL = "mokmarcus068@gmail.com";

const mocks = vi.hoisted(() => ({
  getUserByOpenId: vi.fn(),
  upsertUser: vi.fn(),
  ensureUserWorkspaceProvisioned: vi.fn(),
  verifySession: vi.fn(),
  createSessionToken: vi.fn(),
}));

vi.mock("../db", () => ({
  getUserByOpenId: mocks.getUserByOpenId,
  upsertUser: mocks.upsertUser,
  ensureUserWorkspaceProvisioned: mocks.ensureUserWorkspaceProvisioned,
}));

vi.mock("./sdk", () => ({
  sdk: {
    verifySession: mocks.verifySession,
    createSessionToken: mocks.createSessionToken,
  },
}));

vi.mock("./env", () => ({
  ENV: {
    cookieSecret: "test-cookie-secret",
    neonAuthJwksUrl: "",
    neonAuthIssuer: "",
    neonAuthAudience: "",
  },
}));

vi.mock("./cookies", () => ({ getSessionCookieOptions: () => ({}) }));

import { createContext } from "./context";

function sessionOptions() {
  return {
    req: {
      header: (name: string) =>
        name.toLowerCase() === "cookie" ? `${COOKIE_NAME}=session-token` : undefined,
      protocol: "https",
      headers: {},
    },
    res: { cookie: vi.fn() },
  } as never;
}

function storedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    openId: "open-1",
    name: "Marcus",
    email: SOLE_DEVELOPER_EMAIL,
    loginMethod: "neon_email_otp",
    role: "admin",
    bannedAt: null,
    username: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

describe("first-party session developer pin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifySession.mockResolvedValue({ openId: "open-1", name: "Marcus" });
    mocks.createSessionToken.mockResolvedValue("token");
    mocks.upsertUser.mockResolvedValue(undefined);
    mocks.ensureUserWorkspaceProvisioned.mockResolvedValue(undefined);
  });

  it("repairs a stale admin rank on the pinned developer address", async () => {
    mocks.getUserByOpenId.mockResolvedValue(storedUser({ role: "admin" }));

    const ctx = await createContext(sessionOptions());

    expect(mocks.upsertUser).toHaveBeenCalledTimes(1);
    expect(mocks.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ openId: "open-1", email: SOLE_DEVELOPER_EMAIL })
    );
    expect(ctx.user?.role).toBe("developer");
  });

  it("leaves an already-correct developer rank alone", async () => {
    mocks.getUserByOpenId.mockResolvedValue(storedUser({ role: "developer" }));

    const ctx = await createContext(sessionOptions());

    expect(mocks.upsertUser).not.toHaveBeenCalled();
    expect(ctx.user?.role).toBe("developer");
  });

  it("does not touch the rank of a different account", async () => {
    mocks.getUserByOpenId.mockResolvedValue(
      storedUser({ email: "someone@example.com", role: "admin" })
    );

    const ctx = await createContext(sessionOptions());

    expect(mocks.upsertUser).not.toHaveBeenCalled();
    expect(ctx.user?.role).toBe("admin");
  });
});
