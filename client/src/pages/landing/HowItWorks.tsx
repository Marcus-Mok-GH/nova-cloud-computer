import React from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { Eyebrow } from "./shared";

export default function HowItWorks() {
  const { t } = useTranslation();
  const steps = [
    {
      title: t("landing.steps.one.title"),
      body: t("landing.steps.one.body"),
    },
    {
      title: t("landing.steps.two.title"),
      body: t("landing.steps.two.body"),
    },
    {
      title: t("landing.steps.three.title"),
      body: t("landing.steps.three.body"),
    },
  ];

  return (
    <section
      id="how-it-works"
      className="scroll-mt-24 border-y border-border bg-surface"
    >
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t("landing.steps.eyebrow")}</Eyebrow>
          <h2 className="landing-display mt-4 text-3xl leading-tight text-foreground sm:text-5xl">
            {t("landing.steps.title")}
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            {t("landing.steps.body")}
          </p>
        </div>

        <ol className="mt-10 grid border-y border-border sm:mt-12 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="border-b border-border py-6 last:border-b-0 sm:px-6 sm:first:ps-0 sm:last:pe-0 lg:border-b-0 lg:py-8 lg:ps-8 lg:first:ps-0 lg:last:pe-0 lg:[&:not(:first-child)]:border-s"
            >
              <span className="landing-display text-4xl leading-none text-primary/70" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-5 text-base font-semibold tracking-[-0.02em] text-foreground">
                {step.title}
              </h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
