import React from "react";
import { Check, ChevronRight } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { CtaButton, useEnterNova } from "./shared";
import { WorkspacePreview } from "./vignettes";

/**
 * Centered title plate with the workspace peeking up underneath it - the
 * calm opening the rest of the page builds on.
 */
export default function Hero() {
  const { t } = useTranslation();
  const { isAuthenticated, enterNova } = useEnterNova();

  return (
    <section className="landing-hero relative isolate overflow-hidden">
      <div className="rise-in relative mx-auto max-w-3xl px-5 pb-12 pt-16 text-center sm:px-8 sm:pt-24">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
          {t("landing.hero.eyebrow")}
        </p>
        <h1 className="landing-display landing-emboss mx-auto mt-5 max-w-3xl text-[clamp(2.5rem,6.2vw,4.6rem)] leading-[1.02] text-foreground">
          {t("landing.hero.title")}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
          {t("landing.hero.body")}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <CtaButton
            label={
              isAuthenticated ? t("landing.cta.open") : t("landing.cta.get")
            }
            onClick={enterNova}
          />
          <CtaButton
            variant="ghost"
            label={t("landing.hero.secondary")}
            href="#how-it-works"
            icon={<ChevronRight className="size-4" />}
          />
        </div>
        <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-muted-foreground">
          <li className="inline-flex items-center gap-1.5">
            <Check className="size-3.5 text-primary" />
            {t("landing.hero.bullet1")}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Check className="size-3.5 text-primary" />
            {t("landing.hero.bullet2")}
          </li>
        </ul>
      </div>
      <div className="rise-in-delay-1 relative mx-auto max-w-4xl px-5 pb-16 pt-2 sm:px-8 sm:pb-20">
        <WorkspacePreview />
      </div>
    </section>
  );
}
