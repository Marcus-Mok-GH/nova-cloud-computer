import React, { useState } from "react";
import { ArrowUp, Asterisk, ChevronDown, Gauge, Paperclip, Settings2 } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { useEnterNova } from "./shared";

const controlClass =
  "inline-flex items-center gap-1.5 text-sm font-medium text-foreground";

/**
 * The landing hero as a task prompt: a big question, a session composer,
 * and the model / mode / workspace previews from the app's empty state.
 * The page is pre-sign-in, so the composer is the CTA - Enter or the
 * arrow button runs enterNova (sign-in for guests, /app for signed-in
 * visitors). The little selectors are decorative previews; only the
 * real composer in Nova drives them.
 */
export default function Hero() {
  const { t } = useTranslation();
  const { enterNova } = useEnterNova();
  const [task, setTask] = useState("");

  const startSession = () => {
    enterNova();
  };

  return (
    <section className="landing-hero flex min-h-[calc(100dvh-var(--landing-nav-height))] flex-col items-center justify-center px-5 py-16 sm:px-8">
      <h1 className="landing-display text-center text-balance text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] tracking-[-0.03em] text-muted-foreground">
        {t("landing.hero.titlePre")}{" "}
        <span className="text-foreground">{t("landing.hero.titleName")}</span>{" "}
        {t("landing.hero.titlePost")}
      </h1>

      <form
        className="mt-9 w-full max-w-2xl rounded-2xl border border-border bg-card p-4 shadow-[0_4px_14px_rgba(10,10,10,0.05)] focus-within:ring-2 focus-within:ring-ring/40"
        onSubmit={event => {
          event.preventDefault();
          startSession();
        }}
      >
        <textarea
          value={task}
          onChange={event => setTask(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              startSession();
            }
          }}
          placeholder={t("landing.hero.prompt.placeholder")}
          aria-label={t("landing.hero.prompt.aria")}
          rows={3}
          className="w-full resize-none bg-transparent text-base leading-6 text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        />
        <div className="mt-3 flex items-center gap-4">
          <span aria-hidden="true" className={controlClass}>
            {t("landing.hero.prompt.model")}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </span>
          <span aria-hidden="true" className={controlClass}>
            <Gauge className="size-4 text-muted-foreground" />
            {t("landing.hero.prompt.mode")}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </span>
          <button
            type="submit"
            aria-label={t("landing.hero.prompt.send")}
            className="ml-auto grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>

      <div className="mt-5 flex w-full max-w-2xl items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span aria-hidden="true">
            <Paperclip className="size-4.5 text-muted-foreground" />
          </span>
          <span aria-hidden="true" className={controlClass}>
            <span className="grid size-6 place-items-center rounded-lg bg-foreground text-background">
              <Asterisk className="size-3.5" />
            </span>
            {t("landing.hero.prompt.workspace")}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </span>
        </div>
        <span aria-hidden="true">
          <Settings2 className="size-4.5 text-muted-foreground" />
        </span>
      </div>
    </section>
  );
}
