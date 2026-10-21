import React, { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Shown once for a brand-new account (or one that skipped onboarding) so we
 * learn a little about how they found us and what they want to do. Answers are
 * optional — skipping just leaves onboarding open to be asked again later.
 */
export function OnboardingModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [source, setSource] = useState("");
  const [useCase, setUseCase] = useState("");
  const [experience, setExperience] = useState("");

  const save = trpc.auth.saveOnboarding.useMutation({
    onSuccess: () => {
      void utils.auth.onboarding.invalidate();
      toast.success("Thanks — that helps us make Nova better for you.");
      onClose();
    },
    onError: error => toast.error(error.message || "Could not save your answers."),
  });

  const submit = (completed: boolean) => {
    save.mutate({
      source: source.trim() || null,
      useCase: useCase.trim() || null,
      experience: experience.trim() || null,
      completed,
    });
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-primary">
            <Sparkles size={16} />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em]">Welcome to Nova</span>
          </div>
          <DialogTitle>A few quick questions</DialogTitle>
          <DialogDescription>
            Tell us a little about yourself so we can make Nova more useful. Everything is optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">How did you hear about Nova?</span>
            <input
              value={source}
              onChange={e => setSource(e.target.value)}
              placeholder="A friend, X, a blog post…"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">What do you mainly want to use Nova for?</span>
            <input
              value={useCase}
              onChange={e => setUseCase(e.target.value)}
              placeholder="Writing, research, building something…"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">How familiar are you with AI tools?</span>
            <select
              value={experience}
              onChange={e => setExperience(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <option value="">Select one (optional)</option>
              <option value="new">New to this</option>
              <option value="some">I've used a few</option>
              <option value="comfortable">Pretty comfortable</option>
              <option value="power">Power user</option>
            </select>
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => submit(false)} disabled={save.isPending}>
            Skip for now
          </Button>
          <Button onClick={() => submit(true)} disabled={save.isPending} className="gap-2">
            {save.isPending && <Loader2 size={15} className="animate-spin" />}
            Save & continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
