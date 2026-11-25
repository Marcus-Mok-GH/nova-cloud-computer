// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolActivity } from "@/lib/chatMessages";
import { ResearchToolActivity } from "./toolActivityLine";

let container: HTMLDivElement;
let root: Root;
let intoView: ReturnType<typeof vi.fn>;

function mount(activity: ToolActivity) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ResearchToolActivity activity={activity} />));
}

function update(activity: ToolActivity) {
  act(() => root.render(<ResearchToolActivity activity={activity} />));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe("live progress log", () => {
  it("never scrolls the chat viewport to follow new progress lines", () => {
    intoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: intoView,
    });
    mount({
      id: "p1",
      name: "research_web",
      state: "running",
      args: {},
      progressLog: ["Reading the brief"],
    });
    intoView.mockClear();
    const panel = container.querySelector('[data-testid="progress-log"]');
    expect(panel).not.toBeNull();
    let scrolled = -1;
    Object.defineProperty(panel!, "scrollTop", {
      configurable: true,
      get: () => scrolled,
      set: (value: number) => { scrolled = value; },
    });
    Object.defineProperty(panel!, "scrollHeight", {
      configurable: true,
      get: () => 840,
    });
    update({
      id: "p1",
      name: "research_web",
      state: "running",
      args: {},
      progressLog: ["Reading the brief", "Searching the web", "Opening a source"],
    });
    // scrollIntoView walks EVERY scrollable ancestor, including the chat
    // viewport, so it yanks the conversation away from the newest message.
    expect(intoView).not.toHaveBeenCalled();
    // It follows the log itself instead.
    expect(scrolled).toBe(840);
  });
});
