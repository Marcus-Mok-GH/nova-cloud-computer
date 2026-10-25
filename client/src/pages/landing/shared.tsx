import React from "react";
import { ArrowUpRight } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/i18n";

/** Anchors shared by the sticky nav and the footer's Product column. */
export const landingAnchors: ReadonlyArray<{
  href: string;
  key: TranslationKey;
}> = [
  { href: "#product", key: "landing.nav.product" },
  { href: "#how-it-works", key: "landing.nav.how" },
  { href: "#channels", key: "landing.nav.channels" },
  { href: "#pricing", key: "landing.nav.pricing" },
  { href: "#faq", key: "landing.nav.faq" },
];

/**
 * The single sign-in / open-workspace action every CTA shares. Signed-in
 * visitors go straight to /app; everyone else through sign-in.
 */
export function useEnterNova() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  return {
    isAuthenticated,
    enterNova: () => setLocation(isAuthenticated ? "/app" : "/sign-in"),
  };
}

/** Small uppercase label that opens every section. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-xs font-bold uppercase tracking-[0.14em] text-primary",
        className
      )}
    >
      {children}
    </p>
  );
}

interface CtaButtonProps {
  /** Resolved label (the caller picks the signed-in vs signed-out copy). */
  label: string;
  /** "primary" carries the accent; "ghost" stays quiet. */
  variant?: "primary" | "ghost";
  /** Renders an anchor when set, a button otherwise. */
  href?: string;
  onClick?: () => void;
  /** Trailing icon; defaults to an arrow for primary CTAs, nothing for ghost. */
  icon?: React.ReactNode | null;
  className?: string;
}

const primaryClasses =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:-translate-y-0.5 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const ghostClasses =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The page's two button shapes, shared by the nav, hero, pricing, and footer. */
export function CtaButton({
  label,
  variant = "primary",
  href,
  onClick,
  icon,
  className,
}: CtaButtonProps) {
  const classes = cn(
    variant === "primary" ? primaryClasses : ghostClasses,
    className
  );
  const iconNode =
    icon === undefined ? (
      variant === "primary" ? (
        <ArrowUpRight className="size-4" />
      ) : null
    ) : (
      icon
    );
  const content = (
    <>
      {label}
      {iconNode}
    </>
  );
  if (href) {
    return (
      <a href={href} className={classes}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
}
