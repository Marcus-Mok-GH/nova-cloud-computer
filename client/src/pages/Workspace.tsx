import DashboardLayout from "@/components/DashboardLayout";
import NovaMark from "@/components/NovaMark";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getNeonAccessToken } from "@/lib/neonAuth";
import { ArrowLeft, ArrowUp, CheckCircle2, CircleDashed, FileText, Folder, HardDrive, MessageSquareText, MoreHorizontal, Sparkles, Wrench, XCircle } from "lucide-react";
import React, { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { exchangeNeonVerifierAndGetJwt, neonAuth } from "@/lib/neonAuth";

type ToolActivity = { id: string; name: string; state: "running" | "completed" | "failed"; args: Record<string, string>; summary?: string };
const TOOL_ACTIVITY_MESSAGE_PREFIX = "__nova_tool_activity__:";

function parsePersistedToolActivity(content: string): ToolActivity | null {
  if (!content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(content.slice(TOOL_ACTIVITY_MESSAGE_PREFIX.length));
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.name !== "string") return null;
    if (parsed.state !== "running" && parsed.state !== "completed" && parsed.state !== "failed") return null;
    return { id: parsed.id, name: parsed.name, state: parsed.state, args: parsed.args && typeof parsed.args === "object" ? parsed.args : {}, summary: typeof parsed.summary === "string" ? parsed.summary : undefined };
  } catch { return null; }
}

export default function Workspace() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [draft, setDraft] = useState("");
  const [pendingUserContent, setPendingUserContent] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const chatId = typeof window === "undefined" ? undefined : Number(new URLSearchParams(window.location.search).get("chatId")) || undefined;
  const savedMessages = trpc.chats.messages.useQuery({ chatId: chatId ?? 1 }, { enabled: Boolean(chatId), retry: false });
  const agentVmStatus = trpc.agentVm.status.useQuery(undefined, { retry: false, refetchInterval: 5000 });
  const nvidiaStatus = trpc.nvidia.status.useQuery(undefined, { retry: false, refetchInterval: 30000 });
  const modelSettings = trpc.workspace.modelSettings.useQuery(undefined, { retry: false });
  const liveModels = trpc.nvidia.models.useQuery(undefined, { retry: false, refetchInterval: 300000 });
  const updateModel = trpc.workspace.updateSettings.useMutation({ onSuccess: async () => { await modelSettings.refetch(); toast.success("Model updated."); }, onError: error => toast.error(error.message) });
  const [selectedModel, setSelectedModel] = useState("");
  useEffect(() => { if (modelSettings.data?.activeProvider === "nvidia-nim" && modelSettings.data.activeModelId) setSelectedModel(modelSettings.data.activeModelId); }, [modelSettings.data?.activeProvider, modelSettings.data?.activeModelId]);

  useEffect(() => {
    if (typeof window === "undefined" || !neonAuth) return;
    const params = new URLSearchParams(window.location.search);
    const verifier = params.get("verifier");
    if (!verifier) return;
    void (async () => { try { const jwt = await exchangeNeonVerifierAndGetJwt(neonAuth); if (jwt) { params.delete("verifier"); window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`); setLocation("/app"); } } catch (err) { console.warn("[Workspace] Failed to exchange Neon verifier", err instanceof Error ? err.message : err); } })();
  }, []);

  const refreshMessages = async () => { await savedMessages.refetch(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || !chatId || isStreaming) return;
    const content = draft.trim(); setDraft(""); setPendingUserContent(content); setStreamingContent(""); setToolActivities([]); setIsStreaming(true);
    try {
      const token = await getNeonAccessToken().catch(() => null);
      const response = await fetch("/api/chat/stream", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ chatId, content }) });
      if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: unknown } | null; throw new Error(typeof payload?.error === "string" ? payload.error : "Nova could not start this response. Please retry shortly."); }
      const reader = response.body?.getReader(); if (!reader) throw new Error("Stream not supported");
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") { setStreamingContent(""); await refreshMessages(); await utils.workspace.computer.invalidate(); setPendingUserContent(""); setToolActivities([]); setIsStreaming(false); return; }
          try {
            const parsed = JSON.parse(data) as { type?: string; tool?: ToolActivity; choices?: Array<{ delta?: { content?: string } }> };
            if (parsed.type === "tool" && parsed.tool?.id) { setToolActivities(previous => { const index = previous.findIndex(activity => activity.id === parsed.tool?.id); if (index === -1) return [...previous, parsed.tool!]; const next = [...previous]; next[index] = { ...next[index], ...parsed.tool }; return next; }); continue; }
            setStreamingContent(prev => prev + (parsed.choices?.[0]?.delta?.content || ""));
          } catch { /* Ignore malformed stream fragments. */ }
        }
      }
      setIsStreaming(false); setStreamingContent(""); await refreshMessages(); setPendingUserContent(""); setToolActivities([]);
    } catch (error) { console.error("Stream error:", error); setStreamingContent(""); await refreshMessages(); setPendingUserContent(""); setToolActivities([]); setIsStreaming(false); toast.error(error instanceof Error ? error.message : "Failed to send message"); }
  };

  if (computer.isError) return <WorkspaceError onRetry={() => computer.refetch()} />;
  if (chatId) return (
    <DashboardLayout>
      <section className="flex h-[calc(100dvh-7.25rem)] w-full min-w-0 flex-col overflow-hidden border-0 bg-white shadow-none lg:h-[calc(100dvh-3.5rem)] dark:bg-neutral-900">
        <header className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-3 py-2.5 sm:px-5 sm:py-3.5 dark:border-white/5">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button onClick={() => setLocation("/app/chats")} className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white" aria-label="Back to chats"><ArrowLeft className="size-4" /></button>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316] sm:size-9"><MessageSquareText className="size-4" /></span>
            <div className="min-w-0"><p className="truncate text-sm font-bold tracking-tight">Nova conversation</p><p className="hidden text-xs text-neutral-400 sm:block">Private workspace context</p></div>
          </div>
          <MoreHorizontal className="size-4 shrink-0 text-neutral-400" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5 sm:py-6">
          <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col space-y-4">
            {savedMessages.isLoading ? <p className="text-sm text-neutral-400">Loading conversation...</p> : savedMessages.data?.map(message => {
              const persistedTool = message.role === "assistant" ? parsePersistedToolActivity(message.content) : null;
              if (persistedTool) return <div key={message.id} className="flex w-full shrink-0 min-w-0 items-start gap-2"><span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316]"><NovaMark size={12} /></span><div className="min-w-0 w-full max-w-[92%] sm:max-w-[85%]"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nova</p><ToolActivityPanel activities={[persistedTool]} /></div></div>;
              return message.role === "user" ? <div key={message.id} className="flex w-full shrink-0 justify-end"><div className="max-w-[92%] break-words rounded-2xl rounded-br-md bg-neutral-950 px-3.5 py-2.5 text-sm leading-6 text-white sm:max-w-[85%] sm:px-4 dark:bg-white dark:text-neutral-950">{message.content}</div></div> : <div key={message.id} className="flex w-full shrink-0 min-w-0 items-start gap-2"><span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316]"><NovaMark size={12} /></span><div className="min-w-0 max-w-[92%] sm:max-w-[85%]"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nova</p><div className="break-words rounded-2xl rounded-tl-md bg-neutral-100 px-3.5 py-2.5 text-sm leading-6 text-neutral-800 sm:px-4 dark:bg-neutral-800 dark:text-neutral-200">{message.content}</div></div></div>;
            })}
            {pendingUserContent && <div className="flex w-full shrink-0 justify-end"><div className="max-w-[92%] break-words rounded-2xl rounded-br-md bg-neutral-950 px-3.5 py-2.5 text-sm leading-6 text-white sm:max-w-[85%] sm:px-4 dark:bg-white dark:text-neutral-950">{pendingUserContent}</div></div>}
            {toolActivities.map(activity => <div key={activity.id} className="flex w-full shrink-0 min-w-0 items-start gap-2"><span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316]"><NovaMark size={12} /></span><div className="min-w-0 w-full max-w-[92%] sm:max-w-[85%]"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nova</p><ToolActivityPanel activities={[activity]} /></div></div>)}
            {isStreaming && <div className="flex w-full shrink-0 min-w-0 items-start gap-2"><span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316]"><NovaMark size={12} /></span><div className="min-w-0 max-w-[92%] sm:max-w-[85%]"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nova</p><div className="break-words rounded-2xl rounded-tl-md bg-neutral-100 px-3.5 py-2.5 text-sm leading-6 text-neutral-800 sm:px-4 dark:bg-neutral-800 dark:text-neutral-200">{streamingContent || "Nova is working..."}</div></div></div>}
          </div>
        </div>
        <form onSubmit={submit} className="shrink-0 border-t border-neutral-100 bg-white p-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:p-3 dark:border-white/5 dark:bg-neutral-900">
          <div className="mx-auto flex w-full max-w-3xl min-w-0 items-end gap-1.5 rounded-2xl border border-neutral-200 bg-[#fafafa] px-2.5 py-2 transition focus-within:border-[#f97316] focus-within:ring-4 focus-within:ring-[#f97316]/10 sm:items-center sm:gap-2 sm:rounded-full sm:px-4 sm:py-2 dark:border-white/10 dark:bg-neutral-950">
            <FileText className="mb-1 size-4 shrink-0 text-neutral-400 sm:mb-0" />
            <select aria-label="AI model" value={selectedModel} onChange={event => { const value = event.target.value; setSelectedModel(value); if (value) updateModel.mutate({ activeProvider: "nvidia-nim", activeModelId: value }); }} disabled={liveModels.isLoading || updateModel.isPending} className="w-[5.5rem] shrink-0 truncate rounded-lg border-0 bg-transparent px-0 text-[11px] text-neutral-500 outline-none sm:w-auto sm:max-w-40 sm:px-1 sm:text-xs dark:text-neutral-400"><option value="">Model</option>{liveModels.data?.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}</select>
            <Textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask Nova..." rows={1} className="max-h-28 min-h-9 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1.5 text-sm leading-5 placeholder:text-neutral-400 focus-visible:ring-0" />
            <button type="submit" disabled={!draft.trim() || isStreaming} className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f97316] text-white transition hover:bg-[#ea580c] disabled:opacity-40" aria-label="Go"><ArrowUp className="size-4" /></button>
          </div>
        </form>
      </section>
    </DashboardLayout>
  );

  const folders = computer.data?.folders ?? []; const files = computer.data?.files ?? []; const vm = agentVmStatus.data; const nvidia = nvidiaStatus.data; const isLoading = computer.isLoading;
  return <DashboardLayout><div className="mx-auto max-w-6xl p-4 sm:p-5 md:p-6"><header className="mb-6 sm:mb-8"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Your private computer</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-neutral-950 dark:text-white">Home</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">A quick view of your workspace and the services you have used.</p></header><section aria-label="Workspace statistics"><div className="mb-3 flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-[#f97316]/10 text-[#f97316]"><HardDrive className="size-3.5" /></span><h2 className="text-sm font-bold tracking-tight text-neutral-900 dark:text-white">Workspace</h2></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric value={isLoading ? "—" : folders.length} label="folders" icon={Folder} /><Metric value={isLoading ? "—" : files.length} label="files" icon={FileText} /><Metric value={isLoading ? "—" : `${nvidia?.allowance.usedRequests ?? 0}/${nvidia?.allowance.maxRequests ?? 0}`} label="NVIDIA requests used" icon={Sparkles} /><Metric value={isLoading ? "—" : `${vm?.allowance.usedRuns ?? 0}/${vm?.allowance.maxRuns ?? 0}`} label="VM runs used" icon={HardDrive} /></div></section></div></DashboardLayout>;
}

function ToolActivityPanel({ activities }: { activities: ToolActivity[] }) {
  return <details open className="w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm shadow-sm dark:border-white/10 dark:bg-neutral-950"><summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-neutral-800 marker:hidden dark:text-neutral-100"><Wrench className="size-3.5 shrink-0 text-[#f97316]" />Tool activity<span className="ml-auto text-xs font-medium text-neutral-400">{activities.length}</span></summary><div className="mt-2 space-y-2 border-t border-neutral-100 pt-2 dark:border-white/10">{activities.map(activity => { const StatusIcon = activity.state === "completed" ? CheckCircle2 : activity.state === "failed" ? XCircle : CircleDashed; const stateLabel = activity.state === "completed" ? "Completed" : activity.state === "failed" ? "Failed" : "Running"; const stateClass = activity.state === "completed" ? "text-emerald-600 dark:text-emerald-400" : activity.state === "failed" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"; return <div key={activity.id} className="min-w-0 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-white/5"><div className="flex min-w-0 items-center gap-2"><StatusIcon className={`size-3.5 shrink-0 ${stateClass}`} /><code className="min-w-0 break-all text-xs font-semibold text-neutral-700 dark:text-neutral-200">{activity.name}</code><span className={`ml-auto shrink-0 text-[11px] font-semibold ${stateClass}`}>{stateLabel}</span></div>{Object.keys(activity.args).length > 0 && <p className="mt-1 break-all font-mono text-[11px] text-neutral-500 dark:text-neutral-400">{Object.entries(activity.args).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>}{activity.summary && <p className="mt-1 break-words text-xs text-neutral-500 dark:text-neutral-400">{activity.summary}</p>}</div>; })}</div></details>;
}

function WorkspaceError({ onRetry }: { onRetry: () => void }) { return <DashboardLayout><div className="grid min-h-[65vh] place-items-center px-4 text-center"><div><NovaMark size={40} className="mx-auto" /><h1 className="mt-4 text-2xl font-extrabold tracking-tight">Nova could not open your computer.</h1><p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Your workspace remains private. Try reconnecting to your computer.</p><Button className="mt-5 rounded-full bg-[#f97316] hover:bg-[#ea580c]" onClick={onRetry}>Try again</Button></div></div></DashboardLayout>; }

function Metric({ value, label, icon: Icon }: { value: React.ReactNode; label: string; icon: React.ComponentType<{ className?: string }> }) { return <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_30px_rgba(10,10,10,0.04)] sm:p-5 dark:border-white/10 dark:bg-neutral-900"><Icon className="size-4 text-[#f97316]" /><p className="mt-6 text-3xl font-extrabold tracking-tight text-neutral-950 sm:mt-7 dark:text-white">{value}</p><p className="mt-1 text-xs text-neutral-400">{label}</p></div>; }
