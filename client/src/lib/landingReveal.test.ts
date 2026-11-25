// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REVEALED_CLASS,
  REVEAL_READY_CLASS,
  initLandingReveals,
  isStaticPage,
  revealDelay,
} from "./landingReveal";

type FakeObserver = {
  cb: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  targets: Element[];
  disconnect: ReturnType<typeof vi.fn>;
  fire: (target: Element, isIntersecting: boolean) => void;
};

const observers: FakeObserver[] = [];

function installObserver() {
  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly scrollMargin = "0px";
    readonly thresholds = [0];
    targets: Element[] = [];
    disconnect = vi.fn();
    unobserve = vi.fn(() => {});
    takeRecords = vi.fn(() => []);
    observe = vi.fn((target: Element) => this.targets.push(target));
    private record: FakeObserver;
    constructor(
      public cb: IntersectionObserverCallback,
      public options?: IntersectionObserverInit
    ) {
      this.record = {
        cb,
        options,
        targets: this.targets,
        disconnect: this.disconnect,
        fire: (target, isIntersecting) =>
          cb(
            [{ target, isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          ),
      };
      observers.push(this.record);
    }
  }
  Object.defineProperty(window, "IntersectionObserver", {
    configurable: true,
    value: FakeIntersectionObserver,
  });
}

function markup() {
  document.body.innerHTML = `
    <div id="shell">
      <div data-reveal id="above"></div>
      <p data-reveal id="below"></p>
      <ul data-reveal-group id="group">
        <li id="c1"></li><li id="c2"></li><li id="c3"></li><li id="c4"></li><li id="c5"></li><li id="c6"></li>
      </ul>
    </div>`;
  const above = document.getElementById("above")!;
  const below = document.getElementById("below")!;
  vi.spyOn(above, "getBoundingClientRect").mockReturnValue({
    top: 100,
  } as DOMRect);
  vi.spyOn(below, "getBoundingClientRect").mockReturnValue({
    top: 2000,
  } as DOMRect);
  document.querySelectorAll("#group > *").forEach(child => {
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({
      top: 2000,
    } as DOMRect);
  });
}

beforeEach(() => {
  observers.length = 0;
  document.documentElement.className = "";
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  installObserver();
  markup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("landing reveals", () => {
  it("staggers siblings at 70ms and caps the delay", () => {
    expect(revealDelay(0)).toBe(0);
    expect(revealDelay(2)).toBe(140);
    expect(revealDelay(50)).toBe(280);
  });

  it("treats ?static as an explicit opt-out", () => {
    expect(isStaticPage("")).toBe(false);
    expect(isStaticPage("?static")).toBe(true);
    expect(isStaticPage("?x=1&static")).toBe(true);
  });

  it("keeps above-fold content visible and reveals the rest on intersection", () => {
    const cleanup = initLandingReveals(document, window);
    const above = document.getElementById("above")!;
    const below = document.getElementById("below")!;

    expect(above.classList.contains(REVEALED_CLASS)).toBe(true);
    expect(below.classList.contains(REVEALED_CLASS)).toBe(false);
    expect(document.documentElement.classList.contains(REVEAL_READY_CLASS)).toBe(true);
    expect(observers.length).toBe(1); // one observer for the whole page
    expect(observers[0].options?.rootMargin).toBe("0px 0px -12% 0px");
    expect(observers[0].targets.length).toBe(8); // 2 singles + 6 group children

    observers[0].fire(below, true);
    expect(below.classList.contains(REVEALED_CLASS)).toBe(true);

    const cards = document.querySelectorAll("#group > *");
    expect((cards[0] as HTMLElement).style.getPropertyValue("--reveal-delay")).toBe("0ms");
    expect((cards[3] as HTMLElement).style.getPropertyValue("--reveal-delay")).toBe("210ms");
    expect((cards[5] as HTMLElement).style.getPropertyValue("--reveal-delay")).toBe("280ms");

    cleanup();
    expect(document.documentElement.classList.contains(REVEAL_READY_CLASS)).toBe(false);
    expect(below.classList.contains(REVEALED_CLASS)).toBe(false);
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it("does nothing at all under reduced motion", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    initLandingReveals(document, window);
    expect(document.documentElement.classList.contains(REVEAL_READY_CLASS)).toBe(false);
    expect(observers.length).toBe(0);
  });

  it("does nothing at all with ?static", () => {
    window.history.replaceState({}, "", "/?static");
    initLandingReveals(document, window);
    expect(document.documentElement.classList.contains(REVEAL_READY_CLASS)).toBe(false);
    expect(observers.length).toBe(0);
  });

  it("reveals everything when IntersectionObserver is unavailable", () => {
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    initLandingReveals(document, window);
    const targets = document.querySelectorAll<HTMLElement>("#shell [data-reveal], #group > *");
    expect(targets.length).toBeGreaterThan(0);
    targets.forEach(target =>
      expect(target.classList.contains(REVEALED_CLASS)).toBe(true)
    );
  });
});
