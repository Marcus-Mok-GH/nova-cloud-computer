import React from "react";
import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { CtaButton } from "./shared";

/**
 * The single inverted band on the page: for the people who will read the API
 * docs before they read the FAQ.
 */
export default function DevCallout() {
  const { t } = useTranslation();

  return (
    <section className="px-5 py-14 sm:px-8 sm:py-20">
      <div className="landing-invert mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-border/20">
        <div className="flex flex-col gap-8 px-6 py-12 sm:px-10 sm:py-14 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-current/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              {t("landing.dev.eyebrow")}
            </p>
            <h2 className="landing-display mt-4 text-2xl leading-tight sm:text-4xl">
              {t("landing.dev.title")}
            </h2>
            <p className="mt-3 text-sm leading-6 opacity-80 sm:text-base sm:leading-7">
              {t("landing.dev.body")}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-4">
            <code className="rounded-xl border border-current/15 bg-background/15 px-4 py-2.5 font-mono text-xs">
              POST /api/v1/chat/completions
            </code>
            <CtaButton
              label={t("landing.dev.cta")}
              href="/docs/api"
              icon={<ArrowUpRight className="size-4 rtl:-scale-x-100" />}
            />
          </div>
        </div>
      </div>
    </section>
  );
}