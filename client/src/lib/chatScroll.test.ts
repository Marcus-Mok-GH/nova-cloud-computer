// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { pinChatToBottom } from "./chatScroll";

function elementWith(height: number, client: number): HTMLElement {
  const el = document.createElement("div");
  let scrollTop = 0;
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => client });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: value => { scrollTop = value; },
  });
  return el;
}

describe("pinChatToBottom", () => {
  it("scrolls the chat viewport when it is the scroll container", () => {
    const viewport = elementWith(2400, 600);
    const documentScroller = elementWith(800, 600);
    pinChatToBottom(viewport, documentScroller);
    expect(viewport.scrollTop).toBe(2400);
    expect(documentScroller.scrollTop).toBe(0);
  });

  it("falls back to the document when the viewport is not scrollable", () => {
    const viewport = elementWith(600, 600);
    const documentScroller = elementWith(5000, 600);
    pinChatToBottom(viewport, documentScroller);
    expect(documentScroller.scrollTop).toBe(5000);
  });

  it("is a no-op without a viewport", () => {
    expect(() => pinChatToBottom(null, elementWith(100, 50))).not.toThrow();
  });
});
