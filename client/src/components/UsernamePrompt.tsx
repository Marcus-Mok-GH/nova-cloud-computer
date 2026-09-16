import React from "react";
import { useState } from "react";
import { AtSign, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const claim = trpc.auth.setUsername.useMutation({
    onSuccess: updated => {
      utils.auth.me.setData(undefined, updated);
      toast.success(`Welcome, @${updated.username}! That username is yours.`);
      onClose();
    },
    onError: mutationError => setError(mutationError.message || "Could not set that username."),
  });

  const submit = () => {
    const username = value.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      setError("Usernames are 3-24 characters: lowercase letters, numbers, hyphens or underscores.");
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
          <DialogTitle className="text-left text-xl font-extrabold tracking-tight">Choose your username</DialogTitle>
          <DialogDescription className="text-left leading-6">
            Pick the name Nova knows you by across the app and in chats with your AI agent. You can change it later from your profile.
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
              aria-label="Username"
              className="lowercase"
              maxLength={24}
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="text-sm text-muted-foreground">3-24 characters: lowercase letters, numbers, hyphens or underscores.</p>
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onClose}>Skip for now</Button>
          <Button onClick={submit} disabled={claim.isPending} className="gap-2">
            {claim.isPending && <Loader2 size={15} className="animate-spin" />}
            Claim username
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
