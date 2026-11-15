import React, { useMemo, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { languageForCountry } from "@shared/countries";
import { buildCountryOptions } from "@/lib/countryOptions";
import { useTranslation } from "@/contexts/LanguageContext";
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
 * One-shot follow-up for accounts that finished onboarding before the country
 * question existed (auth.onboarding's `needsCountry`): asks only for the
 * country, switches Nova's language to it, and marks the prompt answered so
 * it never comes back. Dismissing marks it seen too - each account is
 * prompted exactly once.
 */
export function CountryPromptModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const { locale, setLanguage } = useTranslation();
  const [country, setCountry] = useState("");
  const countryOptions = useMemo(() => buildCountryOptions(locale), [locale]);

  const save = trpc.auth.saveCountryPrompt.useMutation({
    onSuccess: (_data, variables) => {
      void utils.auth.onboarding.invalidate();
      if (variables.country) {
        const language = languageForCountry(variables.country);
        if (language) setLanguage(language);
      }
      onClose();
    },
    onError: error =>
      toast.error(error.message || "Could not save your country."),
  });

  // Any close counts as "asked": a dismissal marks the prompt seen, so the
  // account is never prompted again. Fire-and-forget - if the mark fails to
  // reach the server, the prompt simply shows again on the next sign-in.
  const dismiss = () => {
    if (!save.isPending) save.mutate({});
    onClose();
  };

  return (
    <Dialog open onOpenChange={open => !open && dismiss()}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-primary">
            <Globe size={16} />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em]">
              One quick question
            </span>
          </div>
          <DialogTitle>Which country are you in?</DialogTitle>
          <DialogDescription>
            Tell us which country you are in and we will switch Nova's language
            to the one that fits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-1">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">
              Your country
            </span>
            <select
              value={country}
              onChange={e => setCountry(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <option value="">Select your country</option>
              {countryOptions.map(option => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={dismiss} disabled={save.isPending}>
            Maybe later
          </Button>
          <Button
            onClick={() => save.mutate({ country: country || null })}
            disabled={save.isPending || !country}
            className="gap-2"
          >
            {save.isPending && <Loader2 size={15} className="animate-spin" />}
            Save & continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
