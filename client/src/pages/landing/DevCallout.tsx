import React from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { CtaButton } from "./shared";

/**
 * The single inverted band on the page: for the people who will read the API
 * docs before they read the FAQ.
 */
export default function DevCallout() {
  const { t } = useTranslation();

  return (
    <section className="landing-invert">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-16 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
            {t("landing.dev.eyebrow")}
          </p>
          <h2 className="landing-display mt-3 text-2xl leading-tight sm:text-4xl">
            {t("landing.dev.title")}
          </h2>
          <p className="mt-3 text-sm leading-6 opacity-80 sm:text-base sm:leading-7">
            {t("landing.dev.body")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-4">
          <code className="rounded-xl bg-background/15 px-4 py-2.5 font-mono text-xs">
            POST /api/v1/chat/completions
          </code>
          <CtaButton label={t("landing.dev.cta")} href="/docs/api" />
        </div>
      </div>
    </section>
  );
}
