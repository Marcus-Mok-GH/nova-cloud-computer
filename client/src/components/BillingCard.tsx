import React from "react";
import { Check, CreditCard, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * Billing tab. Priority is a paid tier, but payment is intentionally bypassed
 * while it is under test: the button flips the account's plan directly, which
 * makes its requests jump ahead of standard ones in the peak-hours queue.
 */
export default function BillingCard() {
  const utils = trpc.useUtils();
  const status = trpc.billing.status.useQuery(undefined, { retry: false });
  const setPriority = trpc.billing.setPriority.useMutation({
    onSuccess: async result => {
      await utils.billing.status.invalidate();
      toast.success(
        result.priority
          ? "You're on the priority plan - your requests now skip ahead during peak hours."
          : "You're back on the standard plan."
      );
    },
    onError: error =>
      toast.error(error.message || "Nova could not update your plan."),
  });
  const priority = status.data?.priority ?? false;
  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
            Billing
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">
            Priority requests
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            During peak hours Nova serves requests through a queue. Priority
            accounts are served ahead of standard ones, so their messages spend
            far less time waiting.
          </p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          <CreditCard size={24} />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-muted/20 p-5">
        <div>
          <p className="text-sm font-bold">Current plan</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {priority
              ? "Priority - your requests are served first during peak hours."
              : "Standard - your requests join the queue in arrival order."}
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

      <div className="mt-4 rounded-2xl border bg-muted/20 p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <p className="text-sm font-bold">
            {priority ? "Leave the priority plan" : "Upgrade to priority"}
          </p>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {priority
            ? "Going back to standard returns your requests to arrival order in the peak-hours queue."
            : "Testing mode: payment is disabled, so clicking the button upgrades this account immediately."}
        </p>
        {priority ? (
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setPriority.mutate({ enabled: false })}
            disabled={setPriority.isPending || status.isLoading}
          >
            {setPriority.isPending && <Loader2 className="animate-spin" size={15} />}
            Switch to standard
          </Button>
        ) : (
          <Button
            className="mt-4"
            onClick={() => setPriority.mutate({ enabled: true })}
            disabled={setPriority.isPending || status.isLoading}
          >
            {setPriority.isPending && <Loader2 className="animate-spin" size={15} />}
            Upgrade to priority
          </Button>
        )}
      </div>
    </section>
  );
}
