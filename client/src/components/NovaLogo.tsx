/**
 * Nova logo - the warm-portal brand mark served from the app's own
 * public assets so the brand never depends on a remote image.
 *
 * The brand kit ships two marks: the light-surface mark (`logo-96.png`)
 * and the dark-surface mark (`logo-dark-96.png`). We render both and let
 * CSS pick one, so the correct mark appears from first paint and keeps
 * following the theme without a React re-render.
 */
import React from "react";

export default function NovaLogo({
  size = 24,
  className = "",
  ariaHidden = true,
}: {
  size?: number;
  className?: string;
  ariaHidden?: boolean;
}) {
  const shared = {
    width: size,
    height: size,
    style: { borderRadius: Math.max(2, Math.round(size * 0.26)) },
    loading: "eager" as const,
    draggable: false,
    alt: ariaHidden ? "" : "Nova logo",
    "aria-hidden": ariaHidden || undefined,
  };

  return (
    <>
      <img
        {...shared}
        src="/logo-96.png"
        className={`${className} dark:hidden`.trim()}
      />
      <img
        {...shared}
        src="/logo-dark-96.png"
        className={`${className} hidden dark:block`.trim()}
      />
    </>
  );
}