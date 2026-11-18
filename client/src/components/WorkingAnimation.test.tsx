// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkingAnimation, drawWorkingBlob } from "./WorkingAnimation";

interface FakeGradient {
  stops: Array<[number, string]>;
  addColorStop(offset: number, color: string): void;
}

interface FakeCtx {
  ctx: CanvasRenderingContext2D & { points: Array<[number, number]> };
  state: { clearRect: number; lineTo: number; fill: number };
  gradients: FakeGradient[];
}

function fakeCtx(): FakeCtx {
  const gradients: FakeGradient[] = [];
  const state = { clearRect: 0, lineTo: 0, fill: 0 };
  const gradient = (): FakeGradient => {
    const g: FakeGradient = {
      stops: [],
      addColorStop(offset: number, color: string) {
        g.stops.push([offset, color]);
      },
    };
    gradients.push(g);
    return g;
  };
  const points: Array<[number, number]> = [];
  const ctx = {
    clearRect() {
      state.clearRect += 1;
    },
    beginPath() {},
    moveTo(x: number, y: number) {
      points.push([x, y]);
    },
    lineTo(x: number, y: number) {
      state.lineTo += 1;
      points.push([x, y]);
    },
    closePath() {},
    arc() {},
    fill() {
      state.fill += 1;
    },
    fillRect() {},
    createRadialGradient: gradient,
    scale() {},
  } as unknown as CanvasRenderingContext2D;
  return {
    ctx: Object.assign(ctx, { state, gradients, points }),
    state,
    gradients,
  };
}

describe("drawWorkingBlob", () => {
  it("builds the organic body from sine harmonics and moves with the phase", () => {
    const a = fakeCtx();
    drawWorkingBlob(a.ctx, 64, { phase: 0 });
    const b = fakeCtx();
    drawWorkingBlob(b.ctx, 64, { phase: 0.37 });

    // halo + body + core gradients, the 120-step outline, and the fills
    expect(a.gradients.length).toBe(3);
    expect(a.state.lineTo).toBe(120);
    expect(a.state.clearRect).toBe(1);
    expect(a.state.fill).toBeGreaterThanOrEqual(2);

    // the outline really differs between phases (it is animated, not static)
    const pa = a.ctx.points as Array<[number, number]>;
    const pb = b.ctx.points as Array<[number, number]>;
    const moved = pa.filter(([x], i) => Math.abs(x - pb[i][0]) > 0.01);
    expect(moved.length).toBeGreaterThan(10);
  });

  it("paints the brand palette: ember rim, sunrise halo, warm core", () => {
    const { ctx, gradients } = fakeCtx();
    // phase 0.125 = the core's full ignition swell
    drawWorkingBlob(ctx, 64, { phase: 0.125 });
    const all = gradients.flatMap(g => g.stops.map(([, c]) => c)).join("|");
    expect(all).toContain("184, 78, 30"); // --nova-ember-strong rim
    expect(all).toContain("240, 138, 60"); // --nova-sunrise halo
    expect(all).toContain("255, 234, 212"); // white-gold core at full swell
  });
});

describe("WorkingAnimation", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;
  let queue: Array<(now: number) => void>;
  let drawn: FakeCtx["state"] | undefined;

  beforeEach(() => {
    queue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => number) => {
      queue.push(cb as (now: number) => void);
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
    } as MediaQueryList);
    const fake = fakeCtx();
    drawn = fake.state;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      fake.ctx
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    drawn = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function flush(now: number) {
    const batch = queue.splice(0, queue.length);
    for (const cb of batch) cb(now);
  }

  it("animates: each flushed frame draws and the loop re-queues", async () => {
    await act(async () => {
      root?.render(<WorkingAnimation size={16} />);
    });
    expect(
      container?.querySelector('[data-testid="working-animation"]')
    ).not.toBeNull();
    await act(async () => flush(0));
    await act(async () => flush(500));
    // two frames drawn; exactly one callback waits for the next
    expect(drawn?.clearRect).toBe(2);
    expect(queue.length).toBe(1);
  });

  it("draws a single still frame under prefers-reduced-motion", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    await act(async () => {
      root?.render(<WorkingAnimation size={16} />);
    });
    // one immediate frame, and nothing queued for animation
    expect(drawn?.clearRect).toBe(1);
    expect(queue.length).toBe(0);
  });

  it("pins the CSS size so a devicePixelRatio-scaled backing store cannot resize it", async () => {
    await act(async () => {
      root?.render(<WorkingAnimation size={16} />);
    });
    const canvas = container?.querySelector(
      '[data-testid="working-animation"]'
    ) as HTMLCanvasElement | null;
    // The backing store is dpr-scaled (here 1x in jsdom); the element must
    // still lay out at exactly `size` CSS px, or the blob shrinks on retina.
    expect(canvas?.style.width).toBe("16px");
    expect(canvas?.style.height).toBe("16px");
  });
});
