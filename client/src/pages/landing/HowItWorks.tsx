import React from "react";
import { CalendarClock, FolderOpen, MessagesSquare } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { Eyebrow } from "./shared";

/** Three steps, told as a single breath with serif numerals. */
export default function HowItWorks() {
  const { t } = useTranslation();
  const steps = [
    {
      icon: FolderOpen,
      title: t("landing.steps.one.title"),
      body: t("landing.steps.one.body"),
    },
    {
      icon: MessagesSquare,
      title: t("landing.steps.two.title"),
      body: t("landing.steps.two.body"),
    },
    {
      icon: CalendarClock,
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
        <div className="mt-10 grid gap-4 sm:mt-12 lg:grid-cols-3 lg:gap-5">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className="group relative rounded-3xl border border-border bg-card p-6 transition-colors duration-200 hover:border-primary/30 sm:p-7"
              >
                <div className="flex items-center justify-between">
                  <span className="grid size-11 place-items-center rounded-2xl bg-accent text-accent-foreground transition-colors duration-200 group-hover:bg-primary/10 group-hover:text-primary">
                    <Icon className="size-5" />
                  </span>
                  <span className="landing-display text-3xl leading-none text-muted-foreground/40 transition-colors duration-200 group-hover:text-primary/50">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-5 text-base font-semibold tracking-[-0.02em] text-foreground">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}