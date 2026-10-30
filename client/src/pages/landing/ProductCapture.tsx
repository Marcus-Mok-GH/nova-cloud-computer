import React from "react";
import { cn } from "@/lib/utils";

/**
 * Screens captured from Nova's workspace, chat, file editor, and automation
 * components. The raster captures use fictional demo data, never account data.
 */
export default function ProductCapture({
  src,
  alt,
  label,
  loading = "lazy",
  className,
}: {
  src: string;
  alt: string;
  label: string;
  loading?: "eager" | "lazy";
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card shadow-[0_8px_24px_-18px_rgba(55,35,20,0.28)] sm:rounded-xl",
        className
      )}
    >
      <figcaption className="border-b border-border bg-card px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </figcaption>
      <img
        src={src}
        alt={alt}
        width={1100}
        height={760}
        className="block h-auto w-full"
        loading={loading}
        decoding="async"
      />
    </figure>
  );
}
