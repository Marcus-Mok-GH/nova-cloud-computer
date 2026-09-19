/**
 * Nova logo - the warm-portal brand mark served from the app's own
 * public assets so the brand never depends on a remote image.
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
  return (
    <img
      src="/logo-96.png"
      alt={ariaHidden ? "" : "Nova logo"}
      width={size}
      height={size}
      style={{ borderRadius: Math.max(2, Math.round(size * 0.26)) }}
      className={className}
      loading="eager"
      draggable={false}
    />
  );
}
