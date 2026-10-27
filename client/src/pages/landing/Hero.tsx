import React from "react";
import {
  CalendarClock,
  Check,
  ChevronRight,
  FolderOpen,
  MessagesSquare,
} from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { CtaButton, useEnterNova } from "./shared";
import ProductCapture from "./ProductCapture";

/** The small rounded icon tiles that punctuate the headline, in Mobbin's idiom. */
function IconBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="inline-grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-card text-primary shadow-[0_2px_10px_-4px_rgba(0,0,0,0.35)] sm:size-11 lg:size-12"
    >
      {children}
    </span>
  );
}

/** The opening pairs a centred product story with a wide capture of the workspace. */
export default function Hero() {
  const { t } = useTranslation();
  const { isAuthenticated, enterNova } = useEnterNova();

  return (
    <section className="landing-hero relative isolate overflow-hidden">
      <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20">
        <div className="rise-in mx-auto flex max-w-3xl flex-col items-center text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground backdrop-blur-sm">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            {t("landing.hero.eyebrow")}
          </p>

          <h1 className="landing-display landing-emboss mt-7 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2 text-[clamp(2.3rem,5.4vw,4.6rem)] leading-[1.04] tracking-[-0.03em] text-foreground">
            <IconBadge>
              <FolderOpen className="size-4 sm:size-5" />
            </IconBadge>
            <span className="text-balance">{t("landing.hero.title")}</span>
            <IconBadge>
              <MessagesSquare className="size-4 sm:size-5" />
            </IconBadge>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {t("landing.hero.body")}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
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

          <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
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

        <div className="rise-in-delay-1 relative mt-12 sm:mt-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-6 -top-6 bottom-6 -z-10 rounded-[2rem] bg-primary/10 blur-2xl"
          />
          <ProductCapture
            src="/landing/workspace-home.png"
            alt={t("landing.capture.workspace.alt")}
            label={t("landing.capture.workspace.label")}
            loading="eager"
            className="mx-auto max-w-5xl"
          />
          <p className="mx-auto mt-4 max-w-5xl px-1 text-center text-xs text-muted-foreground">
            {t("landing.hero.caption")}
          </p>
        </div>
      </div>
    </section>
  );
}