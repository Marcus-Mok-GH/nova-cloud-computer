import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Clock,
  FileSpreadsheet,
  FileText,
  Folder,
  Github,
  Globe,
  Mail,
  Settings2,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import NovaLogo from "./NovaLogo";

/**
 * localStorage flag that keeps the tour to a single run per browser. It is
 * written only when the visitor finishes or skips, so closing the tab mid-tour
 * offers it again next time rather than losing it forever.
 */
export const ONBOARDING_TOUR_SEEN_KEY = "nova.onboardingTour.v1";

type TourStep = {
  id: string;
  icon: LucideIcon;
  kicker: string;
  title: string;
  body: string;
  tip: string;
};

/**
 * The first-run walkthrough of the workspace. Copy is intentionally hardcoded
 * English, matching the sibling OnboardingModal — the in-app onboarding
 * surfaces predate the locale sweep and are not on the i18n key budget.
 */
const TOUR_STEPS: ReadonlyArray<TourStep> = [
  {
    id: "welcome",
    icon: Sparkles,
    kicker: "Your cloud workspace",
    title: "Welcome to Nova",
    body: "Your own cloud workspace with an AI agent. It can read and write files, run code, and keep routines going — even after you close the tab.",
    tip: "Everything here is private to your account.",
  },
  {
    id: "task",
    icon: ArrowUp,
    kicker: "Prompt screen",
    title: "Start with a task",
    body: "Describe what you need on the prompt screen. Nova plans the work, then carries it out while you watch each step happen.",
    tip: "Leave the model on Auto, or pick one and set an effort.",
  },
  {
    id: "files",
    icon: Folder,
    kicker: "File browser",
    title: "Your files live here",
    body: "Files and folders stay in your workspace. Drag one onto the chat to hand it over — Nova can open, edit, and organize it.",
    tip: "Try: \u201cSummarize the files in my workspace.\u201d",
  },
  {
    id: "automations",
    icon: Clock,
    kicker: "Scheduled work",
    title: "Put routines on a schedule",
    body: "Describe a recurring job and pick a time. Nova runs it in the cloud and keeps a history you can review.",
    tip: "A daily recap or a nightly tidy-up makes a good first automation.",
  },
  {
    id: "settings",
    icon: Settings2,
    kicker: "Connect & configure",
    title: "Make it yours",
    body: "Connect GitHub, Gmail, or Vercel, bring your own model key, and manage billing — all from Settings.",
    tip: "You can change any of this later.",
  },
  {
    id: "done",
    icon: Check,
    kicker: "Ready when you are",
    title: "You\u2019re all set",
    body: "That\u2019s the tour. Start a task whenever you\u2019re ready — your workspace is waiting.",
    tip: "",
  },
];

/** A small stand-in for the real surface each step describes. */
function Visual({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-36 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/60 p-4">
      {children}
    </div>
  );
}

const FILE_ROWS = [
  { icon: FileText, name: "Report.pdf", size: "2.1 MB" },
  { icon: FileSpreadsheet, name: "Budget.xlsx", size: "88 KB" },
  { icon: Folder, name: "Projects", size: "12 items" },
];

const CONNECTORS = [
  { icon: Github, name: "GitHub" },
  { icon: Mail, name: "Gmail" },
  { icon: Globe, name: "Vercel" },
];

/**
 * One mock per step, keyed by the step id. Kept deliberately schematic: the
 * point is the surface being named, not a pixel copy of it.
 */
function stepVisual(id: string): React.ReactNode {
  switch (id) {
    case "welcome":
      return (
        <Visual>
          <div className="w-full max-w-[240px] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
              <span className="size-1.5 rounded-full bg-primary/50" />
              <span className="size-1.5 rounded-full bg-muted-foreground/25" />
              <span className="size-1.5 rounded-full bg-muted-foreground/25" />
              <span className="ms-1 text-[9px] font-semibold text-muted-foreground">
                Nova workspace
              </span>
            </div>
            <div className="space-y-1.5 p-3">
              <div className="h-1.5 w-2/3 rounded-full bg-foreground/20" />
              <div className="h-1.5 w-1/2 rounded-full bg-foreground/10" />
              <div className="pt-1.5">
                <div className="h-1.5 w-1/3 rounded-full bg-primary/40" />
              </div>
            </div>
          </div>
        </Visual>
      );
    case "task":
      return (
        <Visual>
          <div className="w-full max-w-[240px] space-y-2">
            <div className="rounded-xl border border-border bg-card px-3 py-2 text-[10px] leading-4 text-muted-foreground">
              Summarize the files in my workspace
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary">
                Auto
              </span>
              <span className="ms-auto grid size-6 place-items-center rounded-full bg-foreground">
                <ArrowUp className="size-3 text-background" />
              </span>
            </div>
          </div>
        </Visual>
      );
    case "files":
      return (
        <Visual>
          <div className="w-full max-w-[240px] overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Files
            </div>
            <div className="divide-y divide-border">
              {FILE_ROWS.map(row => (
                <div key={row.name} className="flex items-center gap-2 px-3 py-1.5">
                  <row.icon className="size-3 text-primary" />
                  <span className="text-[10px] font-medium text-foreground">
                    {row.name}
                  </span>
                  <span className="ms-auto text-[9px] text-muted-foreground">
                    {row.size}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Visual>
      );
    case "automations":
      return (
        <Visual>
          <div className="w-full max-w-[240px] space-y-2">
            {[
              { name: "Daily recap", schedule: "Every day at 9:00 AM", on: true },
              { name: "Nightly tidy-up", schedule: "Mon, Wed, Fri at 11:00 PM", on: false },
            ].map(row => (
              <div
                key={row.name}
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-primary/10">
                  <Clock className="size-3 text-primary" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[10px] font-semibold text-foreground">
                    {row.name}
                  </span>
                  <span className="block text-[9px] text-muted-foreground">
                    {row.schedule}
                  </span>
                </span>
                <span
                  className={`ms-auto h-3.5 w-6 shrink-0 rounded-full ${row.on ? "bg-primary" : "bg-border"}`}
                >
                  <span
                    className={`block size-3 rounded-full bg-white ${row.on ? "ms-auto" : ""}`}
                  />
                </span>
              </div>
            ))}
          </div>
        </Visual>
      );
    case "settings":
      return (
        <Visual>
          <div className="flex w-full max-w-[240px] flex-wrap justify-center gap-1.5">
            {CONNECTORS.map(conn => (
              <span
                key={conn.name}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[9px] font-semibold text-foreground"
              >
                <conn.icon className="size-3 text-primary" />
                {conn.name}
              </span>
            ))}
            <span className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-[9px] font-semibold text-muted-foreground">
              <Sparkles className="size-3" />
              Bring your own key
            </span>
          </div>
        </Visual>
      );
    default:
      return (
        <div className="flex h-36 items-center justify-center">
          <span className="grid size-16 place-items-center rounded-full border border-primary/30 bg-primary/10">
            <Check className="size-7 text-primary" />
          </span>
        </div>
      );
  }
}

/**
 * The first-run tour. `open` is owned by the layout so the parent can decide
 * when to offer it; the seen-flag is written here, on close, so a tour
 * dismissed by Escape or the X is not shown again on every load.
 */
export function OnboardingTour({
  open,
  onOpenChange,
  initialStep = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep);
  const lastIndex = TOUR_STEPS.length - 1;
  const isLast = step === lastIndex;

  // Replaying (or reopening) starts from the first step, never from wherever
  // the previous run was left.
  useEffect(() => {
    if (open) setStep(initialStep);
  }, [open, initialStep]);

  const close = () => {
    try {
      window.localStorage.setItem(ONBOARDING_TOUR_SEEN_KEY, "1");
    } catch {
      // Private mode / a blocked storage API: the tour just reappears next
      // load, which is the safe failure.
    }
    onOpenChange(false);
  };

  const next = () => (isLast ? close() : setStep(index => index + 1));

  const current = TOUR_STEPS[step];
  const Icon = current.icon;
  // The completion step is a single centered beat, not another left-aligned
  // feature row.
  const centered = current.id === "done";

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border-border bg-card p-6 sm:max-w-md"
      >
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Step {step + 1} of {TOUR_STEPS.length}
          </span>
          <div className="ms-auto flex items-center gap-1.5" aria-hidden="true">
            {TOUR_STEPS.map((tourStep, index) => (
              <span
                key={tourStep.id}
                className={`h-1.5 rounded-full transition-all ${
                  index === step
                    ? "w-5 bg-primary"
                    : index < step
                      ? "w-1.5 bg-primary/50"
                      : "w-1.5 bg-border"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close onboarding tour"
            className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <X className="size-4" />
          </button>
        </div>

        <div key={current.id} className={`chat-in mt-4 ${centered ? "text-center" : ""}`}>
          {stepVisual(current.id)}

          <DialogHeader className={`mt-4 ${centered ? "text-center sm:text-center" : ""}`}>
            <div className={`mb-2 flex items-center gap-2 text-primary ${centered ? "justify-center" : ""}`}>
              <Icon size={16} />
              <span className="text-[11px] font-bold uppercase tracking-[0.14em]">
                {current.kicker}
              </span>
            </div>
            <DialogTitle className="nova-display text-2xl leading-tight text-foreground">
              {current.title}
            </DialogTitle>
            <DialogDescription className="mt-2 text-balance text-sm leading-6 text-muted-foreground">
              {current.body}
            </DialogDescription>
          </DialogHeader>

          {current.tip && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
              {current.tip}
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          {!isLast && (
            <button
              type="button"
              onClick={close}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              Skip tour
            </button>
          )}
          <div className="ms-auto flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(index => Math.max(0, index - 1))}
                className="grid size-10 place-items-center rounded-xl border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                aria-label="Previous step"
              >
                <ArrowLeft className="size-4 rtl:-scale-x-100" />
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {isLast ? "Start using Nova" : "Next"}
              {!isLast && (
                <ArrowRight className="size-4 rtl:-scale-x-100" />
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default OnboardingTour;
