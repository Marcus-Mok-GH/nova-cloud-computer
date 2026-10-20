import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@shared/const";

// The database is unavailable - the way an exhausted quota makes it - so any
// read from it fails.
const { getUserByOpenId, ensureUserWorkspaceProvisioned, upsertUser } = vi.hoisted(
  () => ({
    getUserByOpenId: vi.fn(async () => {
      throw new Error("quota exceeded");
    }),
    ensureUserWorkspaceProvisioned: vi.fn(async () => {
      throw new Error("quota exceeded");
    }),
    upsertUser: vi.fn(async () => {
      throw new Error("quota exceeded");
    }),
  })
);

vi.mock("../db", () => ({
  getUserByOpenId,
  ensureUserWorkspaceProvisioned,
  upsertUser,
}));

process.env.NOVA_SESSION_SECRET = "test-session-secret";

const { createContext } = await import("./context");
const { sdk } = await import("./sdk");

const signedInUser = {
  id: 7,
  openId: "neon-user-id",
  email: "sample@example.com",
  name: "Sample User",
  loginMethod: "neon_email_otp",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

/** A request double carrying the URL and headers the context reads. */
function fakeRequest(url: string, headers: Record<string, string> = {}) {
  return {
    originalUrl: url,
    path: url.split("?")[0],
    headers,
    header: (name: string) => headers[name.toLowerCase()],
  } as never;
}

function fakeResponse() {
  return { cookie: vi.fn(), clearCookie: vi.fn() } as never;
}

describe("tRPC context for the public Q&A route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a context without touching the database", async () => {
    // A signed-in visitor's cookie would normally pull the user row, which
    // fails outright while the database is unavailable.
    const token = await sdk.createSessionToken("neon-user-id", { name: "Sample" });
    const context = await createContext({
      req: fakeRequest("/api/trpc/support.ask?batch=1", {
        cookie: `${COOKIE_NAME}=${token}`,
      }),
      res: fakeResponse(),
    });

    expect(context.user).toBeNull();
    expect(getUserByOpenId).not.toHaveBeenCalled();
    expect(ensureUserWorkspaceProvisioned).not.toHaveBeenCalled();
  });

  it("still authenticates the signed-in user on every other route", async () => {
    getUserByOpenId.mockResolvedValueOnce(signedInUser as never);
    const token = await sdk.createSessionToken("neon-user-id", { name: "Sample" });
    const context = await createContext({
      req: fakeRequest("/api/trpc/auth.me?batch=1", {
        cookie: `${COOKIE_NAME}=${token}`,
      }),
      res: fakeResponse(),
    });

    expect(context.user?.openId).toBe("neon-user-id");
    expect(getUserByOpenId).toHaveBeenCalledWith("neon-user-id");
  });

  it("still fails a normal route when the database is unavailable", async () => {
    // The database-free path is scoped to the Q&A route on purpose: every other
    // route keeps reporting the outage rather than silently signing the user out.
    const token = await sdk.createSessionToken("neon-user-id", { name: "Sample" });
    await expect(
      createContext({
        req: fakeRequest("/api/trpc/auth.me?batch=1", {
          cookie: `${COOKIE_NAME}=${token}`,
        }),
        res: fakeResponse(),
      })
    ).rejects.toThrow("quota exceeded");
  });
});
