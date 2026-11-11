/**
 * Billing: the account's plan, credit allowance, and every buyable plan in
 * one place. This used to be a tab buried inside Settings; it is now its own
 * destination in the primary navigation.
 *
 * Payments run through Whop's hosted checkout — Nova never sees card details.
 * Pro opens the shared payment-methods page (/checkout?product=pro), priority
 * starts its checkout directly, and either grant lands only when Whop's
 * webhook confirms the payment.
 */
import React, { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Check,
  Coins,
  CreditCard,
  Crown,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

/** Shown while the subscription query is still in flight. */
function BillingLoading() {
  return (
    <DashboardLayout>
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    </DashboardLayout>
  );
}

type PlanCardProps = {
  name: string;
  price: string;
  period: string;
  body: string;
  features: string[];
  badge?: string;
  highlighted?: boolean;
  /** The CTA renders as a static "current plan" chip when set. */
  currentLabel?: string;
  cta: string;
  onSelect: () => void;
  busy: boolean;
  disabled: boolean;
};

function PlanCard({
  name,
  price,
  period,
  body,
  features,
  badge,
  highlighted,
  currentLabel,
  cta,
  onSelect,
  busy,
  disabled,
}: PlanCardProps) {
  return (
    <section
      className={`rise-in relative flex flex-col rounded-2xl border p-5 shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-6 ${
        highlighted
          ? "border-primary/40 bg-primary/[0.02]"
          : "bg-card text-card-foreground"
      }`}
    >
      {badge && (
        <span className="absolute -top-2.5 start-5 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
          {badge}
        </span>
      )}
      <p className="text-sm font-bold">{name}</p>
      <div className="mt-3 flex items-end gap-1.5">
        <span className="text-3xl font-extrabold tracking-tight">{price}</span>
        <span className="pb-1 text-xs text-muted-foreground">{period}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{body}</p>
      <ul className="mt-4 flex-1 space-y-2">
        {features.map(feature => (
          <li key={feature} className="flex items-start gap-2 text-xs leading-5">
            <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {currentLabel ? (
        <span className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs font-bold text-muted-foreground">
          <Check size={14} /> {currentLabel}
        </span>
      ) : (
        <Button
          className="mt-5 w-full"
          variant={highlighted ? "default" : "outline"}
          onClick={onSelect}
          disabled={disabled || busy}
        >
          {busy && <Loader2 size={15} className="animate-spin" />} {cta}
        </Button>
      )}
    </section>
  );
}

export default function Billing() {
  const { t, locale } = useTranslation();
  const [, setLocation] = useLocation();
  const subscription = trpc.billing.subscription.useQuery(undefined, {
    retry: false,
  });
  const priority = trpc.billing.status.useQuery(undefined, { retry: false });
  const [pending, setPending] = useState<"priority" | "portal" | null>(null);

  const buyPriority = trpc.billing.purchasePriority.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: error => {
      setPending(null);
      toast.error(error.message || t("settings.billing.buy.error"));
    },
  });

  const portal = trpc.billing.portal.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: error => {
      setPending(null);
      toast.error(error.message || t("billing.current.manageError"));
    },
  });

  if (subscription.isLoading) return <BillingLoading />;
  if (subscription.isError)
    return (
      <DashboardLayout>
        <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
          <section className="rounded-2xl border bg-card p-8 text-center shadow-[0_4px_14px_rgba(10,10,10,0.05)]">
            <Sparkles className="mx-auto text-primary" size={24} />
            <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
              {t("billing.loadError.title")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {t("billing.loadError.body")}
            </p>
            <Button className="mt-6" onClick={() => subscription.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </section>
        </div>
      </DashboardLayout>
    );

  const data = subscription.data;
  const isPaid = data?.plan === "paid";
  const monthly = data?.monthlyCredits;
  const topUpProducts = data?.topUpProducts ?? [];
  const boughtCredits = data?.creditTopUps?.remainingCredits ?? 0;
  const priorityActive = priority.data?.priority ?? false;
  const priorityArmed = priority.data?.armed ?? false;
  const periodEnd = data?.currentPeriodEnd
    ? new Date(data.currentPeriodEnd).toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;
  const proPrice =
    data?.currency && data.currency.toUpperCase() !== "SGD"
      ? `${data.currency.toUpperCase()} ${(data.priceCents / 100).toFixed(2)}`
      : "S$7.99";

  return (
    <DashboardLayout>
      <div className="relative mx-auto max-w-5xl space-y-7 pb-12 pt-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-primary/[0.045] to-transparent dark:from-primary/[0.07]" />

        <section className="rise-in relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-8 shadow-[0_4px_14px_rgba(10,10,10,0.05)] dark:border-white/10 dark:bg-card sm:px-9 sm:py-10">
          <div className="relative">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              {t("billing.hero.eyebrow")}
            </p>
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              {t("billing.hero.title")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("billing.hero.subtitle")}
            </p>
          </div>
        </section>

        {/* Current plan + credits */}
        <div className="relative grid gap-4 sm:grid-cols-2">
          <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                  {t("billing.current.title")}
                </p>
                <p className="mt-1 flex items-center gap-2 text-lg font-bold">
                  {isPaid ? (
                    <>
                      <Crown className="size-4 text-amber-500" />
                      {t("billing.current.paid")}
                    </>
                  ) : (
                    t("billing.current.free")
                  )}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {isPaid
                    ? periodEnd
                      ? data?.cancelAtPeriodEnd
                        ? t("billing.current.cancelsOn", { date: periodEnd })
                        : t("billing.current.renewsOn", { date: periodEnd })
                      : t("billing.current.paid")
                    : t("billing.current.freeBody")}
                </p>
              </div>
              <div className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
                <CreditCard size={20} />
              </div>
            </div>
            {isPaid && (
              <Button
                variant="outline"
                className="mt-5 w-full"
                onClick={() => {
                  setPending("portal");
                  portal.mutate();
                }}
                disabled={portal.isPending}
              >
                {portal.isPending && (
                  <Loader2 size={15} className="animate-spin" />
                )}{" "}
                {t("billing.current.manage")}
              </Button>
            )}
          </section>

          <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-6">
            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
              {t("billing.credits.title")}
            </p>
            <p className="mt-1 flex items-center gap-2 text-lg font-bold">
              <Coins className="size-4 text-primary" />
              {isPaid && monthly
                ? t("billing.credits.balance", {
                    count: monthly.balanceCredits.toLocaleString(locale),
                  })
                : t("billing.current.free")}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {isPaid && monthly
                ? t("billing.credits.thisMonth", {
                    used: monthly.usedCreditsThisMonth.toLocaleString(locale),
                    allocated: monthly.monthlyAllocation.toLocaleString(locale),
                  })
                : t("billing.credits.none")}
            </p>
            {isPaid && monthly && monthly.carryOverMonths > 0 && (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {t("billing.credits.carryOver", {
                  months: String(monthly.carryOverMonths),
                })}
              </p>
            )}
          </section>
        </div>

        {/* Buy credits */}
        {topUpProducts.length > 0 && (
          <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                  {t("billing.topUps.title")}
                </p>
                <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">
                  {t("billing.topUps.body")}
                </p>
              </div>
              {boughtCredits > 0 && (
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <Coins className="size-3.5 text-primary" />
                  {t("billing.topUps.owned", {
                    count: boughtCredits.toLocaleString(locale),
                  })}
                </p>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {topUpProducts.map(topUp => (
                <button
                  key={topUp.id}
                  type="button"
                  onClick={() => {
                    setLocation(`/checkout?credits=${encodeURIComponent(topUp.id)}`);
                  }}
                  disabled={!data?.configured}
                  className="group flex flex-col items-center gap-1 rounded-xl border bg-background px-3 py-4 text-center transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_6px_18px_rgba(10,10,10,0.07)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                >
                  <span className="text-lg font-bold tracking-tight">{topUp.price}</span>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {topUp.credits.toLocaleString(locale)} credits
                  </span>
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                    {t("billing.topUps.buy")}
                  </span>
                </button>
              ))}
            </div>
            {!data?.configured && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                {t("billing.topUps.notConfigured")}
              </p>
            )}
          </section>
        )}

        {/* Buyable plans */}
        <div className="relative">
          <h2 className="mb-4 text-lg font-bold tracking-tight">
            {t("billing.plans.title")}
          </h2>
          <div className="grid items-stretch gap-4 md:grid-cols-3">
            <PlanCard
              name={t("billing.plan.free.name")}
              price={t("billing.plan.free.price")}
              period={t("billing.plan.free.period")}
              body={t("billing.plan.free.body")}
              features={[
                t("billing.plan.free.feature.1"),
                t("billing.plan.free.feature.2"),
                t("billing.plan.free.feature.3"),
              ]}
              cta={t("billing.plan.free.cta")}
              currentLabel={!isPaid ? t("billing.plan.free.cta") : t("billing.plan.free.included")}
              onSelect={() => setLocation("/app")}
              busy={false}
              disabled
            />

            <PlanCard
              name={t("billing.plan.pro.name")}
              price={proPrice}
              period={t("billing.plan.pro.period")}
              body={t("billing.plan.pro.body")}
              features={[
                t("billing.plan.pro.feature.1"),
                t("billing.plan.pro.feature.2"),
                t("billing.plan.pro.feature.3"),
              ]}
              badge={t("billing.plan.popular")}
              highlighted
              cta={t("billing.plan.pro.cta")}
              currentLabel={isPaid ? t("billing.plan.pro.active") : undefined}
              onSelect={() => setLocation("/checkout?product=pro")}
              busy={false}
              disabled={!data?.configured}
            />

            <PlanCard
              name={t("billing.plan.priority.name")}
              price="S$4.99"
              period={t("billing.plan.priority.period")}
              body={t("billing.plan.priority.body")}
              features={[
                t("billing.plan.priority.feature.1"),
                t("billing.plan.priority.feature.2"),
                t("billing.plan.priority.feature.3"),
              ]}
              cta={t("billing.plan.priority.cta")}
              currentLabel={
                priorityActive || priorityArmed
                  ? t("billing.plan.priority.active")
                  : undefined
              }
              onSelect={() => {
                setPending("priority");
                buyPriority.mutate();
              }}
              busy={pending === "priority" && buyPriority.isPending}
              disabled={!data?.configured}
            />
          </div>
        </div>

        <section className="rise-in relative flex items-start gap-3 rounded-2xl border bg-muted/20 p-5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-bold">{t("billing.pay.title")}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("billing.pay.body")}
            </p>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
