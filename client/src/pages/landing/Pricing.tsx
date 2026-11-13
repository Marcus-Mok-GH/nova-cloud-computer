import React from "react";
import { Check, Code, Coins, KeyRound } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { CtaButton, Eyebrow, useEnterNova } from "./shared";

type PricingPlan = {
  name: string;
  price: string;
  period: string;
  features: string[];
  highlighted?: boolean;
};

/** An honest pricing story: real plan prices, daily credits, BYOK, and API access. */
export default function Pricing() {
  const { t } = useTranslation();
  const { isAuthenticated, enterNova } = useEnterNova();
  const plans: PricingPlan[] = [
    {
      name: t("landing.pricing.plans.free.name"),
      price: t("landing.pricing.plans.free.price"),
      period: t("landing.pricing.plans.free.period"),
      features: [
        t("landing.pricing.plans.free.feature1"),
        t("landing.pricing.plans.free.feature2"),
      ],
    },
    {
      name: t("landing.pricing.plans.plus.name"),
      price: t("landing.pricing.plans.plus.price"),
      period: t("landing.pricing.plans.plus.period"),
      features: [
        t("landing.pricing.plans.plus.feature1"),
        t("landing.pricing.plans.plus.feature2"),
      ],
    },
    {
      name: t("landing.pricing.plans.pro.name"),
      price: t("landing.pricing.plans.pro.price"),
      period: t("landing.pricing.plans.pro.period"),
      features: [
        t("landing.pricing.plans.pro.feature1"),
        t("landing.pricing.plans.pro.feature2"),
      ],
      highlighted: true,
    },
  ];
  const items = [
    {
      icon: Coins,
      title: t("landing.pricing.credits.title"),
      body: t("landing.pricing.credits.body"),
    },
    {
      icon: KeyRound,
      title: t("landing.pricing.byok.title"),
      body: t("landing.pricing.byok.body"),
    },
    {
      icon: Code,
      title: t("landing.pricing.api.title"),
      body: t("landing.pricing.api.body"),
    },
  ];

  return (
    <section
      id="pricing"
      className="scroll-mt-24 border-y border-border bg-surface"
    >
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t("landing.pricing.eyebrow")}</Eyebrow>
          <h2 className="landing-display mt-4 text-3xl leading-tight text-foreground sm:text-5xl">
            {t("landing.pricing.title")}
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            {t("landing.pricing.body")}
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-3">
          {plans.map(plan => (
            <section
              key={plan.name}
              className={cn(
                "flex flex-col rounded-2xl border p-5",
                plan.highlighted
                  ? "border-primary/40 bg-primary/[0.03]"
                  : "border-border bg-card"
              )}
            >
              <p className="text-sm font-bold text-card-foreground">
                {plan.name}
              </p>
              <div className="mt-2 flex items-end gap-1.5">
                <span className="text-3xl font-extrabold tracking-tight text-foreground">
                  {plan.price}
                </span>
                <span className="pb-1 text-xs text-muted-foreground">
                  {plan.period}
                </span>
              </div>
              <ul className="mt-3 space-y-1.5">
                {plan.features.map(feature => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"
                  >
                    <Check
                      className="mt-0.5 size-3.5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-4 max-w-3xl text-xs leading-5 text-muted-foreground">
          {t("landing.pricing.extra")}
        </p>

        <div className="mt-10 max-w-3xl rounded-3xl border border-border bg-card p-6 sm:mt-12 sm:p-8">
          <ul className="divide-y divide-border">
            {items.map(item => {
              const Icon = item.icon;
              return (
                <li
                  key={item.title}
                  className="flex gap-4 py-5 first:pt-0 last:pb-0"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-card-foreground">
                      {item.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              {t("landing.pricing.note")}
            </p>
            <CtaButton
              label={
                isAuthenticated ? t("landing.cta.open") : t("landing.cta.get")
              }
              onClick={enterNova}
              className="px-4 py-2.5"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
