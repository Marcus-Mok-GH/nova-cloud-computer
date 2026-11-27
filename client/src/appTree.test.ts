import { beforeEach, describe, expect, it, vi } from "vitest";

const { getNeonAccessToken } = vi.hoisted(() => ({
  getNeonAccessToken: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("@/lib/neonAuth", () => ({ getNeonAccessToken }));

import { trpcAuthHeaders } from "./lib/trpcAuthHeaders";

describe("trpc auth headers", () => {
  beforeEach(() => {
    getNeonAccessToken.mockReset();
  });

  it("attaches the token when auth resolves one", async () => {
    getNeonAccessToken.mockResolvedValueOnce("signed.jwt.token");
    await expect(trpcAuthHeaders()).resolves.toEqual({
      Authorization: "Bearer signed.jwt.token",
    });
  });

  it("returns no headers when auth is unavailable", async () => {
    // Neon Auth itself can be over quota. `headers()` is awaited before the
    // fetch is issued, so a rejection here would stop a PUBLIC request from
    // being sent at all and surface the auth provider's quota message.
    getNeonAccessToken.mockRejectedValueOnce(
      new Error("Your account or project has exceeded the quota.")
    );
    await expect(trpcAuthHeaders()).resolves.toEqual({});
  });

  it("returns no headers when there is no signed-in session", async () => {
    getNeonAccessToken.mockResolvedValueOnce(null);
    await expect(trpcAuthHeaders()).resolves.toEqual({});
  });
});
