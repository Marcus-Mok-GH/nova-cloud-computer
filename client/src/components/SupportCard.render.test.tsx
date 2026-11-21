// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import SupportCard from "./SupportCard";
import { SUPPORT_DISMISS_KEY, SUPPORT_URL } from "@/lib/support";

describe("SupportCard", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    window.localStorage.clear();
  });

  it("points at the Buy Me a Coffee page in a new tab", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<SupportCard />);
    });
    const anchor = container.querySelector(
      '[data-testid="support-card"] a'
    ) as HTMLAnchorElement | null;
    expect(anchor?.getAttribute("href")).toBe(SUPPORT_URL);
    expect(anchor?.getAttribute("href")).toContain("buymeacoffee.com/");
    expect(anchor?.target).toBe("_blank");
    expect(anchor?.rel).toContain("noreferrer");
    expect(container.textContent).toContain("Buy us a coffee");
    expect(container.textContent).toContain("Opus 5.5");
  });

  it("hides itself after dismiss and remembers that per browser", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<SupportCard />);
    });
    const dismiss = container.querySelector(
      'button[aria-label="Dismiss"]'
    ) as HTMLButtonElement | null;
    expect(dismiss).not.toBeNull();
    act(() => {
      dismiss?.click();
    });
    expect(container.querySelector('[data-testid="support-card"]')).toBeNull();
    expect(window.localStorage.getItem(SUPPORT_DISMISS_KEY)).toBe("1");
  });

  it("starts hidden when the dismissal was already stored", () => {
    window.localStorage.setItem(SUPPORT_DISMISS_KEY, "1");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<SupportCard />);
    });
    // The storage read happens after mount, so one flush settles it.
    act(() => {
      Promise.resolve();
    });
    expect(container.querySelector('[data-testid="support-card"]')).toBeNull();
  });
});
