import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ChevronRight, MessageSquareText, Plus, Sparkles } from "lucide-react";
import { useLocation } from "wouter";

export default function Chats() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const create = trpc.chats.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate() });
  return (
    <DashboardLayout>
      <section className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#f97316]">Conversation archive</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Chats</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">Every conversation stays with the private computer it helps you shape.</p>
          </div>
          <Button onClick={() => create.mutate({ title: "New workspace conversation" })} className="rounded-full bg-[#f97316] hover:bg-[#ea580c]"><Plus className="mr-1.5 size-4" />New chat</Button>
        </div>
        <div className="mt-8 space-y-2">
          {computer.data?.chats.length ? (
            computer.data.chats.map(chat => (
              <button key={chat.id} onClick={() => setLocation(`/app?chatId=${chat.id}`)} className="group flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:border-neutral-300 hover:shadow-sm dark:border-white/10 dark:bg-neutral-900 dark:hover:border-white/20">
                <span className="grid size-10 place-items-center rounded-xl bg-[#f97316]/10 text-[#f97316]"><MessageSquareText className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-bold text-neutral-900 dark:text-white">{chat.title}</h2>
                  <p className="mt-1 text-xs text-neutral-400">Open saved conversation</p>
                </div>
                <ChevronRight className="size-4 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-500 dark:text-neutral-600" />
              </button>
            ))
          ) : (
            <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-neutral-200 bg-white text-center dark:border-white/10 dark:bg-neutral-900">
              <div>
                <Sparkles className="mx-auto size-5 text-[#f97316]" />
                <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">Begin a conversation with Nova from your workspace.</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </DashboardLayout>
  );
}
