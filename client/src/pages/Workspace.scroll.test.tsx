// @vitest-environment jsdom
import React, { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

// The chat auto-scroll effect only runs client-side; let React's act() work
// in this jsdom test without a full testing-library setup.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Mirrors the chat viewport's scroll logic in Workspace.tsx: a stick-to-bottom
// intent flag that only the user's own scrolling away from the bottom clears,
// and an auto-scroll effect that always lands at the bottom.
function ChatViewport({ working }: { working: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const handleChatScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= 120;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, [working]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleChatScroll}
      data-testid="chat-viewport"
      style={{ height: 200, overflowY: "auto" }}
    >
      <div style={{ height: 2000 }} />
    </div>
  );
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ChatViewport working={false} />);
  });
  return container.querySelector(
    '[data-testid="chat-viewport"]'
  ) as HTMLDivElement;
}

function scrollTo(el: HTMLDivElement, top: number) {
  Object.defineProperty(el, "scrollHeight", {
    value: 2000,
    configurable: true,
  });
  el.scrollTop = top;
  act(() => {
    el.dispatchEvent(new Event("scroll"));
  });
}

describe("chat auto-scroll", () => {
  it("sticks to the bottom while the agent works even after the user scrolled up", () => {
    const el = mount();
    // The user scrolls up to read earlier messages.
    scrollTo(el, 0);
    // Content grows as the agent works: the effect re-runs and re-pins.
    Object.defineProperty(el, "scrollHeight", {
      value: 2400,
      configurable: true,
    });
    act(() => {
      root?.render(<ChatViewport working={true} />);
    });
    expect(el.scrollTop).toBe(2400);
  });

  it("still lets a user who scrolls up during a run keep their place", () => {
    const el = mount();
    scrollTo(el, 0);
    act(() => {
      root?.render(<ChatViewport working={true} />);
    });
    // The user scrolls up again mid-run: the next content update must not
    // yank them back down.
    scrollTo(el, 0);
    Object.defineProperty(el, "scrollHeight", {
      value: 2400,
      configurable: true,
    });
    act(() => {
      root?.render(<ChatViewport working={true} />);
    });
    expect(el.scrollTop).toBe(0);
  });

  it("lands at the bottom when a run starts", () => {
    const el = mount();
    scrollTo(el, 0);
    act(() => {
      root?.render(<ChatViewport working={true} />);
    });
    expect(el.scrollTop).toBe(2000);
  });
});