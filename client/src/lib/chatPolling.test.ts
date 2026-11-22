import { describe, expect, it } from "vitest";
import { messagesIntervalMs, runStatusIntervalMs } from "./chatPolling";

describe("chat polling cadence", () => {
  it("keeps the fast cadence while a queued turn can still be working", () => {
    // A queued turn has no live run row yet; if the cadence drops to idle here,
    // a short reply lands with no invalidation and the view looks stuck until
    // a manual refresh.
    expect(runStatusIntervalMs({ active: false, queued: true })).toBe(3_000);
    expect(messagesIntervalMs({ active: false, streaming: false, queued: true })).toBe(5_000);
  });

  it("keeps the fast cadence during a live run or an owned stream", () => {
    expect(runStatusIntervalMs({ active: true, queued: false })).toBe(3_000);
    expect(messagesIntervalMs({ active: true, streaming: false, queued: false })).toBe(5_000);
    expect(messagesIntervalMs({ active: false, streaming: true, queued: false })).toBe(5_000);
  });

  it("falls back to the slow idle cadence only when nothing can be working", () => {
    expect(runStatusIntervalMs({ active: false, queued: false })).toBe(30_000);
    expect(messagesIntervalMs({ active: false, streaming: false, queued: false })).toBe(30_000);
  });
});
