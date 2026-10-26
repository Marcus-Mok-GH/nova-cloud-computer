import React from "react";
import { Check, ChevronRight } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { CtaButton, useEnterNova } from "./shared";
import ProductCapture from "./ProductCapture";

/** The opening pairs a direct product story with a capture of the workspace. */
export default function Hero() {
  const { t } = useTranslation();
  const { isAuthenticated, enterNova } = useEnterNova();

  return (
    <section className="landing-hero relative isolate overflow-hidden">
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-14 pt-14 sm:px-8 sm:pb-20 sm:pt-20 lg:grid-cols-[1fr_1.12fr] lg:gap-12 lg:pt-24">
        <div className="rise-in relative z-10 max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            {t("landing.hero.eyebrow")}
          </p>
          <h1 className="landing-display landing-emboss mt-5 max-w-[13ch] text-[clamp(2.7rem,5.8vw,5rem)] leading-[0.99] text-foreground">
            {t("landing.hero.title")}
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {t("landing.hero.body")}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2">
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
              icon={<ChevronRight className="size-4 rtl:-scale-x-100" />}
            />
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
            {[t("landing.hero.bullet1"), t("landing.hero.bullet2")].map(
              item => (
                <li key={item} className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5 text-primary" />
                  {item}
                </li>
              )
            )}
          </ul>
        </div>
        <div className="rise-in-delay-1 relative min-w-0 lg:-me-10">
          <ProductCapture
            src="/landing/workspace-home.png"
            alt={t("landing.capture.workspace.alt")}
            label={t("landing.capture.workspace.label")}
            loading="eager"
            className="lg:rotate-[0.5deg]"
          />
          <p className="mt-3 px-1 text-xs text-muted-foreground sm:text-end">
            {t("landing.hero.caption")}
          </p>
        </div>
      </div>
    </section>
  );
}
