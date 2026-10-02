import React, { useEffect, useRef, useState } from "react";
import { Check, CreditCard, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const status = trpc.billing.status.useQuery(undefined, { retry: false });
  const purchase = trpc.billing.purchasePriority.useMutation({
    onSuccess: async result => {
      await utils.billing.status.invalidate();
      if (result.armed) {
        toast.success("Priority purchased. Your hour starts with your next message.");
      } else {
        toast.error("Nova could not record that purchase.");
      }
    },
    onError: error =>
      toast.error(error.message || "Nova could not record that purchase."),
  });
  const priority = status.data?.priority ?? false;
  const armed = status.data?.armed ?? false;
  const expiresAt = status.data?.expiresAt ? new Date(status.data.expiresAt) : null;
  const expiresAtMs = expiresAt ? expiresAt.getTime() : null;
  const expiresLabel = expiresAt
    ? expiresAt.toLocaleString(undefined, {
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
            Billing
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">Priority requests</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            During peak hours Nova serves requests through a queue. A one-time
            purchase of priority moves your requests ahead of standard ones for
            one hour, counting from the first message you send afterwards.
          </p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          <CreditCard size={24} />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-muted/20 p-5">
        <div>
          <p className="text-sm font-bold">Priority</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {active
              ? expiresLabel
                ? `Priority active for another ${formatPriorityRemaining(remainingMs!)} (until ${expiresLabel}). Your requests are served first during peak hours.`
                : `Priority active for another ${formatPriorityRemaining(remainingMs!)}. Your requests are served first during peak hours.`
              : armed
                ? "Priority armed - the one-hour countdown starts with your next message."
                : "Not active - your requests join the queue in arrival order."}
          </p>
          {active && (
            <div
              data-testid="priority-countdown"
              role="progressbar"
              aria-label="Remaining priority time"
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
            <Check size={14} /> Priority active · {formatPriorityRemaining(remainingMs!)}
          </span>
        ) : armed ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            <Sparkles size={14} /> Armed
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground">
            Standard
          </span>
        )}
      </div>

      {!active && !armed && (
        <div className="mt-4 rounded-2xl border bg-muted/20 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <p className="text-sm font-bold">Buy 1 hour of priority</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Testing mode: payment is disabled, so clicking the button records the
            purchase immediately. Your hour begins when you send your next
            message, and starts over each time you buy again.
          </p>
          <Button
            className="mt-4"
            onClick={() => purchase.mutate()}
            disabled={purchase.isPending || status.isLoading}
          >
            {purchase.isPending && <Loader2 className="animate-spin" size={15} />}
            Buy priority
          </Button>
        </div>
      )}
    </section>
  );
}
