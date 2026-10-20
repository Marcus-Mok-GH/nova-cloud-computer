import { describe, expect, it } from "vitest";
import { isSupportBotRequestPath } from "./supportBotPath";

describe("public Q&A request path", () => {
  it("recognizes the widget's own tRPC call", () => {
    expect(isSupportBotRequestPath("/api/trpc/support.ask?batch=1")).toBe(true);
    expect(isSupportBotRequestPath("/api/trpc/support.ask")).toBe(true);
    expect(isSupportBotRequestPath("/support.ask")).toBe(true);
  });

  it("leaves every other route on the database-backed path", () => {
    expect(isSupportBotRequestPath("/api/trpc/auth.me?batch=1")).toBe(false);
    expect(isSupportBotRequestPath("/api/chat/stream")).toBe(false);
    expect(isSupportBotRequestPath("/api/trpc")).toBe(false);
    expect(isSupportBotRequestPath(undefined)).toBe(false);
  });

  it("keeps a batch that carries other procedures on the database-backed path", () => {
    // The other procedure in the batch still needs the session lookup.
    expect(isSupportBotRequestPath("/api/trpc/support.ask,auth.me?batch=1")).toBe(
      false
    );
  });

  it("reads the same path segment the tRPC adapter dispatches on", () => {
    // The adapter takes the last segment of the mount-relative path, so a
    // URL that ends in another procedure dispatches that procedure and must
    // not be treated as the Q&A route.
    expect(isSupportBotRequestPath("/api/trpc/support.ask/../auth.me")).toBe(
      false
    );
    expect(isSupportBotRequestPath("/api/trpc/support.ask/")).toBe(false);
    expect(isSupportBotRequestPath("/api/trpc/support.ask/support.ask")).toBe(
      true
    );
  });
});
