import { describe, expect, it } from "vitest";
import { isSupportBotRoute } from "./supportBot";

describe("isSupportBotRoute", () => {
  it("shows the assistant on the landing and docs pages", () => {
    expect(isSupportBotRoute("/")).toBe(true);
    expect(isSupportBotRoute("/docs")).toBe(true);
    expect(isSupportBotRoute("/docs/")).toBe(true);
    expect(isSupportBotRoute("/docs/api")).toBe(true);
    expect(isSupportBotRoute("/docs/api/")).toBe(true);
  });

  it("hides the assistant everywhere else", () => {
    expect(isSupportBotRoute("/app")).toBe(false);
    expect(isSupportBotRoute("/app/files")).toBe(false);
    expect(isSupportBotRoute("/sign-in")).toBe(false);
    expect(isSupportBotRoute("/docs/other")).toBe(false);
    expect(isSupportBotRoute("/404")).toBe(false);
  });
});
