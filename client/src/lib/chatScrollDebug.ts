/** Temporary diagnostics for the "run sits at the top of the chat" report. */
export type ScrollDebugEntry = {
  time: string;
  kind: string;
  detail: string;
};

export function isScrollDebug(): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("scrollDebug")
  );
}

export function formatScrollEntry(kind: string, detail: string): ScrollDebugEntry {
  return { time: new Date().toISOString().slice(11, 23), kind, detail };
}

export function scrollMetrics(el: HTMLElement): string {
  return `top=${Math.round(el.scrollTop)} height=${Math.round(el.scrollHeight)} client=${Math.round(el.clientHeight)}`;
}

/**
 * Wraps the viewport's scrollTop setter and records every scroll event in the
 * document. Returns a cleanup that restores the element's own property.
 */
export function installScrollDebug(
  viewport: HTMLElement,
  getScrolledUp: () => boolean,
  push: (entry: ScrollDebugEntry) => void
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollTop"
  );
  if (!descriptor?.get || !descriptor?.set) return () => {};

  const describe = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el?.tagName) return "?";
    const cls = typeof el.className === "string" ? el.className.slice(0, 34) : "";
    return `${el.tagName.toLowerCase()}.${cls}`;
  };

  const metrics = (el: HTMLElement) =>
    `${scrollMetrics(el)} up=${getScrolledUp()}`;

  Object.defineProperty(viewport, "scrollTop", {
    configurable: true,
    get: () => descriptor.get!.call(viewport) as number,
    set: (value: number) => {
      push(formatScrollEntry("WRITE", `${describe(viewport)} → ${Math.round(value)} | ${metrics(viewport)}`));
      descriptor.set!.call(viewport, value);
    },
  });

  const onScroll = (event: Event) => {
    const el = event.target as HTMLElement;
    if (!el?.tagName) return;
    push(formatScrollEntry("SCROLL", `${describe(el)} | ${metrics(el)}`));
  };
  viewport.addEventListener("scroll", onScroll, true);
  document.addEventListener("scroll", onScroll, true);

  return () => {
    viewport.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("scroll", onScroll, true);
    delete (viewport as { scrollTop?: number }).scrollTop;
  };
}
