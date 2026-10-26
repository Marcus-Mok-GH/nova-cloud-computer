import React from "react";
import { useState } from "react";
import { AtSign, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PromptUser = { id: number; username: string | null; email: string | null };

const USERNAME_PATTERN = /^[a-z0-9_-]{3,24}$/;

/** One-time prompt that asks an account to claim its app-wide username.
 * Shown automatically for brand-new accounts and for existing accounts that
 * have not picked a username yet. */
export function UsernamePrompt({ user, onClose }: { user: PromptUser; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const claim = trpc.auth.setUsername.useMutation({
    onSuccess: updated => {
      utils.auth.me.setData(undefined, updated);
      toast.success(t("username.claimed", { username: updated.username ?? "" }));
      onClose();
    },
    onError: mutationError => setError(mutationError.message || t("username.error")),
  });

  const submit = () => {
    const username = value.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      setError(t("username.hint"));
      return;
    }
    setError(null);
    claim.mutate({ username });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <AtSign size={20} />
          </div>
          <DialogTitle className="text-start text-xl font-extrabold tracking-tight">{t("username.title")}</DialogTitle>
          <DialogDescription className="text-start leading-6">
            {t("username.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-muted-foreground">@</span>
            <Input
              value={value}
              onChange={event => { setValue(event.target.value); setError(null); }}
              onKeyDown={event => { if (event.key === "Enter") submit(); }}
              placeholder="your-name"
              autoFocus
              aria-label={t("username.aria")}
              className="lowercase"
              maxLength={24}
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("username.hint")}</p>
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onClose}>{t("username.skip")}</Button>
          <Button onClick={submit} disabled={claim.isPending} className="gap-2">
            {claim.isPending && <Loader2 size={15} className="animate-spin" />}
            {t("username.claim")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
