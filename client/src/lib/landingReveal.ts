/**
 * Scroll reveals for the public landing page. Framework-free so it can be
 * tested without React: one observer for the whole page, no per-element
 * listeners, and no motion at all when the visitor opted out.
 */
export const REVEAL_READY_CLASS = "reveals-ready";
export const REVEALED_CLASS = "is-revealed";
export const REVEAL_SELECTOR = "[data-reveal], [data-reveal-group] > *";

export function revealDelay(index: number): number {
  return Math.min(Math.max(index, 0), 4) * 70;
}

export function isStaticPage(search: string): boolean {
  return new URLSearchParams(search).has("static");
}

export function prefersReducedMotion(win: Window): boolean {
  return win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function collectRevealTargets(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
}

type RevealWindow = Window & {
  IntersectionObserver?: new (
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) => IntersectionObserver;
};

/**
 * Installs the reveals. Returns a cleanup that removes every side effect, so
 * a remount (or a test) cannot leave the page with hidden elements.
 */
export function initLandingReveals(
  root: ParentNode = document,
  win: RevealWindow = window as RevealWindow
): () => void {
  if (prefersReducedMotion(win) || isStaticPage(win.location.search)) {
    return () => {};
  }

  const targets = collectRevealTargets(root);
  if (!targets.length) return () => {};

  root.querySelectorAll("[data-reveal-group]").forEach(group => {
    Array.from(group.children).forEach((child, index) => {
      (child as HTMLElement).style.setProperty(
        "--reveal-delay",
        `${revealDelay(index)}ms`
      );
    });
  });

  // Anything already in (or near) the viewport must be opaque at first paint.
  // Never hide above-the-fold copy on the theory that a scroll will happen.
  const fold = win.innerHeight * 0.88;
  targets.forEach(target => {
    if (target.getBoundingClientRect().top < fold) {
      target.classList.add(REVEALED_CLASS);
    }
  });

  const Observer = win.IntersectionObserver;
  if (typeof Observer !== "function") {
    targets.forEach(target => target.classList.add(REVEALED_CLASS));
    return () => {};
  }

  win.document.documentElement.classList.add(REVEAL_READY_CLASS);
  const observer = new Observer(
    entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        (entry.target as HTMLElement).classList.add(REVEALED_CLASS);
        observer.unobserve(entry.target);
      });
    },
    // Reveal as the element crosses 88% of the viewport, not on full
    // intersection — by then the reader is already looking at it.
    { rootMargin: "0px 0px -12% 0px", threshold: 0 }
  );
  targets.forEach(target => observer.observe(target));

  // No timer: a visitor who never scrolls should still see the sections they
  // have not reached in their finished state when they do get there. The
  // no-script fallback is the absence of `reveals-ready` in the CSS; there is
  // nothing to time out here.

  return () => {
    observer.disconnect();
    win.document.documentElement.classList.remove(REVEAL_READY_CLASS);
    targets.forEach(target => {
      target.classList.remove(REVEALED_CLASS);
      target.style.removeProperty("--reveal-delay");
    });
  };
}
