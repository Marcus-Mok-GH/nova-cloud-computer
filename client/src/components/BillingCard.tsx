import React, { useEffect, useRef, useState } from "react";
import { Check, CreditCard, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/** One priority window is one hour; the countdown bar is scaled against this. */
const PRIORITY_DURATION_MS = 60 * 60 * 1000;

/** Renders remaining time as MM:SS, or H:MM:SS once it is an hour or more. */
export function formatPriorityRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Ticks the millisecond count remaining until `expiresAtMs`, once a second, so
 * the card can show a live countdown. Returns null when there is no expiry.
 */
function usePriorityCountdown(expiresAtMs: number | null): number | null {
  const [remainingMs, setRemainingMs] = useState<number | null>(() =>
    expiresAtMs === null ? null : Math.max(0, expiresAtMs - Date.now())
  );
  useEffect(() => {
    if (expiresAtMs === null) {
      setRemainingMs(null);
      return;
    }
    const tick = () => setRemainingMs(Math.max(0, expiresAtMs - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAtMs]);
  return remainingMs;
}

/**
 * Billing tab: a one-time purchase of priority queue placement. Payment is
 * intentionally bypassed while the tier is under test - the button records the
 * purchase directly, and the card shows a live countdown of the one-hour
 * window so it is obvious how much priority time is left. When it lapses the
 * account returns to standard placement and can buy again.
 */
export default function BillingCard() {
  const utils = trpc.useUtils();
  const { t, locale } = useTranslation();
  const status = trpc.billing.status.useQuery(undefined, { retry: false });
  const purchase = trpc.billing.purchasePriority.useMutation({
    onSuccess: async result => {
      await utils.billing.status.invalidate();
      if (result.armed) {
        toast.success(t("settings.billing.buy.success"));
      } else {
        toast.error(t("settings.billing.buy.error"));
      }
    },
    onError: error =>
      toast.error(error.message || t("settings.billing.buy.error")),
  });
  const priority = status.data?.priority ?? false;
  const armed = status.data?.armed ?? false;
  const expiresAt = status.data?.expiresAt ? new Date(status.data.expiresAt) : null;
  const expiresAtMs = expiresAt ? expiresAt.getTime() : null;
  const expiresLabel = expiresAt
    ? expiresAt.toLocaleString(locale, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const remainingMs = usePriorityCountdown(expiresAtMs);
  // The server still reports priority until the next refetch, so the live
  // countdown is authoritative: the moment it reaches zero the card steps back
  // to standard and offers the button again.
  const active = priority && remainingMs !== null && remainingMs > 0;
  const refetchedOnExpiry = useRef(false);
  useEffect(() => {
    if (!priority) {
      refetchedOnExpiry.current = false;
      return;
    }
    if (remainingMs === 0 && !refetchedOnExpiry.current) {
      refetchedOnExpiry.current = true;
      void status.refetch();
    }
  }, [priority, remainingMs, status]);
  const progress = remainingMs === null ? 0 : Math.min(100, Math.max(0, (remainingMs / PRIORITY_DURATION_MS) * 100));
  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
            {t("settings.billing.eyebrow")}
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.billing.title")}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("settings.billing.body")}
          </p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          <CreditCard size={24} />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-muted/20 p-5">
        <div>
          <p className="text-sm font-bold">{t("settings.billing.priority.title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {active
              ? expiresLabel
                ? t("settings.billing.priority.activeUntil", { remaining: formatPriorityRemaining(remainingMs!), until: expiresLabel })
                : t("settings.billing.priority.active", { remaining: formatPriorityRemaining(remainingMs!) })
              : armed
                ? t("settings.billing.priority.armed")
                : t("settings.billing.priority.inactive")}
          </p>
          {active && (
            <div
              data-testid="priority-countdown"
              role="progressbar"
              aria-label={t("settings.billing.countdown.aria")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              className="mt-3 h-1.5 w-44 max-w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-1000 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        {active ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold tabular-nums text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Check size={14} /> {t("settings.billing.badge.active", { remaining: formatPriorityRemaining(remainingMs!) })}
          </span>
        ) : armed ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            <Sparkles size={14} /> {t("settings.billing.badge.armed")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground">
            {t("settings.billing.badge.standard")}
          </span>
        )}
      </div>

      {!active && !armed && (
        <div className="mt-4 rounded-2xl border bg-muted/20 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <p className="text-sm font-bold">{t("settings.billing.buy.title")}</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("settings.billing.buy.body")}
          </p>
          <Button
            className="mt-4"
            onClick={() => purchase.mutate()}
            disabled={purchase.isPending || status.isLoading}
          >
            {purchase.isPending && <Loader2 className="animate-spin" size={15} />}
            {t("settings.billing.buy.button")}
          </Button>
        </div>
      )}
    </section>
  );
}
