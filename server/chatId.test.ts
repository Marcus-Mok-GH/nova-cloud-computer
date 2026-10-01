import { describe, expect, it } from "vitest";
import { newChatId } from "./chatId";

describe("newChatId", () => {
  it("returns a short, URL-safe identifier", () => {
    const id = newChatId();
    expect(id).toMatch(/^[0-9a-z]{10}$/);
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newChatId()));
    expect(ids.size).toBe(500);
  });
});
