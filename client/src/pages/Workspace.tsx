import DashboardLayout from "@/components/DashboardLayout";
import NovaLogo from "@/components/NovaLogo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getNeonAccessToken } from "@/lib/neonAuth";
import { MarkdownText } from "@/lib/markdown";
import { ToolActivityLine, ToolActivityPanel, isPanelToolActivity } from "@/lib/toolActivityLine";
import { dedupeToolActivityMessages, isInternalChatMessage, mergeToolActivity, parsePersistedToolActivity, reconcileChatMessages, type ToolActivity } from "@/lib/chatMessages";
import { Activity, AlertTriangle, ArrowLeft, ArrowUp, CheckCircle2, CircleDashed, FileText, Github, Mail, MessageSquareText, Send, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { MISTRAL_UNAVAILABLE_PREFIX } from "@shared/const";
import { exchangeNeonVerifierAndGetJwt, neonAuth } from "@/lib/neonAuth";

export default function Workspace() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [draft, setDraft] = useState("");
  const [startPrompt, setStartPrompt] = useState("");
  const [pendingUserContent, setPendingUserContent] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [baselineMessageId, setBaselineMessageId] = useState(0);
  const chatId = typeof window === "undefined" ? undefined : Number(new URLSearchParams(window.location.search).get("chatId")) || undefined;
  const startChat = trpc.chats.create.useMutation({ onSuccess: async chat => { await utils.workspace.computer.invalidate(); setLocation(`/app?chatId=${chat.id}`); } });
  // While a conversation is open it polls every 2.5s so activity started
  // elsewhere (e.g. Telegram) streams into this view in real time.
  const savedMessages = trpc.chats.messages.useQuery({ chatId: chatId ?? 1 }, { enabled: Boolean(chatId), retry: false, refetchOnWindowFocus: false, refetchInterval: Boolean(chatId) ? 2500 : false, refetchIntervalInBackground: false });
  // The backend ledger is the source of truth for active work. This keeps the
  // status visible after a refresh and for runs started from Telegram or a
  // continuation segment, where this browser does not own the fetch stream.
  const runStatus = trpc.chats.runStatus.useQuery({ chatId: chatId ?? 1 }, { enabled: Boolean(chatId), retry: false, refetchOnWindowFocus: true, refetchInterval: Boolean(chatId) ? 1000 : false, refetchIntervalInBackground: false });
  const agentIsWorking = isStreaming || Boolean(runStatus.data?.active);
  // Connector/Telegram status feeds the home dashboard cards. These hooks
  // MUST run before any early return (React error #300 when the chat view
  // renders fewer hooks than the home view did), so they live up here with the
  // other hooks and are simply disabled while a chat conversation is open.
  const connectorStatus = trpc.composio.status.useQuery(undefined, { retry: false, enabled: !chatId });
  const telegramStatus = trpc.telegram.status.useQuery(undefined, { retry: false, enabled: !chatId });
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
  }, [chatId, savedMessages.data?.length, streamingContent, toolActivities, agentIsWorking]);

  const isUnavailableReply = (content: string) => content.startsWith(MISTRAL_UNAVAILABLE_PREFIX);

  useEffect(() => {
    if (typeof window === "undefined" || !neonAuth) return;
    const params = new URLSearchParams(window.location.search);
    const verifier = params.get("verifier");
    if (!verifier) return;
    void (async () => { try { const jwt = await exchangeNeonVerifierAndGetJwt(neonAuth); if (jwt) { params.delete("verifier"); window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`); setLocation("/app"); } } catch (err) { console.warn("[Workspace] Failed to exchange Neon verifier", err instanceof Error ? err.message : err); } })();
  }, []);

  const refreshMessages = async (): Promise<boolean> => { try { await savedMessages.refetch(); return !savedMessages.isError; } catch { return false; } };
  const finalizeStream = async (): Promise<boolean> => {
    const refreshed = await refreshMessages();
    setIsStreaming(false);
    if (refreshed) {
      setPendingUserContent("");
      setStreamingContent("");
      setToolActivities([]);
    } else {
      toast.error("Nova replied, but it could not be reloaded yet. Please wait a moment before sending again.");
    }
    return refreshed;
  };
  /** Streams a message into `targetChatId`, reused by the active-chat composer and the "Start a chat" prompt box. */
  const sendMessage = async (targetChatId: number, content: string) => {
    userScrolledUpRef.current = false;
    const toPersist = savedMessages.data ?? []; setBaselineMessageId(toPersist.length ? Math.max(...toPersist.map(message => message.id)) : 0); setPendingUserContent(content); setStreamingContent(""); setToolActivities([]); setIsStreaming(true);
    try {
      const token = await getNeonAccessToken().catch(() => null);
      const response = await fetch("/api/chat/stream", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ chatId: targetChatId, content }) });
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
            if (parsed.type === "tool" && parsed.tool?.id) { setToolActivities(previous => { const incoming = parsed.tool!; const index = previous.findIndex(activity => activity.id === incoming.id); if (index === -1) return [...previous, mergeToolActivity({ id: incoming.id, name: incoming.name, state: "running", args: incoming.args ?? {} }, incoming)]; const next = [...previous]; next[index] = mergeToolActivity(next[index], incoming); return next; }); continue; }
            setStreamingContent(prev => prev + (parsed.choices?.[0]?.delta?.content || ""));
          } catch { /* Ignore malformed stream fragments. */ }
        }
      }
      await finalizeStream();
    } catch (error) { console.error("Stream error:", error); toast.error(error instanceof Error ? error.message : "Failed to send message"); await finalizeStream(); }
  };
  const submit = async (event: FormEvent | React.KeyboardEvent) => {
    event.preventDefault();
    if (!draft.trim() || !chatId || agentIsWorking) return;
    const content = draft.trim(); setDraft("");
    await sendMessage(chatId, content);
  };
  /** Creates a new chat from the "Ask Nova anything about your work" box, navigates to it, then streams the typed prompt as its first message. */
  const handleStartChat = async () => {
    const content = startPrompt.trim();
    if (!content || startChat.isPending || agentIsWorking) return;
    try {
      const chat = await startChat.mutateAsync({ title: "New workspace conversation" });
      setStartPrompt("");
      setLocation(`/app?chatId=${chat.id}`);
      await sendMessage(chat.id, content);
    } catch (error) {
      console.error("Failed to start chat:", error);
      toast.error(error instanceof Error ? error.message : "Nova could not start that conversation.");
    }
  };

  if (computer.isError) return <WorkspaceError onRetry={() => computer.refetch()} />;
  if (chatId) {
    const persisted = savedMessages.data ?? [];
    // Internal bookkeeping rows (tool activity is rendered separately,
    // acceptance markers never) stay out of the visible bubble list.
    const visibleMessages = dedupeToolActivityMessages(
      persisted.filter(
        message =>
          parsePersistedToolActivity(message.content) ||
          !isInternalChatMessage(message.content)
      )
    );
    const { userCommitted, replyCommitted, liveActivities } = reconcileChatMessages(persisted, baselineMessageId, pendingUserContent, streamingContent, toolActivities);
    const lastPersistedRole = persisted.length ? persisted[persisted.length - 1].role : null;
    const pendingBubbleRendered = Boolean(pendingUserContent) && !userCommitted;
    const liveLabel = (index: number) =>
      index === 0 ? (pendingBubbleRendered ? true : lastPersistedRole === "user" || lastPersistedRole === null) : false;
    const streamingLabel = liveActivities.length > 0 ? false : pendingBubbleRendered ? true : lastPersistedRole === "user" || lastPersistedRole === null;
    return (
      <DashboardLayout>
        <section className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#f5f6f3] text-foreground dark:bg-[#0c0d0f]">
          <div className="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full bg-primary/[0.08] blur-3xl dark:bg-primary/[0.12]" />
          <div className="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-violet-500/[0.06] blur-3xl dark:bg-violet-400/[0.06]" />
          <header className="relative z-10 shrink-0 border-b border-black/[0.07] bg-[#f5f6f3]/80 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0c0d0f]/80">
            <div className="mx-auto flex min-h-[4.5rem] w-full max-w-[1180px] items-center gap-3 px-4 sm:px-6">
              <button onClick={() => setLocation("/app/chats")} className="grid size-9 shrink-0 place-items-center rounded-full border border-black/[0.08] bg-white/55 text-muted-foreground transition-all hover:-translate-x-0.5 hover:border-primary/30 hover:bg-white hover:text-foreground dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]" aria-label="Back to chats"><ArrowLeft className="size-4" /></button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground"><span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />Live thread</span><span className="text-muted-foreground/40">/</span><span className="truncate">Private workspace</span></div>
                <p className="mt-1 truncate text-base font-extrabold tracking-[-0.02em]">Nova conversation</p>
              </div>
              <div className="hidden items-center gap-2 sm:flex"><span className="items-center gap-1.5 rounded-full border border-black/[0.07] bg-white/55 px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]"><ShieldCheck className="size-3.5 text-primary" />Local context</span></div>
              <button onClick={() => setLocation("/app")} className="flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 py-2 text-[11px] font-bold text-background shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-white dark:text-black"><MessageSquareText className="size-3.5" />New chat</button>
            </div>
          </header>

          <div ref={scrollRef} onScroll={handleChatScroll} className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-7 sm:px-6 sm:py-9">
            <div className="mx-auto grid w-full max-w-[1180px] min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-10">
              <div className="min-w-0">
                <div className="mb-6 flex items-center justify-between gap-3"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Thread {String(chatId).padStart(2, "0")}</span><span className="hidden text-[11px] font-medium text-muted-foreground sm:block">Everything here stays in your workspace</span></div>
                <div className="flex min-w-0 flex-col gap-5">
                  {savedMessages.isLoading ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><TypingIndicator /><span>Reaching into your workspace…</span></div> : visibleMessages.length === 0 && !pendingUserContent && !agentIsWorking ? (
                    <div className="relative isolate overflow-hidden rounded-[2rem] border border-black/[0.07] bg-white/70 px-6 py-12 shadow-[0_20px_70px_rgba(36,40,34,0.07)] sm:px-12 sm:py-16 dark:border-white/[0.09] dark:bg-white/[0.045] dark:shadow-[0_20px_70px_rgba(0,0,0,0.2)]">
                      <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full border border-primary/10 bg-primary/[0.06] blur-[1px]" />
                      <div className="pointer-events-none absolute right-10 top-10 size-24 rounded-full bg-primary/[0.12] blur-2xl" />
                      <div className="relative max-w-2xl">
                        <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.08] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary"><Sparkles className="size-3.5" />A blank canvas</span>
                        <h1 className="mt-6 max-w-xl text-4xl font-black leading-[0.98] tracking-[-0.055em] text-foreground sm:text-6xl">Turn a thought into something real.</h1>
                        <p className="mt-5 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">Bring Nova a question, a messy idea, or a task. Your workspace is the context; this thread is where it takes shape.</p>
                        <div className="mt-8 flex flex-wrap gap-2"><button type="button" onClick={() => setDraft("Help me make sense of the files in my workspace")} className="rounded-full border border-black/[0.08] bg-white/75 px-3.5 py-2 text-xs font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm dark:border-white/10 dark:bg-white/[0.05]">Explore my workspace</button><button type="button" onClick={() => setDraft("Turn this idea into a clear plan")} className="rounded-full border border-black/[0.08] bg-white/75 px-3.5 py-2 text-xs font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm dark:border-white/10 dark:bg-white/[0.05]">Shape an idea</button><button type="button" onClick={() => setDraft("Help me get unstuck on my next step")} className="rounded-full border border-black/[0.08] bg-white/75 px-3.5 py-2 text-xs font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm dark:border-white/10 dark:bg-white/[0.05]">Find my next step</button></div>
                      </div>
                    </div>
                  ) : visibleMessages.map((message, index) => {
                    const persistedTool = message.role === "assistant" ? parsePersistedToolActivity(message.content) : null;
                    const showLabel = index === 0 || visibleMessages[index - 1].role === "user";
                    if (persistedTool) return <div key={message.id} className="chat-in flex w-full shrink-0 pl-0 sm:pl-11">{isPanelToolActivity(persistedTool.name) ? <div className="flex w-full min-w-0 flex-col rounded-2xl border border-black/[0.07] border-l-2 border-l-primary/40 bg-white/55 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"><ToolActivityPanel activity={persistedTool} /></div> : <div className="flex min-w-0 items-center gap-1 rounded-full border border-black/[0.07] bg-white/65 px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"><ToolActivityLine activity={persistedTool} /></div>}</div>;
                    if (message.role === "user") return <div key={message.id} className="chat-in flex w-full shrink-0 justify-end"><div className="flex max-w-[92%] flex-col items-end gap-1.5 sm:max-w-[80%]"><span className="px-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">You</span><div className="rounded-[1.5rem] rounded-br-md bg-foreground px-4 py-3 text-[15px] leading-6 text-background shadow-[0_8px_24px_rgba(30,34,30,0.14)] dark:bg-white dark:text-black">{message.content}</div></div></div>;
                    return <div key={message.id} className="chat-in flex w-full shrink-0 items-start gap-3"><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-2xl bg-foreground text-background shadow-sm dark:bg-white dark:text-black"><NovaLogo size={13} /></span><div className="min-w-0 max-w-[calc(100%-3rem)]"><div className="mb-1.5 flex items-center gap-2">{showLabel && <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Nova App</p>}{showLabel && <span className="size-1 rounded-full bg-primary/50" />}{showLabel && <span className="text-[10px] font-medium text-muted-foreground">workspace intelligence</span>}</div>{isUnavailableReply(message.content) ? <div data-testid="assistant-error" className="flex items-start gap-2 break-words rounded-2xl rounded-tl-md border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 shadow-sm sm:px-5 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Nova is offline</p><span>{message.content}</span></div></div> : <div className="rounded-[1.5rem] rounded-tl-md border border-black/[0.07] bg-white/72 px-4 py-3.5 text-[15px] leading-7 shadow-[0_8px_30px_rgba(36,40,34,0.045)] dark:border-white/[0.09] dark:bg-white/[0.045] dark:shadow-[0_8px_30px_rgba(0,0,0,0.15)]"><div className="break-words text-foreground"><MarkdownText text={message.content} /></div></div>}</div></div>;
                  })}
                  {pendingUserContent && !userCommitted && <div className="chat-in flex w-full shrink-0 justify-end"><div className="flex max-w-[92%] flex-col items-end gap-1.5 sm:max-w-[80%]"><span className="px-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">You</span><div className="rounded-[1.5rem] rounded-br-md bg-foreground px-4 py-3 text-[15px] leading-6 text-background shadow-[0_8px_24px_rgba(30,34,30,0.14)] dark:bg-white dark:text-black">{pendingUserContent}</div></div></div>}
                  {liveActivities.map((activity, index) => <div key={activity.id} className="chat-in flex w-full shrink-0 pl-0 sm:pl-11">{isPanelToolActivity(activity.name) ? <div className="flex w-full min-w-0 flex-col rounded-2xl border border-black/[0.07] border-l-2 border-l-primary/40 bg-white/55 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">{liveLabel(index) && <p className="mb-1 ml-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Nova App</p>}<ToolActivityPanel activity={activity} /></div> : <div className="flex min-w-0 items-center gap-1 rounded-full border border-black/[0.07] bg-white/65 px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">{liveLabel(index) && <p className="mr-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Nova App</p>}<ToolActivityLine activity={activity} /></div>}</div>)}
                  {agentIsWorking && !replyCommitted && <div className="chat-in flex w-full shrink-0 items-start gap-3"><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-2xl bg-foreground text-background shadow-sm dark:bg-white dark:text-black"><NovaLogo size={13} /></span><div className="min-w-0 max-w-[calc(100%-3rem)]"><div className="mb-1.5 flex items-center gap-2">{streamingLabel && <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Nova App</p>}{streamingLabel && <span className="size-1 animate-pulse rounded-full bg-primary" />}</div>{isUnavailableReply(streamingContent) ? <div data-testid="assistant-error" className="flex items-start gap-2 break-words rounded-2xl rounded-tl-md border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 shadow-sm sm:px-5 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Nova is offline</p><span>{streamingContent}</span></div></div> : streamingContent ? <div className="rounded-[1.5rem] rounded-tl-md border border-black/[0.07] bg-white/72 px-4 py-3.5 text-[15px] leading-7 shadow-[0_8px_30px_rgba(36,40,34,0.045)] dark:border-white/[0.09] dark:bg-white/[0.045]"><div className="break-words text-foreground"><MarkdownText text={streamingContent} /><span className="stream-caret" /></div></div> : <div className="rounded-[1.5rem] rounded-tl-md border border-black/[0.07] bg-white/72 px-4 py-3.5 shadow-sm dark:border-white/[0.09] dark:bg-white/[0.045]"><TypingIndicator /></div>}</div></div>}
                </div>
              </div>

              <aside className="hidden lg:block">
                <div className="sticky top-5 rounded-[1.5rem] border border-black/[0.07] bg-white/55 p-4 shadow-[0_14px_45px_rgba(36,40,34,0.05)] dark:border-white/[0.09] dark:bg-white/[0.035] dark:shadow-[0_14px_45px_rgba(0,0,0,0.16)]">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground"><Activity className="size-3.5 text-primary" />Session signal</div>
                  <div className="mt-5 flex items-center gap-2 rounded-xl bg-emerald-500/[0.08] px-3 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><span className="size-2 rounded-full bg-emerald-500" />{agentIsWorking ? "Nova is working" : "Ready when you are"}</div>
                  <div className="mt-4 divide-y divide-black/[0.06] text-xs dark:divide-white/[0.08]"><div className="flex items-center justify-between py-3"><span className="text-muted-foreground">Messages</span><span className="font-bold text-foreground">{visibleMessages.length}</span></div><div className="flex items-center justify-between py-3"><span className="text-muted-foreground">Live actions</span><span className="font-bold text-foreground">{liveActivities.length + toolActivities.length}</span></div><div className="flex items-center justify-between py-3"><span className="text-muted-foreground">Context</span><span className="font-bold text-primary">Private</span></div></div>
                  <div className="mt-4 rounded-xl border border-black/[0.06] bg-black/[0.025] p-3 text-[11px] leading-5 text-muted-foreground dark:border-white/[0.07] dark:bg-white/[0.025]"><ShieldCheck className="mb-2 size-4 text-primary" /><p>Your files, tools, and conversation stay scoped to this workspace.</p></div>
                </div>
              </aside>
            </div>
          </div>

          <form onSubmit={submit} className="relative z-10 shrink-0 bg-gradient-to-t from-[#f5f6f3] via-[#f5f6f3]/95 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] dark:from-[#0c0d0f] dark:via-[#0c0d0f]/95">
            <div className="mx-auto w-full max-w-[1180px]">
              <div className="rounded-[1.6rem] border border-black/[0.09] bg-white/85 p-2 shadow-[0_12px_45px_rgba(36,40,34,0.1)] backdrop-blur-xl transition-all focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/[0.1] dark:bg-white/[0.06] dark:shadow-[0_12px_45px_rgba(0,0,0,0.25)] dark:focus-within:border-primary/50">
                <div className="flex items-center gap-2 px-2.5 pb-1.5"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary"><Sparkles className="size-3.5" />Nova</span><span className="size-1 rounded-full bg-black/15 dark:bg-white/20" /><span className="text-[10px] font-medium text-muted-foreground">Private workspace mode</span><span className="ml-auto hidden text-[10px] font-medium text-muted-foreground sm:inline">Enter to send</span></div>
                <div className="flex items-end gap-2 rounded-[1.2rem] bg-black/[0.025] p-2 pl-3.5 dark:bg-white/[0.035]"><Textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(event); } }} placeholder="What should we make progress on?" rows={1} className="max-h-28 min-h-10 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-1.5 text-[16px] leading-6 placeholder:text-muted-foreground focus-visible:ring-0 sm:text-[15px]" /><button type="submit" disabled={!draft.trim() || agentIsWorking} aria-label="Send message" className={draft.trim() && !agentIsWorking ? "grid size-10 shrink-0 place-items-center rounded-xl bg-foreground text-background shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-white dark:text-black" : "grid size-10 shrink-0 place-items-center rounded-xl bg-black/[0.06] text-muted-foreground transition-all dark:bg-white/[0.08]"}>{agentIsWorking ? <CircleDashed className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</button></div>
              </div>
              <p className="mt-2 hidden text-center text-[10px] font-medium text-muted-foreground sm:block"><CornerDownLeft className="mr-1 inline size-3" />Shift+Enter for a new line</p>
            </div>
          </form>
        </section>
      </DashboardLayout>
    );
  }

  const githubConnected = connectorStatus.data?.toolkits?.github?.connected ?? false;
  const gmailConnected = connectorStatus.data?.toolkits?.gmail?.connected ?? false;
  // The bot token being configured is not "connected": the owner's Telegram
  // chat only counts as Ready once Telegram has actually linked a chat.
  const telegramLinked = Boolean(telegramStatus.data?.configured && telegramStatus.data?.chatId);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const connectors = [
    { name: "Telegram", icon: Send, available: telegramLinked, detail: "Delivers messages and routine updates straight to your Telegram chat." },
    { name: "GitHub", icon: Github, available: githubConnected, detail: "Star repos, file issues and open pull requests from a task. Connect it in Settings." },
    { name: "Gmail", icon: Mail, available: gmailConnected, detail: "Search, send and reply to email from a task. Connect it in Settings." },
    { name: "More connectors", icon: CircleDashed, available: false, detail: "Slack and Notion are on the roadmap - tell Nova what you need next." },
  ];

  return (
    <DashboardLayout>
      <div className="relative mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-primary/[0.045] to-transparent dark:from-primary/[0.07]" />
        <div className="rise-in relative">
          <p className="text-sm font-semibold text-primary">{greeting}</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl dark:text-foreground">What are we working on?</h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground dark:text-muted-foreground">Open a file, continue a conversation, or leave Nova a task for later.</p>
        </div>

        <div className="rise-in-delay-1 relative mt-8 w-full rounded-2xl border border-border bg-card p-4 shadow-[0_4px_14px_rgba(10,10,10,0.05)] transition-all focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 sm:p-5 dark:border-white/10 dark:bg-card dark:focus-within:border-primary/40">
          <span className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><MessageSquareText className="size-4" /></span><span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground/90 dark:text-foreground">Ask Nova anything about your work</span></span>
          <Textarea
            value={startPrompt}
            onChange={event => setStartPrompt(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleStartChat();
              }
            }}
            placeholder="What do you want Nova to help with?"
            rows={2}
            disabled={startChat.isPending || isStreaming}
            className="mt-3 max-h-32 min-h-16 w-full resize-none border-0 bg-transparent px-0 py-1.5 text-[15px] leading-6 placeholder:text-muted-foreground focus-visible:ring-0"
          />
          <span className="mt-2 flex items-center justify-between">
            <span className="hidden text-[10px] font-medium text-muted-foreground sm:block">Enter ↵ starts the chat</span>
            <Button type="button" onClick={() => void handleStartChat()} disabled={!startPrompt.trim() || startChat.isPending || isStreaming} className={`rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${startPrompt.trim() && !startChat.isPending && !isStreaming ? "bg-primary text-white hover:bg-primary/90" : "bg-muted text-muted-foreground hover:bg-muted dark:bg-white/5 dark:hover:bg-white/10"}`}>
              {startChat.isPending ? "Starting…" : "Start a chat"}
            </Button>
          </span>
        </div>

        <div className="rise-in-delay-2 relative mt-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Connectors Nova can use</p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {connectors.map(connector => {
              const ConnectorIcon = connector.icon;
              const needsSetup = connector.name !== "More connectors" && !connector.available;
              const Card = needsSetup ? "button" : "div";
              return (
                <Card key={connector.name} onClick={needsSetup ? () => setLocation("/app/settings") : undefined} className="rounded-2xl border border-border bg-card px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(10,10,10,0.03)] transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_8px_24px_rgba(10,10,10,0.07)] dark:border-white/10 dark:bg-card dark:hover:border-white/20">
                  <span className="flex items-center gap-2 text-xs font-semibold text-foreground/90 dark:text-foreground">
                    <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><ConnectorIcon className="size-3.5" /></span>
                    <span className="min-w-0 truncate">{connector.name}</span>
                    <span className={`ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${connector.available ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{connector.available && <span className="size-1.5 rounded-full bg-emerald-500" />}{connector.available ? "Ready" : connector.name === "More connectors" ? "Coming soon" : "Connect"}</span>
                  </span>
                  <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground dark:text-muted-foreground">{connector.detail}</p>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </DashboardLayout>
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


function WorkspaceError({ onRetry }: { onRetry: () => void }) { return <DashboardLayout><div className="grid min-h-[65vh] place-items-center px-4 text-center"><div><NovaLogo size={40} className="mx-auto" /><h1 className="mt-4 text-2xl font-extrabold tracking-tight">Nova could not open your computer.</h1><p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">Your workspace remains private. Try reconnecting to your computer.</p><Button className="mt-5 rounded-full bg-primary hover:bg-primary/90" onClick={onRetry}>Try again</Button></div></div></DashboardLayout>; }
