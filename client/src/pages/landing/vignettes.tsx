import React from "react";
import {
  CalendarClock,
  Check,
  Clock,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  FolderOpen,
  LayoutGrid,
  Mail,
  MessageSquareText,
  Timer,
} from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

/**
 * Small product scenes that show the workspace instead of describing it.
 * Every scene is decorative: it is aria-hidden and never interactive, so
 * screen readers skip it and keyboard users are not sent through fake UI.
 */

/** Shared frame for the deep-dive scenes: hairline card with a quiet header. */
function Scene({
  icon,
  title,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-[0_20px_50px_-32px_rgba(0,0,0,0.45)]",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="grid size-6 place-items-center rounded-md bg-accent text-accent-foreground">
          {icon}
        </span>
        <span className="text-xs font-semibold text-card-foreground">
          {title}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/** Hero scene: a miniature of the real workspace (sidebar + home pane). */
export function WorkspacePreview() {
  const { t } = useTranslation();
  const navItems = [
    { icon: LayoutGrid, label: t("nav.overview"), active: true },
    { icon: FolderOpen, label: t("nav.files"), active: false },
    { icon: MessageSquareText, label: t("nav.chats"), active: false },
    { icon: Timer, label: t("landing.preview.routines"), active: false },
  ];
  return (
    <div aria-hidden="true" className="relative">
      <div className="rounded-[1.5rem] border border-border bg-card p-2.5 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.5)] sm:rounded-[2rem] sm:p-3">
        <div className="overflow-hidden rounded-[1.05rem] border border-border bg-background sm:rounded-[1.45rem]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex gap-1">
                <i className="size-2 rounded-full bg-primary/45" />
                <i className="size-2 rounded-full bg-primary/25" />
                <i className="size-2 rounded-full bg-primary/15" />
              </span>
              <span className="ml-2 text-[11px] font-semibold text-muted-foreground">
                Nova / Workspace
              </span>
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">
              Today
            </span>
          </div>
          <div className="grid min-h-[300px] grid-cols-1 sm:min-h-[380px] sm:grid-cols-[200px_1fr]">
            <aside className="hidden border-r border-border bg-surface p-4 sm:block">
              <p className="px-2 pb-3 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {t("layout.yourSpace")}
              </p>
              <div className="space-y-1 text-[11px] font-medium text-muted-foreground">
                {navItems.map(item => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-2",
                        item.active && "bg-card text-card-foreground shadow-sm"
                      )}
                    >
                      <Icon className="size-3.5" />
                      {item.label}
                    </div>
                  );
                })}
              </div>
              <div className="mt-8 border-t border-border pt-3">
                <p className="px-2 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {t("landing.preview.recent")}
                </p>
                <p className="mt-3 truncate px-2 text-[11px] text-muted-foreground">
                  project-notes.md
                </p>
                <p className="mt-2 truncate px-2 text-[11px] text-muted-foreground">
                  weekly-plan.txt
                </p>
              </div>
            </aside>
            <div className="p-5 sm:p-7">
              <p className="text-[11px] font-semibold text-primary">
                {t("landing.preview.greeting")}
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground sm:text-2xl">
                {t("landing.preview.question")}
              </h2>
              <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                {t("landing.preview.hint")}
              </p>
              <div className="mt-5 rounded-xl border border-border bg-card p-3 sm:mt-6">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="grid size-6 place-items-center rounded-md bg-accent text-accent-foreground">
                    <MessageSquareText className="size-3.5" />
                  </span>
                  {t("landing.preview.ask")}
                </div>
                <div className="mt-4 flex justify-end">
                  <span className="rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground">
                    {t("landing.preview.startChat")}
                  </span>
                </div>
              </div>
              <div className="mt-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {t("landing.preview.resume")}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-card-foreground">
                      <FileText className="size-3.5 text-primary" />
                      {t("landing.preview.notes")}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {t("landing.preview.notesMeta")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-card-foreground">
                      <CalendarClock className="size-3.5 text-primary" />
                      {t("landing.preview.routine")}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {t("landing.preview.routineMeta")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Scene 1: the file browser, full of work that persisted. */
export function FilesVignette() {
  const { t } = useTranslation();
  const rows = [
    {
      name: "project-notes.md",
      size: "12 KB",
      meta: t("landing.vignette.editedJustNow"),
      active: true,
    },
    {
      name: "weekly-plan.txt",
      size: "4 KB",
      meta: t("landing.vignette.editedToday"),
    },
    {
      name: "sales.csv",
      size: "88 KB",
      meta: t("landing.vignette.editedMonday"),
    },
  ];
  return (
    <Scene
      icon={<FolderOpen className="size-3.5" />}
      title={t("nav.files")}
      className="mx-auto w-full max-w-md"
    >
      <ul className="space-y-1.5">
        {rows.map(row => (
          <li
            key={row.name}
            className={cn(
              "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5",
              row.active && "border-border bg-surface"
            )}
          >
            <FileText
              className={cn(
                "size-3.5 shrink-0",
                row.active ? "text-primary" : "text-muted-foreground"
              )}
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-card-foreground">
              {row.name}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {row.size}
            </span>
            <span className="hidden w-24 text-right text-[10px] text-muted-foreground sm:block">
              {row.meta}
            </span>
          </li>
        ))}
      </ul>
    </Scene>
  );
}

/** Scene 2: a request turning into finished work, step by step. */
export function AgentVignette() {
  const { t } = useTranslation();
  const steps = [
    { icon: FileText, label: t("landing.vignette.stepRead") },
    { icon: FlaskConical, label: t("landing.vignette.stepAnalyse") },
    { icon: FileSpreadsheet, label: t("landing.vignette.stepCreate") },
    { icon: Mail, label: t("landing.vignette.stepSend") },
  ];
  return (
    <Scene
      icon={<MessageSquareText className="size-3.5" />}
      title={t("landing.agent.eyebrow")}
      className="mx-auto w-full max-w-md"
    >
      <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground">
        {t("landing.vignette.request")}
      </p>
      <ul className="mt-3 space-y-2">
        {steps.map(step => {
          const Icon = step.icon;
          return (
            <li
              key={step.label}
              className="flex items-center gap-2.5 text-xs text-muted-foreground"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-surface text-muted-foreground">
                <Icon className="size-3" />
              </span>
              <span className="min-w-0 flex-1 truncate">{step.label}</span>
              <Check className="size-3.5 shrink-0 text-primary" />
            </li>
          );
        })}
      </ul>
      <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-foreground">
        <Check className="size-3" />
        {t("landing.vignette.done")}
      </p>
    </Scene>
  );
}

/** Scene 3: a routine and the run history it builds up. */
export function AutomationVignette() {
  const { t } = useTranslation();
  const runs = [
    { label: t("landing.vignette.runDone"), done: true },
    { label: t("landing.vignette.runYesterday"), done: true },
    { label: t("landing.vignette.runNext"), done: false },
  ];
  return (
    <Scene
      icon={<CalendarClock className="size-3.5" />}
      title={t("landing.automations.eyebrow")}
      className="mx-auto w-full max-w-md"
    >
      <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
        <p className="text-xs font-semibold text-card-foreground">
          {t("landing.vignette.schedule")}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("landing.preview.routine")}
        </p>
      </div>
      <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {t("landing.vignette.history")}
      </p>
      <ul className="mt-2 space-y-1.5">
        {runs.map(run => (
          <li
            key={run.label}
            className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-xs text-muted-foreground"
          >
            {run.done ? (
              <Check className="size-3.5 shrink-0 text-primary" />
            ) : (
              <Clock className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{run.label}</span>
          </li>
        ))}
      </ul>
    </Scene>
  );
}
