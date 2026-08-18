/**
 * Nova mark — a four-point "nova" starburst rendered inline so the
 * brand mark never depends on a remote image.
 */
import React from "react";

export default function NovaMark({
  size = 24,
  className = "",
  ariaHidden = true,
}: {
  size?: number;
  className?: string;
  ariaHidden?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={ariaHidden}
      focusable="false"
    >
      <path
        d="M12 1.5C12.9 6.6 14.2 9.8 17.2 11.2C14.2 12.6 12.9 15.8 12 20.9C11.1 15.8 9.8 12.6 6.8 11.2C9.8 9.8 11.1 6.6 12 1.5Z"
        fill="#f97316"
      />
      <circle cx="12" cy="11.2" r="2.4" fill="#fff" />
    </svg>
  );
}
