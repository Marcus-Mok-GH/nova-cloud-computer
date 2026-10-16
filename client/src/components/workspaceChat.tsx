/**
 * Presentation pieces of the workspace chat screen, extracted from
 * pages/Workspace.tsx: the image attachment tray, the per-message action
 * buttons (copy, regenerate, speak), the typing indicator and the error
 * screen. Pure rendering - the chat state and streaming loop stay in the
 * page component.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Check,
  CircleDashed,
  Copy,
  RefreshCw,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/DashboardLayout";
import NovaLogo from "@/components/NovaLogo";
import {
  speakMessage,
  stopAllSpeech,
  stripMarkdownForSpeech,
  TTS_START_EVENT,
  TTS_STOP_EVENT,
} from "@/lib/speech";
import type { ChatImageAttachment } from "@/lib/imageAttachments";

/** Thumbnail strip of the images queued for the next message. */
export function ImageAttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: ChatImageAttachment[];
  onRemove: (id: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {attachments.map(attachment => (
        <div
          key={attachment.id}
          className="relative size-16 overflow-hidden rounded-lg border border-foreground/[0.12] bg-muted/40 dark:border-white/[0.12]"
        >
          <img
            src={attachment.dataUri}
            alt={attachment.name}
            className="size-full object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.name}`}
            className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/65 text-white transition hover:bg-black/85"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Copies one chat message to the clipboard. The label flips to "Copied" for a
 * couple of seconds so the action is confirmed in place instead of with a toast
 * that would cover the thread.
 */
export function CopyMessageButton({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  const copy = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy that message.");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? "Message copied" : "Copy message"}
      className={`inline-flex shrink-0 items-center gap-1.5 border border-foreground/[0.12] bg-background/70 px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-foreground dark:border-white/[0.12] dark:hover:border-primary/50 ${className}`}
    >
      {copied ? (
        <Check className="size-3 text-emerald-500" />
      ) : (
        <Copy className="size-3" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Regenerates the thread from one message. Opens a confirmation first: on
 * confirm the history from the anchor onwards is permanently removed and
 * Nova generates a fresh reply.
 */
export function RegenerateMessageButton({
  disabled = false,
  pending = false,
  className = "",
  onConfirm,
}: {
  disabled?: boolean;
  pending?: boolean;
  className?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => {
          if (!disabled && !pending) setOpen(true);
        }}
        disabled={disabled || pending}
        aria-label="Regenerate from here"
        title="Regenerate from here"
        className={`inline-flex shrink-0 items-center gap-1.5 border border-foreground/[0.12] bg-background/70 px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.12] dark:hover:border-primary/50 ${className}`}
      >
        <RefreshCw className="size-3" />
        {pending ? "Working…" : "Regenerate"}
      </button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Regenerate from here?</AlertDialogTitle>
          <AlertDialogDescription>
            History will be reverted until that point. This message and every
            message after it will be permanently removed, then Nova will
            generate a new reply. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirming}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={confirming} onClick={() => void handleConfirm()}>
            {confirming ? "Regenerating…" : "Revert & regenerate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Reads a chat message aloud - the browser's own free speech synthesis when it
 * has a voice to speak with, otherwise a server-synthesised voice (also free,
 * no key). Toggles to Stop while speaking; starting another message stops the
 * current one.
 */
export function SpeakMessageButton({
  text,
  disabled = false,
  className = "",
}: {
  text: string;
  disabled?: boolean;
  className?: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  // Bumped by every toggle and by another button starting, so a request that
  // resolves after its run was superseded never updates this button again.
  const runIdRef = useRef(0);

  useEffect(() => {
    const handleStart = () => {
      // A newer speak() call cancels this one; drop the stale stop handle
      // so unmounting this button cannot cut off the new message.
      runIdRef.current += 1;
      stopRef.current = null;
      setSpeaking(false);
    };
    const handleStop = () => {
      runIdRef.current += 1;
      stopRef.current = null;
      setSpeaking(false);
    };
    window.addEventListener(TTS_START_EVENT, handleStart);
    window.addEventListener(TTS_STOP_EVENT, handleStop);
    return () => {
      window.removeEventListener(TTS_START_EVENT, handleStart);
      window.removeEventListener(TTS_STOP_EVENT, handleStop);
    };
  }, []);

  useEffect(
    () => () => {
      runIdRef.current += 1;
      stopRef.current?.();
      stopRef.current = null;
    },
    []
  );

  const toggle = async () => {
    if (disabled) return;
    if (speaking) {
      stopAllSpeech();
      stopRef.current = null;
      runIdRef.current += 1;
      setSpeaking(false);
      return;
    }
    const clean = stripMarkdownForSpeech(text);
    if (!clean) {
      toast.error("There is nothing to read aloud in that message.");
      return;
    }
    runIdRef.current += 1;
    const runId = runIdRef.current;
    setSpeaking(true);
    // Choosing an engine may wait on the browser's voice list, so the stop
    // handle arrives asynchronously: a toggle that lands first wins.
    const stop = await speakMessage(clean, {
      onEnd: () => {
        if (runId !== runIdRef.current) return;
        stopRef.current = null;
        setSpeaking(false);
      },
      onError: () => {
        if (runId !== runIdRef.current) return;
        stopRef.current = null;
        setSpeaking(false);
        toast.error("Could not read that message aloud.");
      },
    });
    if (runId !== runIdRef.current) {
      // The user stopped, or another button started a message, while the
      // request was in flight.
      stop();
      return;
    }
    stopRef.current = stop;
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-label={speaking ? "Stop reading" : "Read message aloud"}
      aria-pressed={speaking}
      className={`inline-flex shrink-0 items-center gap-1.5 border border-foreground/[0.12] bg-background/70 px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.12] dark:hover:border-primary/50 ${className}`}
    >
      {speaking ? (
        <Square className="size-3 fill-current" />
      ) : (
        <Volume2 className="size-3" />
      )}
      {speaking ? "Stop" : "Read aloud"}
    </button>
  );
}

export function TypingIndicator() {
  return (
    <span
      data-testid="typing-indicator"
      role="status"
      aria-live="polite"
      aria-label="Working"
      className="inline-flex items-center text-muted-foreground"
    >
      <CircleDashed className="size-4 animate-spin" />
    </span>
  );
}

export function WorkspaceError({ onRetry }: { onRetry: () => void }) {
  return (
    <DashboardLayout>
      <div className="grid min-h-[65vh] place-items-center px-4 text-center">
        <div>
          <NovaLogo size={40} className="mx-auto" />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
            Nova could not open your computer.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
            Your workspace remains private. Try reconnecting to your computer.
          </p>
          <Button
            className="mt-5 rounded-full bg-primary hover:bg-primary/90"
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}