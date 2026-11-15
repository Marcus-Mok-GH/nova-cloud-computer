// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolActivity } from "@/lib/chatMessages";
import { ThinkingToolActivity } from "./toolActivityLine";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

function mount(activity: ToolActivity) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ThinkingToolActivity activity={activity} />);
  });
  return () =>
    container?.querySelector('[data-testid="thinking-detail-panel"]');
}

function rerender(activity: ToolActivity) {
  act(() => {
    root?.render(<ThinkingToolActivity activity={activity} />);
  });
}

/** jsdom has no layout: give the panel a height and capture scrollTop writes. */
function instrument(panel: Element) {
  const state = { scrolled: -1, height: 840 };
  Object.defineProperty(panel, "scrollTop", {
    configurable: true,
    get: () => state.scrolled,
    set: (value: number) => {
      state.scrolled = value;
    },
  });
  Object.defineProperty(panel, "scrollHeight", {
    configurable: true,
    get: () => state.height,
  });
  return state;
}

describe("thinking panel auto-scroll", () => {
  it("follows the streamed reasoning to the bottom while the model is thinking", () => {
    const panelOf = mount({
      id: "th-live",
      name: "thinking",
      state: "running",
      args: {},
    });
    const panel = panelOf();
    expect(panel).not.toBeNull();
    const state = instrument(panel!);
    rerender({
      id: "th-live",
      name: "thinking",
      state: "running",
      args: {},
      detail: "Weighing the trade-offs step by step, then the conclusion...",
    });
    expect(state.scrolled).toBe(840);
  });

  it("keeps a settled panel at rest when the user re-opens it to read", () => {
    const panelOf = mount({
      id: "th-done",
      name: "thinking",
      state: "completed",
      args: {},
      detail: "Full reasoning, settled round.",
    });
    // Collapsed on settle, so no panel yet.
    expect(panelOf()).toBeNull();
    const toggle = container!.querySelector("button");
    act(() => {
      toggle?.click();
    });
    const panel = panelOf();
    expect(panel).not.toBeNull();
    const state = instrument(panel!);
    // New detail must not yank a finished panel: running is over.
    rerender({
      id: "th-done",
      name: "thinking",
      state: "completed",
      args: {},
      detail: "Full reasoning, settled round. Edited afterward.",
    });
    expect(state.scrolled).toBe(-1);
  });
});
