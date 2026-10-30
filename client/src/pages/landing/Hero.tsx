import React from "react";
import { Check, ChevronRight } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { CtaButton, useEnterNova } from "./shared";
import ProductCapture from "./ProductCapture";

export default function Hero() {
  const { t } = useTranslation();
  const { isAuthenticated, enterNova } = useEnterNova();

  return (
    <section className="landing-hero">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-12 lg:py-20">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {t("landing.hero.eyebrow")}
          </p>
          <h1 className="landing-display mt-5 max-w-[16ch] text-balance text-[clamp(2.4rem,3.8vw,3.6rem)] leading-[1.03] tracking-[-0.04em] text-foreground">
            {t("landing.hero.title")}
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {t("landing.hero.body")}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
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
                  <Check className="size-3.5 text-primary" aria-hidden="true" />
                  {item}
                </li>
              )
            )}
          </ul>
        </div>

        <div className="lg:-me-8">
          <ProductCapture
            src="/landing/workspace-home.png"
            alt={t("landing.capture.workspace.alt")}
            label={t("landing.capture.workspace.label")}
            loading="eager"
          />
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {t("landing.hero.caption")}
          </p>
        </div>
      </div>
    </section>
  );
}
