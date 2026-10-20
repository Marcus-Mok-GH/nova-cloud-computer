import { describe, expect, it } from "vitest";
import { needsDatabaseBootstrap } from "./[...path]";

describe("database bootstrap dispatch", () => {
  it("skips the schema bootstrap and the recovery sweep for the public Q&A route", () => {
    // The bot never touches the database, so its requests spend no quota.
    expect(needsDatabaseBootstrap("/api/trpc/support.ask?batch=1")).toBe(false);
    expect(needsDatabaseBootstrap("/api/trpc/support.ask")).toBe(false);
  });

  it("keeps the bootstrap on every other route", () => {
    expect(needsDatabaseBootstrap("/api/trpc/auth.me?batch=1")).toBe(true);
    expect(needsDatabaseBootstrap("/api/chat/stream")).toBe(true);
    expect(needsDatabaseBootstrap("/api/v1/chat/completions")).toBe(true);
    expect(needsDatabaseBootstrap(undefined)).toBe(true);
  });
});
