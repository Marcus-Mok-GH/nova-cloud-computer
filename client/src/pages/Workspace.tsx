import DashboardLayout from "@/components/DashboardLayout";
import NovaMark from "@/components/NovaMark";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  FileText,
  Folder,
  HardDrive,
  MessageSquareText,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import React, { FormEvent, useState } from "react";
import { useLocation } from "wouter";

export default function Workspace() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [draft, setDraft] = useState("");
  const chatId = typeof window === "undefined" ? undefined : Number(new URLSearchParams(window.location.search).get("chatId")) || undefined;
  const savedMessages = trpc.chats.messages.useQuery({ chatId: chatId ?? 1 }, { enabled: Boolean(chatId), retry: false });
  const agentVmStatus = trpc.agentVm.status.useQuery(undefined, { retry: false, refetchInterval: 5000 });
  const nvidiaStatus = trpc.nvidia.status.useQuery(undefined, { retry: false, refetchInterval: 30000 });

  const send = trpc.chats.send.useMutation({
    onSuccess: result => {
      utils.workspace.computer.invalidate();
      utils.chats.messages.invalidate({ chatId: result.chatId });
    },
    onError: error => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || !chatId) return;
    send.mutate({ chatId, content: draft.trim() });
    setDraft("");
  };

  if (computer.isError) return <WorkspaceError onRetry={() => computer.refetch()} />;

  if (chatId) {
    return (
      <DashboardLayout>
        <section className="mx-auto flex h-[calc(100vh-6.5rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_50px_rgba(10,10,10,0.06)] lg:h-[calc(100vh-3rem)] dark:border-white/10 dark:bg-neutral-900">
          <header className="flex items-center justify-between border-b border-neutral-100 px-5 py-3.5 dark:border-white/5">
            <div className="flex items-center gap-3">
              <button onClick={() => setLocation("/app/chats")} className="grid size-8 place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white" aria-label="Back to chats"><ArrowLeft className="size-4" /></button>
              <span className="grid size-9 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316]"><MessageSquareText className="size-4" /></span>
              <div>
                <p className="text-sm font-bold tracking-tight">Nova conversation</p>
                <p className="text-xs text-neutral-400">Private workspace context</p>
              </div>
            </div>
            <MoreHorizontal className="size-4 text-neutral-400" />
          </header>
          <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 self-end">
              {savedMessages.isLoading ? (
                <p className="text-sm text-neutral-400">Loading conversation…</p>
              ) : (
                savedMessages.data?.map(message => (
                  message.role === "user" ? (
                    <div key={message.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-neutral-950 px-4 py-2.5 text-sm leading-6 text-white dark:bg-white dark:text-neutral-950">{message.content}</div>
                  ) : (
                    <div key={message.id} className="flex items-start gap-2.5">
                      <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316]"><NovaMark size={12} /></span>
                      <div className="max-w-[85%]">
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nova App</p>
                        <div className="rounded-2xl rounded-tl-md bg-neutral-100 px-4 py-2.5 text-sm leading-6 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">{message.content}</div>
                      </div>
                    </div>
                  )
                ))
              )}
              {send.isPending && <div className="flex items-start gap-2.5"><span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316]"><NovaMark size={12} /></span><div className="rounded-2xl rounded-tl-md bg-neutral-100 px-4 py-2.5 text-sm text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Nova is working…</div></div>}
            </div>
          </div>
          <form onSubmit={submit} className="border-t border-neutral-100 bg-white p-3 dark:border-white/5 dark:bg-neutral-900">
            <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-[#fafafa] px-4 py-2 transition focus-within:border-[#f97316] focus-within:ring-4 focus-within:ring-[#f97316]/10 dark:border-white/10 dark:bg-neutral-950">
              <FileText className="size-4 shrink-0 text-neutral-400" />
              <Textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask Nova…" className="min-h-9 flex-1 resize-none border-0 bg-transparent px-0 py-1.5 text-sm placeholder:text-neutral-400 focus-visible:ring-0" />
              <span className="hidden items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 ring-1 ring-neutral-200 sm:inline-flex dark:bg-neutral-900 dark:text-neutral-200 dark:ring-white/10">Claude <ChevronDown className="size-3" /></span>
              <button type="submit" disabled={!draft.trim() || send.isPending} className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f97316] text-white transition hover:bg-[#ea580c] disabled:opacity-40" aria-label="Go"><ArrowUp className="size-4" /></button>
            </div>
          </form>
        </section>
      </DashboardLayout>
    );
  }

  const folders = computer.data?.folders ?? [];
  const files = computer.data?.files ?? [];
  const vm = agentVmStatus.data;
  const nvidia = nvidiaStatus.data;
  const isLoading = computer.isLoading;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <header className="mb-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Your private computer</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-neutral-950 dark:text-white">Home</h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">A quick view of your workspace and the services you have used.</p>
        </header>

        <section aria-label="Workspace statistics">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-[#f97316]/10 text-[#f97316]"><HardDrive className="size-3.5" /></span>
            <h2 className="text-sm font-bold tracking-tight text-neutral-900 dark:text-white">Workspace</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric value={isLoading ? "—" : folders.length} label="folders" icon={Folder} />
            <Metric value={isLoading ? "—" : files.length} label="files" icon={FileText} />
            <Metric value={isLoading ? "—" : `${nvidia?.allowance.usedRequests ?? 0}/${nvidia?.allowance.maxRequests ?? 0}`} label="NVIDIA requests used" icon={Sparkles} />
            <Metric value={isLoading ? "—" : `${vm?.allowance.usedRuns ?? 0}/${vm?.allowance.maxRuns ?? 0}`} label="VM runs used" icon={HardDrive} />
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

function WorkspaceError({ onRetry }: { onRetry: () => void }) {
  return <DashboardLayout><div className="grid min-h-[65vh] place-items-center text-center"><div><NovaMark size={40} className="mx-auto" /><h1 className="mt-4 text-2xl font-extrabold tracking-tight">Nova could not open your computer.</h1><p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Your workspace remains private. Try reconnecting to your computer.</p><Button className="mt-5 rounded-full bg-[#f97316] hover:bg-[#ea580c]" onClick={onRetry}>Try again</Button></div></div></DashboardLayout>;
}

function Metric({ value, label, icon: Icon }: { value: React.ReactNode; label: string; icon: React.ComponentType<{ className?: string }> }) {
  return <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_12px_30px_rgba(10,10,10,0.04)] dark:border-white/10 dark:bg-neutral-900"><Icon className="size-4 text-[#f97316]" /><p className="mt-7 text-3xl font-extrabold tracking-tight text-neutral-950 dark:text-white">{value}</p><p className="mt-1 text-xs text-neutral-400">{label}</p></div>;
}
