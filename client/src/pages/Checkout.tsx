import React, { useEffect, useState } from "react";
import { Crown, CreditCard, Loader2, QrCode, Check } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type Product = "pro" | "priority";

function isProduct(value: string | null): value is Product {
  return value === "pro" || value === "priority";
}

export default function Checkout() {
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const product: Product = isProduct(params.get("product")) ? (params.get("product") as Product) : "pro";
  const statusParam = params.get("status");

  const [pendingMethod, setPendingMethod] = useState<"whop" | "hitpay" | null>(null);

  const whop = trpc.billing.createCheckout.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: error => {
      setPendingMethod(null);
      toast.error(error.message || "Could not open checkout.");
    },
  });

  const whopPriority = trpc.billing.purchasePriority.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: error => {
      setPendingMethod(null);
      toast.error(error.message || "Could not open checkout.");
    },
  });

  const hitpay = trpc.billing.createHitPayCheckout.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: error => {
      setPendingMethod(null);
      toast.error(error.message || "Could not open PayNow checkout.");
    },
  });

  useEffect(() => {
    if (statusParam === "success") toast.success("Payment received — your plan will activate once our server confirms it.");
    if (statusParam === "cancel" || statusParam === "cancelled" || statusParam === "failed") toast.error("Checkout was cancelled. No charge was made.");
  }, [statusParam]);

  const isPriority = product === "priority";
  const amount = isPriority ? "S$4.99" : "S$7.99";
  const period = isPriority ? "one-time" : "/ month";
  const title = isPriority ? "Nova Priority — 1 hour" : "Nova Pro — monthly";
  const description = isPriority
    ? "One hour of priority queue placement during peak hours. Starts with your next message."
    : "10,000 credits a month (unused roll over up to a year), every premium chat model, and your persistent workspace.";

  const cardBusy = pendingMethod === "whop" && (isPriority ? whopPriority.isPending : whop.isPending);
  const paynowBusy = pendingMethod === "hitpay" && hitpay.isPending;
  const anyBusy = cardBusy || paynowBusy;

  const chooseCard = () => {
    setPendingMethod("whop");
    const base = new URL(window.location.href);
    base.searchParams.delete("status");
    if (isPriority) {
      whopPriority.mutate({ redirectUrl: base.toString() });
    } else {
      whop.mutate({ redirectUrl: base.toString() });
    }
  };

  const choosePayNow = () => {
    setPendingMethod("hitpay");
    const base = new URL(window.location.href);
    base.searchParams.delete("status");
    hitpay.mutate({ product, redirectUrl: base.toString() });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-10">
        <div className="w-full rounded-2xl border bg-card p-6 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Checkout</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <div className="mt-4 flex items-end gap-1">
            <span className="text-3xl font-bold">{amount}</span>
            <span className="pb-1 text-sm text-muted-foreground">{period}</span>
          </div>

          <div className="mt-6 space-y-3">
            {/* PayNow via HitPay */}
            <button
              type="button"
              disabled={anyBusy}
              onClick={choosePayNow}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-primary/20 bg-primary/[0.04] p-4 text-left transition hover:border-primary/40 hover:bg-primary/[0.07] disabled:opacity-60"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <QrCode className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-bold">
                  PayNow QR <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Singapore</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">Scan with your banking app (DBS PayLah, UOB, etc.) via HitPay. {isPriority ? "One-time." : "One-time for the first month — re-pay monthly for another 30 days."}</span>
              </span>
              {paynowBusy ? <Loader2 className="size-4 animate-spin" /> : <span className="text-xs font-bold text-primary">Pay ›</span>}
            </button>

            {/* Card via Whop */}
            <button
              type="button"
              disabled={anyBusy}
              onClick={chooseCard}
              className="flex w-full items-center gap-3 rounded-xl border p-4 text-left transition hover:bg-foreground/[0.04] disabled:opacity-60"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-foreground/[0.06]">
                {isPriority ? <CreditCard className="size-5" /> : <Crown className="size-5 text-amber-500" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-sm font-bold">Card (Whop)</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {isPriority ? "Visa, Mastercard and more via Whop." : "Auto-renews via Whop subscription."}
                </span>
              </span>
              {cardBusy ? <Loader2 className="size-4 animate-spin" /> : <span className="text-xs font-bold">Pay ›</span>}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setLocation("/app")}
            disabled={anyBusy}
            className="mt-6 w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-60"
          >
            ← Back to Nova
          </button>
        </div>

        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Check className="size-3.5" /> Secure checkout · No card details ever touch Nova
        </p>
      </div>
    </div>
  );
}
