import React from "react";
import { Check, CreditCard, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * Billing tab: a one-time purchase of priority queue placement. Payment is
 * intentionally bypassed while the tier is under test - the button records the
 * purchase directly - and the entitlement is permanent, so there is no
 * downgrade, renewal, or expiry.
 */
export default function BillingCard() {
  const utils = trpc.useUtils();
  const status = trpc.billing.status.useQuery(undefined, { retry: false });
  const purchase = trpc.billing.purchasePriority.useMutation({
    onSuccess: async result => {
      await utils.billing.status.invalidate();
      if (result.priority) {
        toast.success(
          result.purchasedAt
            ? "Priority purchased. Your requests now skip ahead during peak hours."
            : "Priority purchased."
        );
      } else {
        toast.error("Nova could not record that purchase.");
      }
    },
    onError: error =>
      toast.error(error.message || "Nova could not record that purchase."),
  });
  const priority = status.data?.priority ?? false;
  const purchasedAt = status.data?.purchasedAt
    ? new Date(status.data.purchasedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;
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
            purchase of priority moves your requests ahead of standard ones from
            then on - whenever you bought it, and whether or not peak hours are
            active at the time.
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
            {priority
              ? purchasedAt
                ? `Purchased on ${purchasedAt}. Your requests are served first during peak hours.`
                : "Purchased. Your requests are served first during peak hours."
              : "Not purchased yet - your requests join the queue in arrival order."}
          </p>
        </div>
        {priority ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Check size={14} /> Priority active
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground">
            Standard
          </span>
        )}
      </div>

      {!priority && (
        <div className="mt-4 rounded-2xl border bg-muted/20 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <p className="text-sm font-bold">Buy priority (one-time)</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Testing mode: payment is disabled, so clicking the button records the
            purchase immediately. It is a one-time buy - there is nothing to
            renew or cancel.
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
