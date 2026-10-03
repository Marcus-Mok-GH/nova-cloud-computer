/** Memory: shows that Nova keeps a memory of past work and lets the user erase all of it. */
import React, { useState } from "react";
import { Brain, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

/**
 * Danger-zone card: clear every memory Nova has stored. This covers the
 * shared (default Nova) memory as well as each personal agent's private
 * memory. Chats, files, and settings are untouched.
 */
export default function MemoryCard() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const clearMemories = trpc.workspace.clearMemories.useMutation({
    onSuccess: result => {
      setOpen(false);
      setConfirmText("");
      toast.success(
        result.deletedMemories === 0
          ? "Nova had no stored memories to clear."
          : `Cleared ${plural(result.deletedMemories, "memory")}. Nova starts remembering from scratch.`
      );
    },
    onError: error => toast.error(error.message || "The memories could not be cleared. Nothing was changed."),
  });
  return (
    <section className="rise-in rounded-2xl border border-red-500/20 bg-red-500/[0.03] p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-red-600">Memory</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">What Nova remembers</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Nova saves what it learns from your conversations and tasks so future work picks up where you left off. Clearing memory erases all of it, including what each personal agent remembers. Your chats, files, and settings are kept.
          </p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 ring-1 ring-red-500/15">
          <Brain size={22} />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <div>
          <p className="text-sm font-bold text-red-600">Clear all memory</p>
          <p className="text-xs text-muted-foreground">This cannot be undone. Nova forgets every memory it has stored; your chats are kept.</p>
        </div>
        <AlertDialog
          open={open}
          onOpenChange={next => {
            setOpen(next);
            if (!next) setConfirmText("");
          }}
        >
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="gap-2">
              <Trash2 size={16} /> Clear memory
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all of Nova's memory?</AlertDialogTitle>
              <AlertDialogDescription>Every stored memory will be permanently deleted, including the shared memories and each agent's private ones. Type CLEAR to confirm.</AlertDialogDescription>
            </AlertDialogHeader>
            <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder='Type "CLEAR" to confirm' />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearMemories.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirmText !== "CLEAR" || clearMemories.isPending}
                onClick={e => {
                  e.preventDefault();
                  clearMemories.mutate({ confirm: confirmText });
                }}
              >
                {clearMemories.isPending && <Loader2 size={15} className="animate-spin" />} Clear memory
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}
