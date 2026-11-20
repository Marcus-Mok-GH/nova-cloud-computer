import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";

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

/** Page-travel timing, matched to the keyframes in index.css. */
const ENTER_MS = 420;
const OUT_MS = 160;
const IN_MS = 380;

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
 * The first-run flow, written for Nova and dressed in the system language of a
 * modern iOS app: a grouped background, a large title under a frosted nav bar,
 * hairline-separated cards for input, a page control, and a pinned action bar.
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
  // Page travel: anim runs enter -> out -> in -> idle, and dir says which way
  // the push went. The page node is never remounted, so the outgoing
  // animation is seen before the content swaps and the incoming one after.
  const [anim, setAnim] = useState<"enter" | "out" | "in" | "idle">("enter");
  const [dir, setDir] = useState<1 | -1>(1);
  const timers = useRef<number[]>([]);
  const createChat = trpc.chats.create.useMutation();
  const jobInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setAnim("idle"), ENTER_MS + 60);
    timers.current.push(id);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach(id => window.clearTimeout(id));
    },
    []
  );

  useEffect(() => {
    if (step === "job") jobInputRef.current?.focus();
  }, [step]);

  // On a phone the on-screen keyboard covers the bottom of the viewport; lift
  // the pinned action bar by the height the visual viewport loses while a
  // field is focused so the primary action stays reachable. The surface itself
  // stays full-screen and opaque - shrinking it would expose the page behind.
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

  /**
   * Move one page in the flow: the current page leaves first, then the next
   * one lands on the same node. Ignored while a travel is already running so
   * a double tap cannot queue two swaps.
   */
  const goTo = (next: Step) => {
    if (next === step || anim === "out") return;
    setDir(STEP_ORDER.indexOf(next) > stepIndex ? 1 : -1);
    setAnim("out");
    timers.current.push(
      window.setTimeout(() => {
        setStep(next);
        setAnim("in");
        timers.current.push(
          window.setTimeout(() => setAnim("idle"), IN_MS + 60)
        );
      }, OUT_MS)
    );
  };

  const pageAnim = [
    anim === "enter" ? "ios-enter" : "",
    anim === "out"
      ? dir === 1
        ? "ios-page-out-left"
        : "ios-page-out-right"
      : "",
    anim === "in"
      ? dir === 1
        ? "ios-page-in-right"
        : "ios-page-in-left"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const primaryLabel =
    step === "why"
      ? "Give it a job"
      : step === "job"
        ? "Continue"
        : "Start the job";

  const primaryAction = () => {
    if (step === "why") return goTo("job");
    if (step === "job") {
      if (!job.trim()) return;
      return goTo("context");
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
        className="fixed inset-0 z-50 block w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
      >
        <div className="ios-font ios-grouped relative flex h-full flex-col">
          {/* Frosted nav bar carrying the large title, as an iOS modal sheet. */}
          <header className="ios-glass ios-hairline relative z-20 shrink-0 border-b">
            <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-5">
              <button
                type="button"
                onClick={close}
                aria-label="Close onboarding"
                className="ios-fill ios-press grid size-9 shrink-0 place-items-center rounded-full text-black/70 dark:text-white/80"
              >
                <X className="size-4" />
              </button>
              <span className="ios-label-tertiary text-[13px] font-semibold tracking-wide tabular-nums">
                Step {stepIndex + 1} of {STEP_ORDER.length}
              </span>
            </div>
            <div className="mx-auto w-full max-w-4xl px-5 pb-3">
              <h1
                className={`${pageAnim} text-[32px] font-bold leading-[1.12] tracking-[-0.02em] sm:text-[34px]`}
              >
                {meta.title}
              </h1>
            </div>
          </header>

          <main className="relative flex-1 overflow-x-clip overflow-y-auto">
            <div
              className={`${pageAnim} mx-auto grid min-h-full w-full max-w-4xl gap-8 px-5 pb-32 pt-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:content-center lg:gap-12 lg:pt-6`}
              style={
                keyboardInset != null
                  ? { paddingBottom: `calc(${keyboardInset}px + 8rem)` }
                  : undefined
              }
            >
              <div className="flex flex-col gap-3.5 lg:self-stretch lg:justify-center">
                <p className="text-[13px] font-semibold uppercase tracking-[0.08em] ios-accent">
                  {meta.kicker}
                </p>
                <p className="ios-label-secondary text-[17px] leading-6">
                  {meta.body}
                </p>
                <p className="ios-label-tertiary text-[13px] leading-5">
                  {meta.intent}
                </p>

                {step === "job" && (
                  <>
                    <div className="ios-card mt-2 px-4 py-3 focus-within:ring-2 focus-within:ring-primary/40">
                      <textarea
                        ref={jobInputRef}
                        value={job}
                        onChange={event => setJob(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            if (job.trim()) goTo("context");
                          }
                        }}
                        placeholder="e.g. Draft a launch plan for my app"
                        rows={2}
                        aria-label="The first thing you want Nova to do"
                        className="w-full resize-none bg-transparent text-[17px] leading-6 text-current placeholder:text-[#C7C7CC] focus:outline-none dark:placeholder:text-[#636366]"
                      />
                    </div>
                    <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                          className="ios-press inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-3.5 py-2.5 text-left text-[13px] font-medium text-current hover:bg-black/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:bg-white/[0.07] dark:hover:bg-white/[0.11] sm:text-[14px]"
                        >
                          <Sparkles className="size-4 shrink-0 ios-accent" />
                          <span className="min-w-0 break-words">{suggestion}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {step === "context" && (
                  <div className="ios-card mt-2 px-4 py-3 focus-within:ring-2 focus-within:ring-primary/40">
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
                      className="w-full resize-none bg-transparent text-[17px] leading-6 text-current placeholder:text-[#C7C7CC] focus:outline-none dark:placeholder:text-[#636366]"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-center lg:self-stretch">
                <div className="ios-card overflow-hidden">
                  <img
                    src={meta.visual.src}
                    alt={meta.visual.alt}
                    loading="eager"
                    className="aspect-[1100/760] w-full object-cover"
                  />
                </div>
                <p className="ios-label-tertiary mt-3 text-center text-[13px]">
                  {meta.visual.caption}
                </p>
              </div>
            </div>
          </main>

          {/* Pinned action bar: page control, then the primary action. */}
          <footer
            className="ios-glass ios-hairline absolute inset-x-0 bottom-0 z-20 border-t"
            style={keyboardInset != null ? { bottom: keyboardInset } : undefined}
          >
            <div
              className="mx-auto w-full max-w-4xl px-5 pt-3"
              style={{ paddingBottom: "calc(14px + env(safe-area-inset-bottom))" }}
            >
              <div className="flex items-center justify-center gap-2">
                {STEP_ORDER.map((tourStep, index) => (
                  <span
                    key={tourStep}
                    aria-current={index === stepIndex ? "step" : undefined}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      index === stepIndex
                        ? "w-5 bg-primary"
                        : "w-2 bg-black/[0.12] dark:bg-white/[0.18]"
                    }`}
                  />
                ))}
              </div>
              {isLast && (
                <button
                  type="button"
                  onClick={() => void finish()}
                  disabled={busy}
                  className="ios-press mt-2 w-full rounded-full text-center text-[15px] font-medium text-primary disabled:opacity-40"
                >
                  Skip for now
                </button>
              )}
              <div className="mt-3 flex items-center gap-3">
                {step !== "why" && (
                  <button
                    type="button"
                    onClick={() => goTo(step === "context" ? "job" : "why")}
                    aria-label="Previous step"
                    className="ios-fill ios-press grid size-[50px] shrink-0 place-items-center rounded-full text-black/70 dark:text-white/80"
                  >
                    <ArrowLeft className="size-5 rtl:-scale-x-100" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={primaryAction}
                  disabled={primaryDisabled}
                  className="ios-press inline-flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-primary text-[17px] font-semibold text-primary-foreground shadow-sm disabled:cursor-not-allowed disabled:bg-black/[0.06] disabled:text-black/[0.30] disabled:shadow-none dark:disabled:bg-white/[0.08] dark:disabled:text-white/[0.35]"
                >
                  {busy && <Loader2 className="size-5 animate-spin" />}
                  {primaryLabel}
                  {!busy && !isLast && (
                    <ArrowRight className="size-5 rtl:-scale-x-100" />
                  )}
                </button>
              </div>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default OnboardingFlow;
