/** Memory: shows that Nova keeps a memory of past work, lists what it has stored, and lets the user forget one or clear them all. */
import React, { useState } from "react";
import { Brain, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

/** "conversation" reads awkwardly as a label next to a note; keep it human. */
function kindLabel(kind: string) {
  return kind === "note" ? "Note" : "Conversation";
}

/**
 * Danger-zone card: shows every memory Nova has stored - the shared (default
 * Nova) memory as well as each personal agent's private memories - and lets
 * the user delete one at a time or clear all of them. Chats, files, and
 * settings are untouched.
 */
export default function MemoryCard() {
  const utils = trpc.useUtils();
  const memories = trpc.workspace.listMemories.useQuery(undefined, { retry: false });
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const records = memories.data ?? [];

  const deleteMemory = trpc.workspace.deleteMemory.useMutation({
    onSuccess: async () => {
      setDeletingId(null);
      await utils.workspace.listMemories.invalidate();
      toast.success("Memory forgotten.");
    },
    onError: error => {
      setDeletingId(null);
      toast.error(error.message || "That memory could not be deleted. Nothing was changed.");
    },
  });

  const clearMemories = trpc.workspace.clearMemories.useMutation({
    onSuccess: async result => {
      setOpen(false);
      setConfirmText("");
      await utils.workspace.listMemories.invalidate();
      toast.success(
        result.deletedMemories === 0
          ? "Nova had no stored memories to clear."
          : `Cleared ${plural(result.deletedMemories, "memory")}. Nova starts remembering from scratch.`
      );
    },
    onError: error => toast.error(error.message || "The memories could not be cleared. Nothing was changed."),
  });

  const forget = (id: number) => {
    if (!window.confirm("Forget this memory? Nova will not remember it in future work.")) return;
    setDeletingId(id);
    deleteMemory.mutate({ id });
  };

  return (
    <section className="rise-in rounded-2xl border border-red-500/20 bg-red-500/[0.03] p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-red-600">Memory</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">What Nova remembers</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Nova saves what it learns from your conversations and tasks so future work picks up where you left off. Forget any memory below, or clear all of it, including what each personal agent remembers. Your chats, files, and settings are kept.
          </p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 ring-1 ring-red-500/15">
          <Brain size={22} />
        </div>
      </div>
      <div className="mt-6 rounded-2xl border bg-muted/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold">Stored memories</p>
          {records.length > 0 && <p className="text-xs text-muted-foreground">{plural(records.length, "memory")} remembered</p>}
        </div>
        {memories.isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div>
        ) : memories.isError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
            <p className="text-xs text-muted-foreground">Your memories could not be loaded right now.</p>
            <Button variant="outline" size="sm" onClick={() => memories.refetch()} disabled={memories.isFetching}>{memories.isFetching && <Loader2 size={15} className="animate-spin" />} Try again</Button>
          </div>
        ) : records.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed bg-muted/10 p-4 text-xs text-muted-foreground">Nova has not stored any memories yet. It will start remembering as you chat.</p>
        ) : (
          <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
            {records.map(record => (
              <li key={record.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-background/60 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-bold">{record.title}</p>
                    <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{kindLabel(record.kind)}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{record.summary}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/80">Updated {new Date(record.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Forget ${record.title}`} onClick={() => forget(record.id)} disabled={deleteMemory.isPending} className="shrink-0 text-muted-foreground hover:text-destructive">
                  {deletingId === record.id && deleteMemory.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
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
