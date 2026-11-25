// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScrollDebugEntry } from "./chatScrollDebug";
import { installScrollDebug, isScrollDebug } from "./chatScrollDebug";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("chat scroll diagnostics", () => {
  it("activates only with ?scrollDebug=1", () => {
    window.history.replaceState({}, "", "/app?chatId=1");
    expect(isScrollDebug()).toBe(false);
    window.history.replaceState({}, "", "/app?chatId=1&scrollDebug=1");
    expect(isScrollDebug()).toBe(true);
  });

  it("records scrollTop writes and scroll events, then cleans up", () => {
    const viewport = document.createElement("div");
    document.body.appendChild(viewport);
    const entries: ScrollDebugEntry[] = [];
    const cleanup = installScrollDebug(
      viewport,
      () => false,
      entry => entries.push(entry)
    );

    viewport.scrollTop = 42;
    viewport.dispatchEvent(new Event("scroll"));

    expect(entries.some(entry => entry.kind === "WRITE" && entry.detail.includes("→ 42"))).toBe(true);
    expect(entries.some(entry => entry.kind === "SCROLL")).toBe(true);
    expect(viewport.scrollTop).toBe(42);

    cleanup();
    const before = entries.length;
    viewport.scrollTop = 9;
    expect(entries.length).toBe(before);
    viewport.remove();
  });
});
