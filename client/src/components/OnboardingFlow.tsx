import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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

const STEP_META: Record<
  Step,
  {
    label: string;
    kicker: string;
    title: string;
    body: string;
    intent: string;
    visual: { src: string; alt: string; caption: string };
  }
> = {
  why: {
    label: "Why Nova",
    kicker: "Why Nova",
    title: "An agent with a computer, not a chat box.",
    body: "It reads and writes your files, runs a terminal, and keeps routines going after you close the tab.",
    intent: "Why it matters: the next two steps build on this.",
    visual: {
      src: "/landing/workspace-home.png",
      alt: "Nova's workspace with files, a terminal, and connected tools.",
      caption: "One workspace for files, chats, and routines.",
    },
  },
  job: {
    label: "Its first job",
    kicker: "Its first job",
    title: "What’s the first thing you want Nova to do?",
    body: "Say it in your own words — Nova starts there, and you can watch it work.",
    intent: "What happens: your answer becomes the first conversation in your workspace.",
    visual: {
      src: "/landing/workspace-chat.png",
      alt: "A Nova conversation in progress.",
      caption: "A conversation that does the work, not just discusses it.",
    },
  },
  context: {
    label: "The background",
    kicker: "The background",
    title: "What should Nova know about it?",
    body: "A sentence or two is plenty.",
    intent: "What happens: Nova reads it before it starts, so it begins in the right place.",
    visual: {
      src: "/landing/workspace-automations.png",
      alt: "Nova's scheduled automations with their run history.",
      caption: "Routines that keep running after you close the tab.",
    },
  },
};

/**
 * The first-run flow, written for Nova rather than borrowed from another
 * product: a full-screen first-run moment that opens with what makes Nova
 * different, shows the real workspace, then gets the visitor's first job.
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

  // On a phone the on-screen keyboard covers the bottom of the viewport; lift
  // the surface by the height the visual viewport loses while a field is
  // focused so the field being typed into stays visible.
  const [keyboardInset, setKeyboardInset] = useState<number | null>(null);
  useEffect(() => {
    const mobile = window.matchMedia?.("(max-width: 639px)");
    const visual = window.visualViewport;
    if (!mobile || !visual) return;
    const update = () => {
      if (!mobile.matches) {
        setKeyboardInset(null);
        return;
      }
      const hidden = window.innerHeight - visual.height - visual.offsetTop;
      setKeyboardInset(hidden > 0 ? hidden : null);
    };
    update();
    mobile.addEventListener("change", update);
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    return () => {
      mobile.removeEventListener("change", update);
      visual.removeEventListener("resize", update);
      visual.removeEventListener("scroll", update);
    };
  }, []);

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

  const meta = STEP_META[step];
  const stepIndex = STEP_ORDER.indexOf(step);
  const isLast = step === "context";

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
        style={keyboardInset != null ? { bottom: keyboardInset } : undefined}
        className="fixed inset-0 z-50 block w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-background p-0 sm:max-w-none"
      >
        <div className="chat-editorial-shell relative h-full overflow-x-clip overflow-y-auto">
          <div className="pointer-events-none absolute -right-40 -top-48 size-[34rem] rounded-full border border-primary/[0.12] dark:border-primary/[0.16]" />
          <div className="pointer-events-none absolute -bottom-72 -left-56 size-[32rem] rounded-full border border-foreground/[0.06] dark:border-white/[0.07]" />

          <div className="relative z-10 mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-4 sm:px-10 sm:py-6 lg:py-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <NovaLogo size={28} />
                <span className="text-[15px] font-extrabold tracking-tight text-foreground">
                  Nova
                </span>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close onboarding"
                className="grid size-10 place-items-center rounded-xl border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-8 py-6 lg:grid lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:items-stretch lg:gap-14 lg:py-12">
              <div className="flex flex-col gap-8 max-lg:text-center lg:self-stretch lg:justify-center">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                    {meta.kicker}
                  </p>
                  <h1
                    key={step}
                    className="nova-display rise-in mt-4 max-w-xl text-[clamp(1.8rem,4vw,3.2rem)] leading-[1.06] tracking-[-0.03em] text-foreground max-lg:mx-auto"
                  >
                    {meta.title}
                  </h1>
                  <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground max-lg:mx-auto">
                    {meta.body}
                  </p>
                  <p className="mt-3 inline-flex items-start gap-2 text-start text-xs font-medium leading-5 text-muted-foreground">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    {meta.intent}
                  </p>
                </div>

                <div>
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
                        rows={2}
                        aria-label="The first thing you want Nova to do"
                        className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-base leading-6 text-foreground shadow-[0_10px_35px_rgba(36,40,34,0.08)] placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/60"
                      />
                      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-start lg:justify-start">
                        {STARTER_JOBS.filter(
                          suggestion => suggestion !== job.trim()
                        ).map(suggestion => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => {
                              setJob(suggestion);
                              jobInputRef.current?.focus();
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.06] px-3 py-1.5 text-start text-[11px] font-medium text-foreground transition hover:-translate-y-0.5 hover:border-primary/60 hover:bg-primary/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:px-3.5 sm:py-2 sm:text-xs"
                          >
                            <Sparkles className="size-3 shrink-0 text-primary" />
                            <span className="min-w-0 break-words">{suggestion}</span>
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
                      rows={2}
                      aria-label="Background for Nova"
                      className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-base leading-6 text-foreground shadow-[0_10px_35px_rgba(36,40,34,0.08)] placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/60"
                    />
                  )}

                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3 lg:justify-start lg:mt-8">
                    {step !== "why" && (
                      <button
                        type="button"
                        onClick={() =>
                          setStep(step === "context" ? "job" : "why")
                        }
                        aria-label="Previous step"
                        className="grid size-12 place-items-center rounded-2xl border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <ArrowLeft className="size-4 rtl:-scale-x-100" />
                      </button>
                    )}
                    {isLast && (
                      <button
                        type="button"
                        onClick={() => void finish()}
                        disabled={busy}
                        className="rounded-2xl px-5 py-3 text-sm font-semibold text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        Skip
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={primaryAction}
                      disabled={primaryDisabled}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-7 py-4 text-base font-semibold text-primary-foreground shadow-[0_14px_35px_rgba(130,70,35,0.28)] transition hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-[0_18px_40px_rgba(130,70,35,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:bg-foreground/[0.12] disabled:text-muted-foreground/70 disabled:opacity-60 disabled:shadow-none sm:w-auto"
                    >
                      {busy && <Loader2 className="size-4 animate-spin" />}
                      {primaryLabel}
                      {!busy && !isLast && (
                        <ArrowRight className="size-4 rtl:-scale-x-100" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-center lg:self-stretch">
                <div
                  key={`visual-${step}`}
                  className="rise-in mx-auto w-full max-w-2xl"
                >
                  <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-[0_24px_80px_rgba(36,40,34,0.14)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
                    <img
                      src={meta.visual.src}
                      alt={meta.visual.alt}
                      loading="eager"
                      className="aspect-[1100/760] w-full object-cover"
                    />
                  </div>
                  <p className="mt-3 text-center text-xs font-medium text-muted-foreground">
                    {meta.visual.caption}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 pb-1 sm:gap-3">
              {STEP_ORDER.map((tourStep, index) => {
                const active = index === stepIndex;
                const done = index < stepIndex;
                return (
                  <div
                    key={tourStep}
                    className="flex items-center gap-2 sm:gap-3"
                  >
                    {index > 0 && (
                      <span
                        className={`h-px w-6 sm:w-10 ${done || active ? "bg-primary/60" : "bg-foreground/15"}`}
                      />
                    )}
                    <span
                      className={`grid size-6 place-items-center rounded-full border text-[10px] font-bold transition-colors ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : done
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-foreground/15 text-muted-foreground"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span
                      className={`hidden text-xs font-semibold sm:inline ${
                        active ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {STEP_META[tourStep].label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default OnboardingFlow;
