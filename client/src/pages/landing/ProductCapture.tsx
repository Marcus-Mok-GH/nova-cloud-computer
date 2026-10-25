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
        "overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_72px_-34px_rgba(55,35,20,0.38)] sm:rounded-[1.5rem]",
        className
      )}
    >
      <figcaption className="border-b border-border bg-surface px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
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
