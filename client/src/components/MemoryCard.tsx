/** Memory: shows that Nova keeps a memory of past work, lists what it has stored, and lets the user forget one or clear them all. */
import React, { useState } from "react";
import { Brain, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";

/**
 * Danger-zone card: shows every memory Nova has stored - the shared (default
 * Nova) memory as well as each personal agent's private memories - and lets
 * the user delete one at a time or clear all of them. Chats, files, and
 * settings are untouched.
 */
export default function MemoryCard() {
  const utils = trpc.useUtils();
  const { t, tPlural, locale } = useTranslation();
  const memories = trpc.workspace.listMemories.useQuery(undefined, { retry: false });
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const records = memories.data ?? [];

  const deleteMemory = trpc.workspace.deleteMemory.useMutation({
    onSuccess: async () => {
      setDeletingId(null);
      await utils.workspace.listMemories.invalidate();
      toast.success(t("settings.memory.forget.success"));
    },
    onError: error => {
      setDeletingId(null);
      toast.error(error.message || t("settings.memory.forget.error"));
    },
  });

  const clearMemories = trpc.workspace.clearMemories.useMutation({
    onSuccess: async result => {
      setOpen(false);
      setConfirmText("");
      await utils.workspace.listMemories.invalidate();
      toast.success(
        result.deletedMemories === 0
          ? t("settings.memory.clear.success.none")
          : tPlural("settings.memory.clear.success.one", "settings.memory.clear.success.other", result.deletedMemories)
      );
    },
    onError: error => toast.error(error.message || t("settings.memory.clear.error")),
  });

  const forget = (id: number) => {
    if (!window.confirm(t("settings.memory.forget.confirm"))) return;
    setDeletingId(id);
    deleteMemory.mutate({ id });
  };

  /** "conversation" reads awkwardly as a label next to a note; keep it human. */
  const kindLabel = (kind: string) =>
    kind === "note" ? t("settings.memory.kind.note") : t("settings.memory.kind.conversation");

  return (
    <section className="rise-in rounded-2xl border border-red-500/20 bg-red-500/[0.03] p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-red-600">{t("settings.memory.eyebrow")}</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.memory.title")}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("settings.memory.body")}
          </p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 ring-1 ring-red-500/15">
          <Brain size={22} />
        </div>
      </div>
      <div className="mt-6 rounded-2xl border bg-muted/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold">{t("settings.memory.stored")}</p>
          {records.length > 0 && <p className="text-xs text-muted-foreground">{tPlural("settings.memory.count.one", "settings.memory.count.other", records.length)}</p>}
        </div>
        {memories.isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div>
        ) : memories.isError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
            <p className="text-xs text-muted-foreground">{t("settings.memory.loadError")}</p>
            <Button variant="outline" size="sm" onClick={() => memories.refetch()} disabled={memories.isFetching}>{memories.isFetching && <Loader2 size={15} className="animate-spin" />} {t("common.tryAgain")}</Button>
          </div>
        ) : records.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed bg-muted/10 p-4 text-xs text-muted-foreground">{t("settings.memory.empty")}</p>
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
                  <p className="mt-1 text-[11px] text-muted-foreground/80">{t("settings.memory.updated", { date: new Date(record.updatedAt).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) })}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label={t("settings.memory.forget.aria", { title: record.title })} onClick={() => forget(record.id)} disabled={deleteMemory.isPending} className="shrink-0 text-muted-foreground hover:text-destructive">
                  {deletingId === record.id && deleteMemory.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <div>
          <p className="text-sm font-bold text-red-600">{t("settings.memory.clear.title")}</p>
          <p className="text-xs text-muted-foreground">{t("settings.memory.clear.body")}</p>
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
              <Trash2 size={16} /> {t("settings.memory.clear.button")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("settings.memory.clear.dialogTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("settings.memory.clear.dialogBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={t("settings.memory.clear.placeholder")} />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearMemories.isPending}>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirmText !== "CLEAR" || clearMemories.isPending}
                onClick={e => {
                  e.preventDefault();
                  clearMemories.mutate({ confirm: confirmText });
                }}
              >
                {clearMemories.isPending && <Loader2 size={15} className="animate-spin" />} {t("settings.memory.clear.button")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}
