/**
 * Pin the conversation to its newest row.
 *
 * The chat viewport is normally the scroll container, but on narrow/mobile
 * layouts the browser can end up scrolling the document instead. A pin that
 * only writes to the viewport then silently does nothing and the run sits at
 * the top of the chat. Fall back to the document scroller in that case.
 */
export function pinChatToBottom(
  viewport: HTMLElement | null,
  documentScroller: HTMLElement | null = null
): void {
  if (!viewport) return;
  viewport.scrollTop = viewport.scrollHeight;
  if (viewport.scrollHeight <= viewport.clientHeight + 1 && documentScroller) {
    documentScroller.scrollTop = documentScroller.scrollHeight;
  }
}
