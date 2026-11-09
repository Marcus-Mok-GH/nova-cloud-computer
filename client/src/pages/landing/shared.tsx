import React from "react";
import { ArrowUpRight } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";

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

/** The page's two button shapes, shared by the nav and the hero. */
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
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const ghostClasses =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-4 py-3 text-sm font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Primary and ghost shapes for the page's call to action. */
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
