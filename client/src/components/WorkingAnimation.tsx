import React, { useEffect, useRef } from "react";

/**
 * The approved Nova "Breath" animation, drawn live on a canvas instead of
 * shipped as a video: transparent ground so it sits on any theme's palette,
 * brand tokens only (they live in `:root` and are identical across themes),
 * and no asset weight. Used where the AI is working (the thinking and live
 * activity spinners).
 *
 * The geometry mirrors the rendered preview exactly: sine harmonics on the
 * outline, a slow breath + squash + drift, sunrise halo, and a white-gold
 * core light that swells twice per 3.0s loop.
 */

/** Warm ember mid-field (between --nova-glow and --nova-ember-strong). */
const MID = [228, 132, 76];
/** --nova-ember-strong: the blob's rim. */
const EMBER_STRONG = [184, 78, 30];
/** --nova-glow */
const GLOW = [255, 217, 184];
/** The brand icon's warm white-gold central light. */
const CORE = [255, 246, 230];
/** --nova-sunrise: the halo. */
const SUNRISE = [240, 138, 60];

const LOOP_MS = 3000;

const rgba = (rgb: number[], alpha: number) =>
  `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

const mix = (a: number[], b: number[], t: number): number[] =>
  a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));

export interface WorkingBlobFrame {
  /** Loop phase in [0, 1). */
  phase: number;
  /** Motion multiplier; tiny canvases exaggerate so the breath stays visible. */
  amplitude?: number;
}

/** Draw one frame of the working blob into a `size` x `size` CSS-pixel box. */
export function drawWorkingBlob(
  ctx: CanvasRenderingContext2D,
  size: number,
  { phase, amplitude = 1 }: WorkingBlobFrame
): void {
  const p = ((phase % 1) + 1) % 1;
  const ang = 2 * Math.PI * p;
  const cx = size / 2 + 0.006 * size * Math.sin(ang) * amplitude;
  const cy = size / 2 + 0.006 * size * Math.sin(ang + 1.3) * amplitude;
  const breath = 1 + 0.05 * Math.sin(ang) * amplitude;
  const squash = 1 + 0.03 * Math.sin(ang + Math.PI / 2) * amplitude;
  const r = 0.235 * size * breath;
  // Core ignition: two swells per loop, matching the 1.2s typing-dot feel.
  const ignite = 0.5 + 0.5 * Math.sin(4 * Math.PI * p);

  ctx.clearRect(0, 0, size, size);

  // sunrise halo
  const halo = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.95);
  halo.addColorStop(0, rgba(SUNRISE, 0.15 + 0.05 * Math.sin(ang)));
  halo.addColorStop(1, rgba(SUNRISE, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // organic body: sine harmonics identical to the rendered video
  ctx.beginPath();
  const steps = 120;
  for (let k = 0; k <= steps; k++) {
    const th = (2 * Math.PI * k) / steps;
    const rad =
      r *
      (1 +
        0.055 * Math.sin(3 * th + ang) +
        0.042 * Math.sin(5 * th - 2 * ang + 1.7) +
        0.028 * Math.sin(2 * th + ang + 3.1));
    const x = cx + Math.cos(th) * rad * squash;
    const y = cy + (Math.sin(th) * rad) / squash;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.08);
  body.addColorStop(0, rgba(MID, 1));
  body.addColorStop(0.7, rgba(mix(MID, EMBER_STRONG, 0.55), 1));
  body.addColorStop(1, rgba(EMBER_STRONG, 1));
  ctx.fillStyle = body;
  ctx.fill();

  // white-gold core light
  const coreR = r * 0.62;
  const coreColor = mix(GLOW, CORE, 0.6 * ignite);
  const coreAlpha = 0.78 + 0.22 * ignite;
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  core.addColorStop(0, rgba(coreColor, coreAlpha));
  core.addColorStop(0.45, rgba(coreColor, coreAlpha * 0.45));
  core.addColorStop(1, rgba(coreColor, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Animated working indicator. Decorative (aria-hidden); callers pair it with
 * their own status text. Honors prefers-reduced-motion by drawing a single
 * still frame.
 */
export function WorkingAnimation({
  size = 14,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Size the backing store after mount only: the SSR/initial markup carries
    // plain pixel attributes, so hydration never mismatches on devicePixelRatio.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.scale(dpr, dpr);
    const amplitude = size < 24 ? 1.8 : 1;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      drawWorkingBlob(ctx, size, { phase: 0, amplitude });
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      drawWorkingBlob(ctx, size, {
        phase: ((now - start) % LOOP_MS) / LOOP_MS,
        amplitude,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas
      ref={ref}
      data-testid="working-animation"
      aria-hidden="true"
      className={`shrink-0 align-middle ${className ?? ""}`}
      width={size}
      height={size}
    />
  );
}
