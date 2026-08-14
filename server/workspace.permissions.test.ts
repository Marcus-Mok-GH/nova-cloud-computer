import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAnonymousContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("Nova workspace access", () => {
  it("rejects unauthenticated requests before exposing private workspace data", async () => {
    const caller = appRouter.createCaller(createAnonymousContext());
    await expect(caller.workspace.dashboard()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects unauthenticated task mutations", async () => {
    const caller = appRouter.createCaller(createAnonymousContext());
    await expect(caller.tasks.updateStatus({ id: 1, status: "done" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
