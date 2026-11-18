import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Sparkles, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import NovaLogo from "./NovaLogo";

/**
 * localStorage flag that keeps the flow to a single run per browser. Written
 * only when the visitor finishes or dismisses it, so closing the tab mid-flow
 * offers it again next time rather than losing it forever.
 */
export const ONBOARDING_FLOW_SEEN_KEY = "nova.onboardingFlow.v1";

/**
 * Nova's own starting points - the same prompts the workspace prompt screen
 * offers. Onboarding reuses them so the first job is a real Nova job, not a
 * generic "what's on your mind".
 */
const STARTER_JOBS = [
  "Summarize a topic and write it as a report",
  "Review the files in my workspace and summarize them",
  "Schedule a daily recap of my tasks at 9 AM",
  "Research a question and save the answer as a file",
];

type Step = "why" | "job" | "context";
const STEP_ORDER: readonly Step[] = ["why", "job", "context"];

export type OnboardingStep = Step;

/**
 * The first-run flow, written for Nova rather than borrowed from another
 * product: it opens with what makes Nova different (an agent with a computer),
 * then gets the visitor's first real job - offered as Nova's own starting
 * points - and lands them in a conversation already holding that job.
 *
 * Copy is intentionally hardcoded English, matching the sibling
 * OnboardingModal - the in-app onboarding surfaces predate the locale sweep.
 */
export function OnboardingFlow({
  onOpenChange,
  onFinish,
  initialStep = "why",
}: {
  onOpenChange: (open: boolean) => void;
  onFinish: (result: { content: string; chatId?: string }) => void;
  /** Test/screenshot seam: which screen to open on. */
  initialStep?: OnboardingStep;
}) {
  const [step, setStep] = useState<Step>(initialStep);
  const [job, setJob] = useState("");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const createChat = trpc.chats.create.useMutation();
  const jobInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (step === "job") jobInputRef.current?.focus();
  }, [step]);

  const markSeen = () => {
    try {
      window.localStorage.setItem(ONBOARDING_FLOW_SEEN_KEY, "1");
    } catch {
      // Private mode / blocked storage: the flow just reappears next load.
    }
  };

  const close = () => {
    markSeen();
    onOpenChange(false);
  };

  /**
   * Hand the captured work to the workspace: the job titles a real
   * conversation, and the background rides along in the draft so the first
   * screen is already theirs.
   */
  const finish = async () => {
    if (busy) return;
    setBusy(true);
    const content = [job, context]
      .map(value => value.trim())
      .filter(Boolean)
      .join("\n\n");
    let chatId: string | undefined;
    try {
      const chat = await createChat.mutateAsync({
        title: (job.trim() || "First job").slice(0, 48),
      });
      chatId = chat.id;
    } catch {
      chatId = undefined;
    }
    setBusy(false);
    markSeen();
    onFinish({ content, chatId });
  };

  const stepIndex = STEP_ORDER.indexOf(step);

  const header = {
    why: {
      kicker: "Why Nova",
      title: "An agent with a computer, not a chat box.",
      body: "Nova’s agent works in a real workspace — it can read and write your files, run a terminal, and keep routines going after you close the tab.",
      intentLabel: "Why it matters:",
      intent: "the next two steps build on this idea.",
    },
    job: {
      kicker: "Its first job",
      title: "What’s the first thing you want Nova to do?",
      body: "Say it in your own words — you can watch it work.",
      intentLabel: "What happens:",
      intent: "your answer becomes the first conversation in your workspace.",
    },
    context: {
      kicker: "The background",
      title: "What should Nova know about it?",
      body: "A sentence or two is plenty.",
      intentLabel: "What happens:",
      intent: "Nova reads it before it starts, so it begins in the right place.",
    },
  }[step];

  const primaryLabel =
    step === "why"
      ? "Give it a job"
      : step === "job"
        ? "Continue"
        : "Start the job";

  const primaryAction = () => {
    if (step === "why") return setStep("job");
    if (step === "job") {
      if (!job.trim()) return;
      return setStep("context");
    }
    return void finish();
  };

  const primaryDisabled = busy || (step === "job" && !job.trim());

  return (
    <Dialog
      open
      onOpenChange={nextOpen => {
        if (!nextOpen) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border-border bg-card p-6 sm:max-w-md sm:p-8"
      >
        <div className="flex justify-center">
          <NovaLogo size={30} />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <div
            className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={STEP_ORDER.length}
            aria-valuenow={stepIndex + 1}
            aria-label="Onboarding progress"
          >
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${((stepIndex + 1) / STEP_ORDER.length) * 100}%`,
              }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {stepIndex + 1} / {STEP_ORDER.length}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Close onboarding"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <X className="size-4" />
          </button>
        </div>

        <div key={step} className="chat-in mt-7">
          <DialogHeader className="max-w-[22rem]">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              {header.kicker}
            </p>
            <DialogTitle className="nova-display mt-3 text-[2rem] leading-[1.1] text-foreground">
              {header.title}
            </DialogTitle>
            <DialogDescription className="mt-3 text-sm leading-6 text-muted-foreground">
              {header.body}
            </DialogDescription>
            <p className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <span className="font-semibold text-foreground">
                  {header.intentLabel}
                </span>{" "}
                {header.intent}
              </span>
            </p>
          </DialogHeader>

          {step === "job" && (
            <>
              <textarea
                ref={jobInputRef}
                value={job}
                onChange={event => setJob(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (job.trim()) setStep("context");
                  }
                }}
                placeholder="e.g. Draft a launch plan for my app"
                rows={3}
                aria-label="The first thing you want Nova to do"
                className="mt-6 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-base leading-6 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/60"
              />
              {/* Nova's own starting points: one tap fills the job. */}
              <div className="mt-4 flex flex-wrap gap-2">
                {STARTER_JOBS.map(suggestion => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setJob(suggestion);
                      jobInputRef.current?.focus();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.06] px-3 py-1.5 text-start text-xs font-medium text-foreground transition hover:-translate-y-0.5 hover:border-primary/60 hover:bg-primary/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <Sparkles className="size-3 shrink-0 text-primary" />
                    {suggestion}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === "context" && (
            <textarea
              value={context}
              onChange={event => setContext(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void finish();
                }
              }}
              placeholder="e.g. It’s a daily planner for freelancers, launching next month"
              rows={3}
              aria-label="Background for Nova"
              className="mt-6 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-base leading-6 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/60"
            />
          )}
        </div>

        <div className="mt-8 space-y-3">
          <div className="flex items-center gap-2">
            {step !== "why" && (
              <button
                type="button"
                onClick={() =>
                  setStep(step === "context" ? "job" : "why")
                }
                aria-label="Previous step"
                className="grid size-11 place-items-center rounded-xl border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <ArrowLeft className="size-4 rtl:-scale-x-100" />
              </button>
            )}
            {step === "context" && (
              <button
                type="button"
                onClick={() => void finish()}
                disabled={busy}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                Skip
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={primaryAction}
            disabled={primaryDisabled}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {primaryLabel}
            {!busy && step !== "context" && (
              <ArrowRight className="size-4 rtl:-scale-x-100" />
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default OnboardingFlow;
