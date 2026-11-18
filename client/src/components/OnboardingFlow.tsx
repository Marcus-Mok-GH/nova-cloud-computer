import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
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

type Step = "why" | "first" | "more";
const STEP_ORDER: readonly Step[] = ["why", "first", "more"];

export type OnboardingStep = Step;

/**
 * The first-run flow, modelled on the reference onboarding: it does NOT walk
 * the visitor through a feature tour. It opens with why Nova works, then gets
 * them to state one real task, then offers a brain dump - so the workspace
 * they land on already belongs to them instead of being a blank box.
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
  const [first, setFirst] = useState("");
  const [more, setMore] = useState("");
  const [busy, setBusy] = useState(false);
  const createChat = trpc.chats.create.useMutation();
  const firstInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (step === "first") firstInputRef.current?.focus();
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
   * Hand the captured work to the workspace: the first task titles a real
   * conversation, and everything the visitor wrote rides along as the draft
   * so the first screen is already theirs.
   */
  const finish = async () => {
    if (busy) return;
    setBusy(true);
    const tasks = [first, ...more.split("\n")]
      .map(line => line.trim())
      .filter(Boolean);
    const content = tasks.join("\n");
    let chatId: string | undefined;
    try {
      const chat = await createChat.mutateAsync({
        title: (tasks[0] || "First task").slice(0, 48),
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
      kicker: "Why Nova works",
      title: "Your AI shouldn’t just talk. It should work.",
      body: "Most AI tools are a blank box that forgets everything. Nova gives its agent a computer — your files, your terminal, your routines — so a task actually gets finished, not just discussed.",
    },
    first: {
      kicker: "Your first task",
      title: "What’s one thing you’ve been putting off?",
      body: "One thing is enough. Nova will start there.",
    },
    more: {
      kicker: "Brain dump",
      title: "Anything else on your mind?",
      body: "Dump it all — sort it out later. Skip it if there’s nothing.",
    },
  }[step];

  const primaryLabel =
    step === "why" ? "Let’s put it to work" : step === "first" ? "Add it" : "Add and open Nova";

  const primaryAction = () => {
    if (step === "why") return setStep("first");
    if (step === "first") {
      if (!first.trim()) return;
      return setStep("more");
    }
    return void finish();
  };

  const primaryDisabled =
    busy || (step === "first" && !first.trim());

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
          </DialogHeader>

          {step === "first" && (
            <textarea
              ref={firstInputRef}
              value={first}
              onChange={event => setFirst(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (first.trim()) setStep("more");
                }
              }}
              placeholder="e.g. Plan launch week, tidy the inbox, write the launch post"
              rows={3}
              aria-label="Your first task"
              className="mt-6 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-base leading-6 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/60"
            />
          )}

          {step === "more" && (
            <textarea
              value={more}
              onChange={event => setMore(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void finish();
                }
              }}
              placeholder="A few more things Nova should know about…"
              rows={3}
              aria-label="Anything else on your mind"
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
                  setStep(step === "more" ? "first" : "why")
                }
                aria-label="Previous step"
                className="grid size-11 place-items-center rounded-xl border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <ArrowLeft className="size-4 rtl:-scale-x-100" />
              </button>
            )}
            {step === "more" && (
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
            {!busy && step !== "more" && (
              <ArrowRight className="size-4 rtl:-scale-x-100" />
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default OnboardingFlow;
