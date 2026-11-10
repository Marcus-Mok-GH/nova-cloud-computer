import React from "react";
import {
  CalendarClock,
  FileText,
  Inbox,
  Rocket,
  Search,
  SquareTerminal,
} from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { Eyebrow } from "./shared";

/**
 * Six jobs people actually hand over, each one something the agent can do with
 * the tools it ships with (research, files, a shell, its inbox, schedules,
 * deployments). Hairline rules instead of cards, so the section reads as a
 * list of work rather than another row of feature tiles.
 */
export default function Jobs() {
  const { t } = useTranslation();
  const jobs = [
    { icon: Search, titleKey: "landing.jobs.research.title", bodyKey: "landing.jobs.research.body" },
    { icon: FileText, titleKey: "landing.jobs.document.title", bodyKey: "landing.jobs.document.body" },
    { icon: SquareTerminal, titleKey: "landing.jobs.code.title", bodyKey: "landing.jobs.code.body" },
    { icon: Inbox, titleKey: "landing.jobs.inbox.title", bodyKey: "landing.jobs.inbox.body" },
    { icon: CalendarClock, titleKey: "landing.jobs.routine.title", bodyKey: "landing.jobs.routine.body" },
    { icon: Rocket, titleKey: "landing.jobs.ship.title", bodyKey: "landing.jobs.ship.body" },
  ] as const;

  return (
    <section id="uses" className="scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t("landing.jobs.eyebrow")}</Eyebrow>
          <h2 className="landing-display mt-4 text-3xl leading-tight text-foreground sm:text-5xl">
            {t("landing.jobs.title")}
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            {t("landing.jobs.body")}
          </p>
        </div>

        <ul className="mt-10 grid gap-x-10 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map(job => {
            const Icon = job.icon;
            return (
              <li
                key={job.titleKey}
                className="border-t border-border py-6 sm:py-7"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-accent text-accent-foreground">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <h3 className="text-base font-semibold tracking-[-0.02em] text-foreground">
                    {t(job.titleKey)}
                  </h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {t(job.bodyKey)}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
