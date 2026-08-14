import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { MessageSquareText, Plus, Sparkles } from "lucide-react";
import { useLocation } from "wouter";

export default function Chats() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const create = trpc.chats.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate() });
  return <DashboardLayout><section className="mx-auto max-w-4xl py-5"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-cyan-200/70">Conversation archive</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Chats</h1><p className="mt-2 max-w-xl text-sm leading-6 text-white/50">Every conversation stays with the private computer it helps you shape.</p></div><Button onClick={() => create.mutate({ title: "New workspace conversation" })} className="bg-cyan-300 text-slate-950 hover:bg-cyan-200"><Plus className="mr-1.5 size-4" />New chat</Button></div><div className="mt-8 space-y-2">{computer.data?.chats.length ? computer.data.chats.map(chat => <button key={chat.id} onClick={() => setLocation(`/app?chatId=${chat.id}`)} className="flex w-full items-center gap-3 rounded-2xl border border-white/9 bg-white/[.035] p-4 text-left transition hover:bg-white/[.07]"><span className="grid size-9 place-items-center rounded-xl bg-cyan-300/12 text-cyan-200"><MessageSquareText className="size-4" /></span><div><h2 className="text-sm font-medium text-white/85">{chat.title}</h2><p className="mt-1 text-xs text-white/40">Open saved conversation</p></div></button>) : <div className="grid min-h-72 place-items-center rounded-3xl border border-dashed border-white/12 bg-white/[.025] text-center"><div><Sparkles className="mx-auto size-5 text-cyan-200" /><p className="mt-3 text-sm text-white/60">Begin a conversation with Nova from your workspace.</p></div></div>}</div></section></DashboardLayout>;
}
