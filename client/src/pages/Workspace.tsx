import DashboardLayout from "@/components/DashboardLayout";
import NovaMark from "@/components/NovaMark";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getNeonAccessToken } from "@/lib/neonAuth";
import { parsePersistedToolActivity, reconcileChatMessages, type ToolActivity } from "@/lib/chatMessages";
import { Activity, AlertTriangle, ArrowLeft, ArrowUp, BarChart3, Bot, CheckCircle2, CircleDashed, Clock3, Cloud, Database, FileText, Folder, HardDrive, MessageSquareText, Rocket, Server, TrendingUp, Wrench, XCircle } from "lucide-react";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { NVIDIA_UNAVAILABLE_MESSAGE } from "@shared/const";
import { exchangeNeonVerifierAndGetJwt, neonAuth } from "@/lib/neonAuth";

export default function Workspace() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [draft, setDraft] = useState("");
  const [pendingUserContent, setPendingUserContent] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [baselineMessageId, setBaselineMessageId] = useState(0);
  const chatId = typeof window === "undefined" ? undefined : Number(new URLSearchParams(window.location.search).get("chatId")) || undefined;
  const savedMessages = trpc.chats.messages.useQuery({ chatId: chatId ?? 1 }, { enabled: Boolean(chatId), retry: false, refetchOnWindowFocus: false });
  const agentVmStatus = trpc.agentVm.status.useQuery(undefined, { retry: false, refetchInterval: 5000 });
  const dashboard = trpc.workspace.dashboard.useQuery(undefined, { retry: false });
  const agentRuns = trpc.agentVm.list.useQuery(undefined, { retry: false });
  const automations = trpc.automations.list.useQuery(undefined, { retry: false });
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const handleChatScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 120;
  };

  useEffect(() => {
    userScrolledUpRef.current = false;
  }, [chatId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [chatId, savedMessages.data?.length, streamingContent, toolActivities, isStreaming]);

  const isUnavailableReply = (content: string) => content === NVIDIA_UNAVAILABLE_MESSAGE;

  useEffect(() => {
    if (typeof window === "undefined" || !neonAuth) return;
    const params = new URLSearchParams(window.location.search);
    const verifier = params.get("verifier");
    if (!verifier) return;
    void (async () => { try { const jwt = await exchangeNeonVerifierAndGetJwt(neonAuth); if (jwt) { params.delete("verifier"); window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`); setLocation("/app"); } } catch (err) { console.warn("[Workspace] Failed to exchange Neon verifier", err instanceof Error ? err.message : err); } })();
  }, []);

  const refreshMessages = async (): Promise<boolean> => { try { await savedMessages.refetch(); return true; } catch { return false; } };
  const finalizeStream = async () => {
    let refreshed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      refreshed = await refreshMessages();
      if (refreshed) break;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
    if (refreshed) {
      setIsStreaming(false);
      setPendingUserContent("");
      setStreamingContent("");
      setToolActivities([]);
    } else {
      setIsStreaming(false);
      toast.error("Nova replied, but it could not be reloaded yet. Please wait a moment before sending again.");
    }
    return refreshed;
  };
  const submit = async (event: FormEvent | React.KeyboardEvent) => {
    event.preventDefault();
    if (!draft.trim() || !chatId || isStreaming) return;
    userScrolledUpRef.current = false;
    const content = draft.trim(); setDraft(""); const toPersist = savedMessages.data ?? []; setBaselineMessageId(toPersist.length ? Math.max(...toPersist.map(message => message.id)) : 0); setPendingUserContent(content); setStreamingContent(""); setToolActivities([]); setIsStreaming(true);
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
          if (data === "[DONE]") { await finalizeStream(); await utils.workspace.computer.invalidate(); return; }
          try {
            const parsed = JSON.parse(data) as { type?: string; tool?: ToolActivity; choices?: Array<{ delta?: { content?: string } }> };
            if (parsed.type === "tool" && parsed.tool?.id) { setToolActivities(previous => { const index = previous.findIndex(activity => activity.id === parsed.tool?.id); if (index === -1) return [...previous, parsed.tool!]; const next = [...previous]; next[index] = { ...next[index], ...parsed.tool }; return next; }); continue; }
            setStreamingContent(prev => prev + (parsed.choices?.[0]?.delta?.content || ""));
          } catch { /* Ignore malformed stream fragments. */ }
        }
      }
      await finalizeStream();
    } catch (error) { console.error("Stream error:", error); toast.error(error instanceof Error ? error.message : "Failed to send message"); await finalizeStream(); }
  };

  if (computer.isError) return <WorkspaceError onRetry={() => computer.refetch()} />;
  if (chatId) {
    const persisted = savedMessages.data ?? [];
    const { userCommitted, replyCommitted, liveActivities } = reconcileChatMessages(persisted, baselineMessageId, pendingUserContent, streamingContent, toolActivities);
    const lastPersistedRole = persisted.length ? persisted[persisted.length - 1].role : null;
    const pendingBubbleRendered = Boolean(pendingUserContent) && !userCommitted;
    const liveLabel = (index: number) =>
      index === 0 ? (pendingBubbleRendered ? true : lastPersistedRole === "user" || lastPersistedRole === null) : false;
    const streamingLabel = liveActivities.length > 0 ? false : pendingBubbleRendered ? true : lastPersistedRole === "user" || lastPersistedRole === null;
    return (
    <DashboardLayout>
      <section className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-0 bg-white shadow-none dark:bg-neutral-900">
        <header className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-3 py-2.5 sm:px-5 sm:py-3.5 dark:border-white/5">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button onClick={() => setLocation("/app/chats")} className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white" aria-label="Back to chats"><ArrowLeft className="size-4" /></button>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[oklch(0.60_0.02_250/0.10)] text-[oklch(0.72_0.015_250)] sm:size-9"><MessageSquareText className="size-4" /></span>
            <div className="min-w-0"><p className="truncate text-sm font-bold tracking-tight">Nova conversation</p><p className="hidden text-xs text-neutral-400 sm:block">Private workspace context</p></div>
          </div>
        </header>
        <div ref={scrollRef} onScroll={handleChatScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5 sm:py-6">
          <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col space-y-4">
            {savedMessages.isLoading ? <p className="text-sm text-neutral-400">Loading conversation...</p> : persisted.map((message, index) => {
              const persistedTool = message.role === "assistant" ? parsePersistedToolActivity(message.content) : null;
              const showLabel = index === 0 || persisted[index - 1].role === "user";
              if (persistedTool) return <div key={message.id} className="flex w-full shrink-0 min-w-0 items-start gap-2"><span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[oklch(0.60_0.02_250/0.10)] text-[oklch(0.72_0.015_250)]"><NovaMark size={12} /></span><div className="min-w-0 max-w-[92%] sm:max-w-[85%]">{showLabel && <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nova App</p>}<ToolActivityPanel activities={[persistedTool]} /></div></div>;
              if (message.role === "user") return <div key={message.id} className="flex w-full shrink-0 justify-end"><div className="max-w-[92%] break-words rounded-2xl rounded-br-md bg-neutral-950 px-3.5 py-2.5 text-sm leading-6 text-white sm:max-w-[85%] sm:px-4 dark:bg-white dark:text-neutral-950">{message.content}</div></div>;
              return <div key={message.id} className="flex w-full shrink-0 min-w-0 items-start gap-2"><span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[oklch(0.60_0.02_250/0.10)] text-[oklch(0.72_0.015_250)]"><NovaMark size={12} /></span><div className="min-w-0 max-w-[92%] sm:max-w-[85%]">{showLabel && <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nova App</p>}{isUnavailableReply(message.content) ? <div data-testid="assistant-error" className="flex items-start gap-2 break-words rounded-2xl rounded-tl-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm leading-6 text-red-700 sm:px-4 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Nova is offline</p><span>{message.content}</span></div></div> : <div className="break-words rounded-2xl rounded-tl-md bg-neutral-100 px-3.5 py-2.5 text-sm leading-6 text-neutral-800 sm:px-4 dark:bg-neutral-800 dark:text-neutral-200">{message.content}</div>}</div></div>;
            })}
            {pendingUserContent && !userCommitted && <div className="flex w-full shrink-0 justify-end"><div className="max-w-[92%] break-words rounded-2xl rounded-br-md bg-neutral-950 px-3.5 py-2.5 text-sm leading-6 text-white sm:max-w-[85%] sm:px-4 dark:bg-white dark:text-neutral-950">{pendingUserContent}</div></div>}
            {liveActivities.map((activity, index) => <div key={activity.id} className="flex w-full shrink-0 min-w-0 items-start gap-2"><span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[oklch(0.60_0.02_250/0.10)] text-[oklch(0.72_0.015_250)]"><NovaMark size={12} /></span><div className="min-w-0 max-w-[92%] sm:max-w-[85%]">{liveLabel(index) && <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nova App</p>}<ToolActivityPanel activities={[activity]} /></div></div>)}
            {isStreaming && !replyCommitted && <div className="flex w-full shrink-0 min-w-0 items-start gap-2"><span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[oklch(0.60_0.02_250/0.10)] text-[oklch(0.72_0.015_250)]"><NovaMark size={12} /></span><div className="min-w-0 max-w-[92%] sm:max-w-[85%]">{streamingLabel && <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nova App</p>}{isUnavailableReply(streamingContent) ? <div data-testid="assistant-error" className="flex items-start gap-2 break-words rounded-2xl rounded-tl-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm leading-6 text-red-700 sm:px-4 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Nova is offline</p><span>{streamingContent}</span></div></div> : streamingContent ? <div className="break-words rounded-2xl rounded-tl-md bg-neutral-100 px-3.5 py-2.5 text-sm leading-6 text-neutral-800 sm:px-4 dark:bg-neutral-800 dark:text-neutral-200">{streamingContent}</div> : <TypingIndicator />}</div></div>}
          </div>
        </div>
        <form onSubmit={submit} className="shrink-0 border-t border-neutral-100 bg-white p-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:p-3 dark:border-white/5 dark:bg-neutral-900">
          <div className="mx-auto flex w-full max-w-3xl min-w-0 items-end gap-1.5 rounded-2xl border border-neutral-200 bg-[#fafafa] px-2.5 py-2 transition focus-within:border-[oklch(0.60_0.02_250)] focus-within:ring-4 focus-within:ring-[oklch(0.60_0.02_250/0.10)] sm:items-center sm:gap-2 sm:rounded-full sm:px-4 sm:py-2 dark:border-white/10 dark:bg-neutral-950">
            <FileText className="mb-1 size-4 shrink-0 text-neutral-400 sm:mb-0" />
            <Textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit(event);
                }
              }}
              placeholder="Ask Nova..."
              rows={1}
              className="max-h-28 min-h-9 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1.5 text-sm leading-5 placeholder:text-neutral-400 focus-visible:ring-0"
            />
            <button type="submit" disabled={!draft.trim() || isStreaming} className="grid size-9 shrink-0 place-items-center rounded-full bg-[oklch(0.60_0.02_250)] text-white transition hover:bg-[oklch(0.54_0.025_250)] disabled:opacity-40" aria-label="Go"><ArrowUp className="size-4" /></button>
          </div>
        </form>
      </section>
    </DashboardLayout>
    );
  }

  const folders = computer.data?.folders ?? [];
  const files = computer.data?.files ?? [];
  const chats = computer.data?.chats ?? [];
  const vm = agentVmStatus.data;
  const projects = dashboard.data?.projects ?? [];
  const tasks = dashboard.data?.tasks ?? [];
  const runs = agentRuns.data ?? [];
  const automationRows = automations.data ?? [];
  const isLoading = computer.isLoading || dashboard.isLoading;
  const completedTasks = tasks.filter(task => task.status === "done").length;
  const completedRuns = runs.filter(run => run.status === "completed").length;
  const failedRuns = runs.filter(run => run.status === "failed").length;
  const totalTrackedWork = tasks.length + runs.length;
  const completionRate = totalTrackedWork ? Math.round(((completedTasks + completedRuns) / totalTrackedWork) * 100) : 0;
  const activeAutomations = automationRows.filter(automation => automation.enabled).length;
  const recentActivity = [
    ...runs.map(run => ({ icon: Bot, title: run.task, detail: "Agent VM · " + run.status, time: run.createdAt, tone: "bg-blue-500/10 text-blue-700 dark:text-blue-400" })),
    ...chats.map(chat => ({ icon: MessageSquareText, title: chat.title, detail: "Conversation updated", time: chat.updatedAt, tone: "bg-violet-500/10 text-violet-700 dark:text-violet-400" })),
    ...projects.map(project => ({ icon: Folder, title: project.name, detail: "Project created", time: project.createdAt, tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 6);
  const dailyActivity = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - index));
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const count = [...chats, ...runs, ...tasks].filter(item => {
      const createdAt = new Date(item.createdAt).getTime();
      return createdAt >= day.getTime() && createdAt < nextDay.getTime();
    }).length;
    return { label: day.toLocaleDateString(undefined, { weekday: "short" }), count };
  });
  const maxDailyActivity = Math.max(...dailyActivity.map(day => day.count), 1);
  const formatDate = (value: Date | string | null | undefined) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
  const sandboxStatus = vm?.sandbox.status ?? "unavailable";
  const isWorkspaceReady = sandboxStatus === "active" || sandboxStatus === "sleeping";
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl p-4 sm:p-5 md:p-6">
        <header className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[oklch(0.72_0.015_250)]">Workspace intelligence</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-neutral-950 dark:text-white">Analytics</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">A live view of your Nova computer, agent work, conversations, and workspace health.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setLocation("/app/chats")} className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-xs font-bold text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-white/10"><MessageSquareText className="size-3.5" />Open conversations</button>
            <button type="button" onClick={() => setLocation("/app/files")} className="inline-flex items-center gap-2 rounded-xl bg-[oklch(0.60_0.02_250)] px-3.5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[oklch(0.54_0.025_250)]"><Folder className="size-3.5" />Browse workspace</button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workspace analytics summary">
          <AnalyticsMetric label="Conversations" value={isLoading ? "—" : chats.length} note="saved in this computer" icon={MessageSquareText} tone="violet" />
          <AnalyticsMetric label="Tracked work" value={isLoading ? "—" : totalTrackedWork} note={completionRate + "% completed"} icon={TrendingUp} tone="blue" />
          <AnalyticsMetric label="Workspace assets" value={isLoading ? "—" : files.length + folders.length} note={files.length + " files · " + folders.length + " folders"} icon={Database} tone="amber" />
          <AnalyticsMetric label="Agent VM runs" value={isLoading ? "—" : runs.length} note={failedRuns ? failedRuns + " need attention" : "no failed runs"} icon={Bot} tone={failedRuns ? "red" : "emerald"} />
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
          <article className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-[0_12px_30px_rgba(10,10,10,0.04)] sm:p-6 dark:border-white/10 dark:bg-neutral-900">
            <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400"><BarChart3 className="size-4" /></span><h2 className="text-sm font-bold">Activity overview</h2></div><p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Workspace events over the last seven days</p></div><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold text-neutral-500 dark:bg-white/10 dark:text-neutral-300">Live data</span></div>
            <div className="mt-7 flex h-44 items-end gap-2 sm:gap-4">{dailyActivity.map(day => <div key={day.label} className="flex min-w-0 flex-1 flex-col items-center gap-2"><span className="text-[10px] font-bold text-neutral-400">{day.count}</span><div className="flex h-32 w-full items-end rounded-lg bg-neutral-100 px-1.5 dark:bg-white/5"><div className="w-full rounded-md bg-[oklch(0.60_0.02_250)] transition-all" style={{ height: (day.count / maxDailyActivity) * 100 + "%", minHeight: day.count ? "8px" : "2px" }} /></div><span className="text-[10px] font-semibold text-neutral-400">{day.label}</span></div>)}</div>
          </article>
          <article className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-[0_12px_30px_rgba(10,10,10,0.04)] sm:p-6 dark:border-white/10 dark:bg-neutral-900">
            <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><Activity className="size-4" /></span><h2 className="text-sm font-bold">System health</h2></div>
            <div className="mt-5 space-y-4"><HealthRow icon={Cloud} label="Persistent workspace" value={isWorkspaceReady ? sandboxStatus : "Unavailable"} good={isWorkspaceReady} /><HealthRow icon={Server} label="Agent provider" value={vm?.provider ?? "—"} good={Boolean(vm?.configured)} /><HealthRow icon={Rocket} label="Automations" value={activeAutomations + " active"} good={activeAutomations > 0 || automationRows.length === 0} /><HealthRow icon={HardDrive} label="Current model" value={dashboard.data?.settings?.activeModelId ?? "Default"} good /></div>
            <button type="button" onClick={() => setLocation("/app/deployments")} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 py-2.5 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10">View deployment status <Rocket className="size-3.5" /></button>
          </article>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <article className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-[0_12px_30px_rgba(10,10,10,0.04)] dark:border-white/10 dark:bg-neutral-900">
            <div className="flex items-start justify-between gap-4 p-5 sm:p-6"><div><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400"><Clock3 className="size-4" /></span><h2 className="text-sm font-bold">Recent activity</h2></div><p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">The latest changes across your private computer</p></div><button type="button" onClick={() => setLocation("/app/chats")} className="text-xs font-bold text-[oklch(0.60_0.02_250)] hover:underline">View chats</button></div>
            <div className="divide-y divide-neutral-100 border-t border-neutral-100 dark:divide-white/10 dark:border-white/10">{recentActivity.length ? recentActivity.map((item, index) => { const Icon = item.icon; return <div key={item.title + index} className="flex items-center gap-3 px-5 py-3.5 sm:px-6"><span className={"grid size-8 shrink-0 place-items-center rounded-lg " + item.tone}><Icon className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-neutral-800 dark:text-neutral-100">{item.title}</p><p className="mt-0.5 text-[11px] text-neutral-400">{item.detail}</p></div><span className="shrink-0 text-[10px] font-semibold text-neutral-400">{formatDate(item.time)}</span></div>; }) : <div className="px-5 py-10 text-center text-xs text-neutral-400 sm:px-6">Your workspace activity will appear here.</div>}</div>
          </article>
          <article className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-[0_12px_30px_rgba(10,10,10,0.04)] sm:p-6 dark:border-white/10 dark:bg-neutral-900">
            <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400"><Bot className="size-4" /></span><h2 className="text-sm font-bold">Agent performance</h2></div><p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Execution outcomes from your VM</p></div><span className="text-2xl font-extrabold tracking-tight text-neutral-950 dark:text-white">{completedRuns}</span></div>
            <div className="mt-6 space-y-4"><ProgressRow label="Completed runs" value={completedRuns} total={Math.max(runs.length, 1)} tone="bg-emerald-500" /><ProgressRow label="Failed runs" value={failedRuns} total={Math.max(runs.length, 1)} tone="bg-red-500" /><ProgressRow label="Active automations" value={activeAutomations} total={Math.max(automationRows.length, 1)} tone="bg-amber-500" /><ProgressRow label="Completed tasks" value={completedTasks} total={Math.max(tasks.length, 1)} tone="bg-blue-500" /></div>
            <div className="mt-6 grid grid-cols-2 gap-2"><MiniStat label="Projects" value={projects.length} /><MiniStat label="Tasks" value={tasks.length} /><MiniStat label="Files" value={files.length} /><MiniStat label="Folders" value={folders.length} /></div>
          </article>
        </section>

        <section className="mt-5 rounded-2xl bg-neutral-950 p-5 text-white sm:p-7 dark:bg-white/[0.08]"><div className="flex flex-col justify-between gap-5 md:flex-row md:items-center"><div><div className="flex items-center gap-2 text-blue-300"><TrendingUp className="size-4" /><span className="text-[11px] font-bold uppercase tracking-[0.14em]">Keep building</span></div><h2 className="mt-2 text-xl font-extrabold tracking-tight">Your computer is ready for the next task.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-neutral-300">Start a conversation with Nova or inspect the files and automations behind your workspace.</p></div><button type="button" onClick={() => setLocation("/app/chats")} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-bold text-neutral-950 transition hover:bg-blue-50">Start a conversation <ArrowUp className="size-3.5" /></button></div></section>
      </div>
    </DashboardLayout>
  );
}


export function TypingIndicator() {
  return (
    <div data-testid="typing-indicator" className="flex items-center gap-1.5 break-words rounded-2xl rounded-tl-md bg-neutral-100 px-3.5 py-3 sm:px-4 dark:bg-neutral-800" aria-label="Nova is typing">
      {[0, 1, 2].map(index => <span key={index} className="typing-dot size-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />)}
    </div>
  );
}

function ToolActivityPanel({ activities }: { activities: ToolActivity[] }) {
  return <details open className="w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm shadow-sm dark:border-white/10 dark:bg-neutral-950"><summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-neutral-800 marker:hidden dark:text-neutral-100"><Wrench className="size-3.5 shrink-0 text-[oklch(0.72_0.015_250)]" />Tool activity<span className="ml-auto text-xs font-medium text-neutral-400">{activities.length}</span></summary><div className="mt-2 space-y-2 border-t border-neutral-100 pt-2 dark:border-white/10">{activities.map(activity => { const StatusIcon = activity.state === "completed" ? CheckCircle2 : activity.state === "failed" ? XCircle : CircleDashed; const stateLabel = activity.state === "completed" ? "Completed" : activity.state === "failed" ? "Failed" : "Running"; const stateClass = activity.state === "completed" ? "text-emerald-600 dark:text-emerald-400" : activity.state === "failed" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"; return <div key={activity.id} className="min-w-0 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-white/5"><div className="flex min-w-0 items-center gap-2"><StatusIcon className={`size-3.5 shrink-0 ${stateClass}`} /><code className="min-w-0 break-all text-xs font-semibold text-neutral-700 dark:text-neutral-200">{activity.name}</code><span className={`ml-auto shrink-0 text-[11px] font-semibold ${stateClass}`}>{stateLabel}</span></div>{Object.keys(activity.args).length > 0 && <p className="mt-1 break-all font-mono text-[11px] text-neutral-500 dark:text-neutral-400">{Object.entries(activity.args).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>}{activity.summary && <p className="mt-1 break-words text-xs text-neutral-500 dark:text-neutral-400">{activity.summary}</p>}</div>; })}</div></details>;
}

function WorkspaceError({ onRetry }: { onRetry: () => void }) { return <DashboardLayout><div className="grid min-h-[65vh] place-items-center px-4 text-center"><div><NovaMark size={40} className="mx-auto" /><h1 className="mt-4 text-2xl font-extrabold tracking-tight">Nova could not open your computer.</h1><p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Your workspace remains private. Try reconnecting to your computer.</p><Button className="mt-5 rounded-full bg-[oklch(0.60_0.02_250)] hover:bg-[oklch(0.54_0.025_250)]" onClick={onRetry}>Try again</Button></div></div></DashboardLayout>; }


function AnalyticsMetric({ label, value, note, icon: Icon, tone }: { label: string; value: React.ReactNode; note: string; icon: React.ComponentType<{ className?: string }>; tone: "violet" | "blue" | "amber" | "emerald" | "red" }) {
  const tones = { violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400", blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400", amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400", emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", red: "bg-red-500/10 text-red-600 dark:text-red-400" };
  return <article className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-[0_12px_30px_rgba(10,10,10,0.04)] dark:border-white/10 dark:bg-neutral-900"><div className={"grid size-9 place-items-center rounded-xl " + tones[tone]}><Icon className="size-4" /></div><p className="mt-5 text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p><p className="mt-1 text-3xl font-extrabold tracking-tight text-neutral-950 dark:text-white">{value}</p><p className="mt-1 text-xs text-neutral-400">{note}</p></article>;
}

function HealthRow({ icon: Icon, label, value, good }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; good: boolean }) {
  return <div className="flex items-center gap-3"><span className={"grid size-8 place-items-center rounded-lg " + (good ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400")}><Icon className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-neutral-700 dark:text-neutral-200">{label}</span><span className="block truncate text-[11px] text-neutral-400">{value}</span></span><span className={"size-2 rounded-full " + (good ? "bg-emerald-500" : "bg-amber-500")} /></div>;
}

function ProgressRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const percentage = Math.min(Math.round((value / Math.max(total, 1)) * 100), 100);
  return <div><div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-semibold text-neutral-600 dark:text-neutral-300">{label}</span><span className="font-bold text-neutral-400">{value}</span></div><div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-white/10"><div className={"h-full rounded-full " + tone} style={{ width: percentage + "%" }} /></div></div>;
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-neutral-50 p-3 dark:bg-white/5"><p className="text-lg font-extrabold text-neutral-900 dark:text-white">{value}</p><p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">{label}</p></div>;
}

function Metric({ value, label, icon: Icon }: { value: React.ReactNode; label: string; icon: React.ComponentType<{ className?: string }> }) { return <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_30px_rgba(10,10,10,0.04)] sm:p-5 dark:border-white/10 dark:bg-neutral-900"><Icon className="size-4 text-[oklch(0.72_0.015_250)]" /><p className="mt-6 text-3xl font-extrabold tracking-tight text-neutral-950 sm:mt-7 dark:text-white">{value}</p><p className="mt-1 text-xs text-neutral-400">{label}</p></div>; }
