// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom is not a React act environment by default; without this every act()
// call warns and React cannot batch the updates the assertions rely on.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    chats: {
      create: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
    },
  },
}));

// Radix dialogs portal to nowhere under jsdom, so the shell is swapped for
// passthrough elements - the page travel lives in the flow's own markup.
vi.mock("@/components/ui/dialog", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    Dialog: ({ children }: { children?: React.ReactNode }) =>
      createElement(Fragment, null, children),
    DialogContent: ({
      children,
      className,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => createElement("div", { className }, children),
  };
});

import { OnboardingFlow } from "./OnboardingFlow";

const ENTER_MS = 420;
const OUT_MS = 160;
const IN_MS = 380;

describe("OnboardingFlow page travel", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    vi.useRealTimers();
  });

  const page = () => container?.querySelector("main > div");
  const title = () =>
    container?.querySelector("h1")?.textContent?.trim() ?? "";
  const pageClass = () => page()?.className ?? "";

  const clickButton = async (predicate: (btn: HTMLButtonElement) => boolean) => {
    const btn = Array.from(container?.querySelectorAll("button") ?? []).find(
      predicate
    ) as HTMLButtonElement | undefined;
    expect(btn, "expected a matching button").toBeTruthy();
    await act(async () => {
      btn?.click();
    });
  };

  const clickText = (text: string) =>
    clickButton(btn => (btn.textContent ?? "").includes(text));

  /** Mount and let the first entrance finish, so a test starts from idle. */
  const mountIdle = async () => {
    await act(async () => {
      root?.render(
        <OnboardingFlow onOpenChange={() => {}} onFinish={() => {}} />
      );
    });
    expect(pageClass()).toContain("ios-enter");
    await act(async () => {
      vi.advanceTimersByTime(ENTER_MS + 80);
    });
    expect(pageClass()).not.toContain("ios-");
  };

  it("pushes the next page in from the right, then pops back from the left", async () => {
    await mountIdle();

    await clickText("Give it a job");
    // The outgoing page leaves first and is still the old one while it goes.
    expect(pageClass()).toContain("ios-page-out-left");
    expect(title()).toContain("An agent with a computer");

    await act(async () => {
      vi.advanceTimersByTime(OUT_MS);
    });
    expect(title()).toContain("first thing you want Nova to do");
    expect(pageClass()).toContain("ios-page-in-right");

    await act(async () => {
      vi.advanceTimersByTime(IN_MS + 80);
    });
    expect(pageClass()).not.toContain("ios-page-");

    await clickButton(btn => btn.getAttribute("aria-label") === "Previous step");
    expect(pageClass()).toContain("ios-page-out-right");
    await act(async () => {
      vi.advanceTimersByTime(OUT_MS);
    });
    expect(pageClass()).toContain("ios-page-in-left");
    expect(title()).toContain("An agent with a computer");
  });

  it("ignores a second tap while a travel is already running", async () => {
    await mountIdle();

    await clickText("Give it a job");
    // Same button, tapped again before the outgoing page has left.
    await clickText("Give it a job");
    await act(async () => {
      vi.advanceTimersByTime(OUT_MS);
    });
    expect(title()).toContain("first thing you want Nova to do");
    // Only one travel ran, so the page has already settled.
    await act(async () => {
      vi.advanceTimersByTime(IN_MS + 80);
    });
    expect(pageClass()).not.toContain("ios-page-");
  });
});
