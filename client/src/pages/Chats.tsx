import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { ChevronRight, MessageSquareText, Sparkles, Trash2 } from "lucide-react";
import NewChatButton from "@/components/NewChatButton";
import { toast } from "sonner";
import { getNeonAccessToken } from "@/lib/neonAuth";
import { useLocation } from "wouter";

export default function Chats() {
  // Poll so a conversation started from Telegram shows up without a refresh.
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false, refetchInterval: 5000, refetchIntervalInBackground: false });
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const deleteChat = async (chatId: number, title: string) => {
    if (!window.confirm(`Delete “${title}”? This conversation and its messages will be permanently deleted.`)) return;
    setDeletingId(chatId);
    try {
      const token = await getNeonAccessToken().catch(() => null);
      const response = await fetch("/api/chat/delete", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ chatId }) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Could not delete chat");
      await utils.workspace.computer.invalidate();
      toast.success("Chat deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete chat");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <DashboardLayout>
      <section className="relative mx-auto max-w-3xl px-4 py-6 md:px-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-primary/[0.045] to-transparent dark:from-primary/[0.07]" />
        <div className="rise-in">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Conversation archive</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Chats</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground dark:text-muted-foreground">Every conversation stays with the private computer it helps you shape.</p>
        </div>
        <div className="mt-8 space-y-2">
          {computer.data?.chats.length ? computer.data.chats.map(chat => (
            <div key={chat.id} className="group flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_8px_24px_rgba(10,10,10,0.07)] dark:border-white/10 dark:bg-card dark:hover:border-white/20">
              <button onClick={() => setLocation(`/app?chatId=${chat.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><MessageSquareText className="size-4" /></span>
                <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-bold text-foreground dark:text-foreground">{chat.title}</h2><p className="mt-1 text-xs text-muted-foreground">Open saved conversation</p></div>
                <ChevronRight className="size-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-muted-foreground dark:text-muted-foreground" />
              </button>
              <button onClick={() => deleteChat(chat.id, chat.title)} disabled={deletingId === chat.id} className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-100 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-400" aria-label={`Delete ${chat.title}`} title="Delete chat"><Trash2 className="size-4" /></button>
            </div>
          )) : (
            <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-white/10 bg-card text-center dark:bg-[#141414]"><div><Sparkles className="mx-auto size-5 text-primary" /><p className="mt-3 text-sm text-muted-foreground dark:text-muted-foreground">Begin a conversation with Nova from your workspace.</p></div></div>
          )}
        </div>
        <NewChatButton />
      </section>
    </DashboardLayout>
  );
}
