import React from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { Eyebrow } from "./shared";

/** Three steps, told as a single breath with serif numerals. */
export default function HowItWorks() {
  const { t } = useTranslation();
  const steps = [
    { title: t("landing.steps.one.title"), body: t("landing.steps.one.body") },
    { title: t("landing.steps.two.title"), body: t("landing.steps.two.body") },
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
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t("landing.steps.eyebrow")}</Eyebrow>
          <h2 className="landing-display mt-4 text-3xl leading-tight text-foreground sm:text-5xl">
            {t("landing.steps.title")}
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            {t("landing.steps.body")}
          </p>
        </div>
        <div className="mt-10 grid gap-10 sm:mt-12 lg:grid-cols-3 lg:gap-12">
          {steps.map((step, index) => (
            <div key={step.title} className="border-t border-border pt-5">
              <span className="landing-display text-3xl text-primary">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 text-base font-semibold tracking-[-0.02em] text-foreground">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
