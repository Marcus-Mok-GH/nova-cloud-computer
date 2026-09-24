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
import { Activity, AlertTriangle, ArrowLeft, ArrowUp, CheckCircle2, CircleDashed, CornerDownLeft, FileText, Github, Mail, MessageSquareText, Send, ShieldCheck, Sparkles, XCircle } from "lucide-react";
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
        <section className="chat-editorial-shell relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-foreground">
          <div className="chat-editorial-orbit pointer-events-none absolute -right-40 -top-48 size-[34rem] rounded-full border border-primary/[0.12] dark:border-primary/[0.16]" />
          <div className="chat-editorial-orbit pointer-events-none absolute -bottom-72 -left-56 size-[32rem] rounded-full border border-foreground/[0.06] dark:border-white/[0.07]" />
          <header className="relative z-10 shrink-0 border-b border-foreground/[0.10] bg-background/75 backdrop-blur-xl dark:border-white/[0.10]">
            <div className="mx-auto flex min-h-[4.5rem] w-full max-w-[1240px] items-center gap-3 px-4 sm:px-7">
              <button onClick={() => setLocation("/app/chats")} className="grid size-9 shrink-0 place-items-center rounded-lg border border-foreground/[0.12] bg-card/70 text-muted-foreground transition hover:-translate-x-0.5 hover:border-primary/45 hover:text-foreground dark:border-white/[0.12]" aria-label="Back to chats"><ArrowLeft className="size-4" /></button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.20em] text-muted-foreground"><span className="flex items-center gap-1.5 text-primary"><span className={agentIsWorking ? "size-1.5 rounded-full bg-primary animate-pulse" : "size-1.5 rounded-full bg-primary"} />Conversation</span><span className="text-muted-foreground/40">/</span><span className="truncate">Private workspace</span></div>
                <p className="mt-1 truncate text-[15px] font-bold tracking-[-0.02em]">Nova conversation</p>
              </div>
              <div className="hidden items-center gap-2 sm:flex"><span className="flex items-center gap-1.5 border border-foreground/[0.10] bg-card/60 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.10em] text-muted-foreground dark:border-white/[0.10]"><ShieldCheck className="size-3.5 text-primary" />Protected context</span></div>
              <button onClick={() => setLocation("/app")} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[11px] font-bold text-background shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-white dark:text-black"><MessageSquareText className="size-3.5" />New thread</button>
            </div>
          </header>

          <div ref={scrollRef} onScroll={handleChatScroll} className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-7 sm:px-7 sm:py-10">
            <div className="mx-auto grid w-full max-w-[1240px] min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_248px] lg:gap-14">
              <div className="min-w-0">
                <div className="mb-8 flex items-end justify-between gap-3 border-b border-foreground/[0.10] pb-4 dark:border-white/[0.10]"><div><p className="text-[10px] font-bold uppercase tracking-[0.20em] text-primary">Thread {String(chatId).padStart(2, "0")}</p><p className="mt-1 text-xs text-muted-foreground">A live working session</p></div><span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground"><span className={agentIsWorking ? "size-1.5 rounded-full bg-primary" : "size-1.5 rounded-full bg-emerald-500"} />{agentIsWorking ? "In progress" : "Ready"}</span></div>
                <div className="flex min-w-0 flex-col gap-6">
                  {savedMessages.isLoading ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><TypingIndicator /><span>Opening the thread…</span></div> : visibleMessages.length === 0 && !pendingUserContent && !agentIsWorking ? (
                    <div className="chat-blank-state relative isolate overflow-hidden border border-foreground/[0.12] bg-card/75 px-6 py-12 shadow-[0_24px_80px_rgba(36,40,34,0.08)] sm:px-12 sm:py-16 dark:border-white/[0.10] dark:bg-white/[0.045] dark:shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
                      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full border border-primary/20" />
                      <div className="pointer-events-none absolute right-4 top-4 size-16 rounded-full bg-primary/[0.12] blur-2xl" />
                      <div className="relative max-w-2xl">
                        <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.20em] text-primary"><Sparkles className="size-3.5" />A fresh thread</span>
                        <h1 className="mt-6 max-w-2xl font-serif text-4xl font-medium leading-[0.98] tracking-[-0.045em] text-foreground sm:text-6xl">Give the next thought a place to land.</h1>
                        <p className="mt-6 max-w-lg text-sm leading-7 text-muted-foreground sm:text-base">Start with the rough version. Nova can help sort it, build it, or simply find the next useful move.</p>
                        <div className="mt-9 flex flex-wrap gap-2"><button type="button" onClick={() => setDraft("Help me make sense of the files in my workspace")} className="border border-foreground/[0.13] bg-background/60 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/[0.06] dark:border-white/[0.12]">Read the room</button><button type="button" onClick={() => setDraft("Turn this idea into a clear plan")} className="border border-foreground/[0.13] bg-background/60 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/[0.06] dark:border-white/[0.12]">Shape an idea</button><button type="button" onClick={() => setDraft("Help me get unstuck on my next step")} className="border border-foreground/[0.13] bg-background/60 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/[0.06] dark:border-white/[0.12]">Find the next move</button></div>
                      </div>
                    </div>
                  ) : visibleMessages.map((message, index) => {
                    const persistedTool = message.role === "assistant" ? parsePersistedToolActivity(message.content) : null;
                    const showLabel = index === 0 || visibleMessages[index - 1].role === "user";
                    if (persistedTool) return <div key={message.id} className="chat-in flex w-full shrink-0 pl-0 sm:pl-12">{isPanelToolActivity(persistedTool.name) ? <div className="flex w-full min-w-0 flex-col border border-foreground/[0.10] border-l-2 border-l-primary/60 bg-card/55 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"><ToolActivityPanel activity={persistedTool} /></div> : <div className="flex min-w-0 items-center gap-1 border border-foreground/[0.10] bg-card/60 px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"><ToolActivityLine activity={persistedTool} /></div>}</div>;
                    if (message.role === "user") return <div key={message.id} className="chat-in flex w-full shrink-0 justify-end"><div className="flex max-w-[92%] flex-col items-end gap-1.5 sm:max-w-[78%]"><span className="px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">You</span><div className="border border-primary/20 bg-primary px-4 py-3 text-[15px] leading-6 text-primary-foreground shadow-[0_8px_24px_rgba(130,70,35,0.16)]">{message.content}</div></div></div>;
                    return <div key={message.id} className="chat-in flex w-full shrink-0 items-start gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background shadow-sm dark:bg-white dark:text-black"><NovaLogo size={12} /></span><div className="min-w-0 max-w-[calc(100%-2.75rem)]"><div className="mb-2 flex items-center gap-2">{showLabel && <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Nova</p>}{showLabel && <span className="text-[10px] text-muted-foreground/50">/</span>}{showLabel && <span className="text-[10px] font-medium text-muted-foreground">workspace intelligence</span>}</div>{isUnavailableReply(message.content) ? <div data-testid="assistant-error" className="flex items-start gap-2 break-words border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 shadow-sm sm:px-5 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Nova is offline</p><span>{message.content}</span></div></div> : <div className="border-l border-primary/40 bg-card/65 px-4 py-3.5 text-[15px] leading-7 shadow-[0_8px_30px_rgba(36,40,34,0.035)] dark:bg-white/[0.045]"><div className="break-words text-foreground"><MarkdownText text={message.content} /></div></div>}</div></div>;
                  })}
                  {pendingUserContent && !userCommitted && <div className="chat-in flex w-full shrink-0 justify-end"><div className="flex max-w-[92%] flex-col items-end gap-1.5 sm:max-w-[78%]"><span className="px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">You</span><div className="border border-primary/20 bg-primary px-4 py-3 text-[15px] leading-6 text-primary-foreground shadow-[0_8px_24px_rgba(130,70,35,0.16)]">{pendingUserContent}</div></div></div>}
                  {liveActivities.map((activity, index) => <div key={activity.id} className="chat-in flex w-full shrink-0 pl-0 sm:pl-12">{isPanelToolActivity(activity.name) ? <div className="flex w-full min-w-0 flex-col border border-foreground/[0.10] border-l-2 border-l-primary/60 bg-card/55 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">{liveLabel(index) && <p className="mb-1 ml-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Nova</p>}<ToolActivityPanel activity={activity} /></div> : <div className="flex min-w-0 items-center gap-1 border border-foreground/[0.10] bg-card/60 px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">{liveLabel(index) && <p className="mr-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Nova</p>}<ToolActivityLine activity={activity} /></div>}</div>)}
                  {agentIsWorking && !replyCommitted && <div className="chat-in flex w-full shrink-0 items-start gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background shadow-sm dark:bg-white dark:text-black"><NovaLogo size={12} /></span><div className="min-w-0 max-w-[calc(100%-2.75rem)]"><div className="mb-2 flex items-center gap-2">{streamingLabel && <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Nova</p>}{streamingLabel && <span className="size-1 animate-pulse rounded-full bg-primary" />}</div>{isUnavailableReply(streamingContent) ? <div data-testid="assistant-error" className="flex items-start gap-2 break-words border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 shadow-sm sm:px-5 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Nova is offline</p><span>{streamingContent}</span></div></div> : streamingContent ? <div className="border-l border-primary/40 bg-card/65 px-4 py-3.5 text-[15px] leading-7 shadow-[0_8px_30px_rgba(36,40,34,0.035)] dark:bg-white/[0.045]"><div className="break-words text-foreground"><MarkdownText text={streamingContent} /><span className="stream-caret" /></div></div> : <div className="border-l border-primary/40 bg-card/65 px-4 py-3.5 shadow-sm dark:bg-white/[0.045]"><TypingIndicator /></div>}</div></div>}
                </div>
              </div>

              <aside className="hidden lg:block">
                <div className="sticky top-5 border-t-2 border-primary bg-card/55 pt-4 dark:bg-white/[0.035]">
                  <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground"><span className="flex items-center gap-2"><Activity className="size-3.5 text-primary" />Session signal</span><span className="text-primary">{agentIsWorking ? "Live" : "Quiet"}</span></div>
                  <div className="mt-5 flex items-center gap-2 border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><span className="size-2 rounded-full bg-emerald-500" />{agentIsWorking ? "Nova is working" : "Ready when you are"}</div>
                  <div className="mt-4 divide-y divide-foreground/[0.08] text-xs dark:divide-white/[0.08]"><div className="flex items-center justify-between py-3"><span className="text-muted-foreground">Messages</span><span className="font-bold text-foreground">{visibleMessages.length}</span></div><div className="flex items-center justify-between py-3"><span className="text-muted-foreground">Live actions</span><span className="font-bold text-foreground">{liveActivities.length + toolActivities.length}</span></div><div className="flex items-center justify-between py-3"><span className="text-muted-foreground">Context</span><span className="font-bold text-primary">Private</span></div></div>
                  <div className="mt-5 border-l-2 border-primary/30 bg-background/55 p-3 text-[11px] leading-5 text-muted-foreground dark:bg-white/[0.025]"><ShieldCheck className="mb-2 size-4 text-primary" /><p>Your files, tools, and conversation stay scoped to this workspace.</p></div>
                </div>
              </aside>
            </div>
          </div>

          <form onSubmit={submit} className="chat-editorial-composer relative z-10 shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-7 sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto w-full max-w-[1240px]">
              <div className="border border-foreground/[0.14] bg-card/85 p-2 shadow-[0_14px_45px_rgba(36,40,34,0.10)] backdrop-blur-xl transition focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/[0.12] dark:bg-white/[0.06] dark:shadow-[0_14px_45px_rgba(0,0,0,0.25)]">
                <div className="flex items-center gap-2 px-2.5 pb-1.5"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary"><Sparkles className="size-3.5" />Nova</span><span className="size-1 bg-foreground/20 dark:bg-white/20" /><span className="text-[10px] font-medium text-muted-foreground">Private workspace</span><span className="ml-auto hidden text-[10px] font-medium text-muted-foreground sm:inline">Enter to send</span></div>
                <div className="flex items-end gap-2 border border-foreground/[0.08] bg-background/55 p-2 pl-3.5 dark:border-white/[0.08] dark:bg-white/[0.035]"><Textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(event); } }} placeholder="What is worth moving forward today?" rows={1} className="max-h-28 min-h-10 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-1.5 text-[16px] leading-6 placeholder:text-muted-foreground focus-visible:ring-0 sm:text-[15px]" /><button type="submit" disabled={!draft.trim() || agentIsWorking} aria-label="Send message" className={draft.trim() && !agentIsWorking ? "grid size-10 shrink-0 place-items-center rounded-lg bg-foreground text-background shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-white dark:text-black" : "grid size-10 shrink-0 place-items-center rounded-lg bg-foreground/[0.07] text-muted-foreground transition dark:bg-white/[0.08]"}>{agentIsWorking ? <CircleDashed className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</button></div>
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
      <div className="chat-editorial-shell relative min-h-full overflow-hidden">
        <div className="chat-editorial-orbit pointer-events-none absolute -right-48 -top-56 size-[36rem] rounded-full border border-primary/[0.12] dark:border-primary/[0.16]" />
        <div className="relative mx-auto grid max-w-[1240px] gap-12 px-4 py-12 sm:px-7 sm:py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.65fr)] lg:items-start lg:gap-20">
          <div className="rise-in">
            <p className="text-[10px] font-bold uppercase tracking-[0.20em] text-primary">Private workbench / {greeting}</p>
            <h1 className="mt-6 max-w-3xl font-serif text-5xl font-medium leading-[0.94] tracking-[-0.055em] text-foreground sm:text-7xl">Start with the thing that is taking up space.</h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">Open a thread for the rough idea, the stubborn task, or the quiet question. Nova keeps the useful context close.</p>
            <div className="mt-10 flex items-center gap-3 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500" />Your workspace is ready<span className="text-foreground/20">/</span><span>Nothing public by default</span></div>
          </div>

          <div className="rise-in-delay-1 border-t-2 border-primary bg-card/75 p-4 shadow-[0_20px_70px_rgba(36,40,34,0.08)] dark:bg-white/[0.045] dark:shadow-[0_20px_70px_rgba(0,0,0,0.20)] sm:p-5">
            <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground"><MessageSquareText className="size-3.5 text-primary" />New thread</span><span className="text-[10px] text-muted-foreground">Enter ↵</span></div>
            <Textarea value={startPrompt} onChange={event => setStartPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void handleStartChat(); } }} placeholder="What do you want Nova to help with?" rows={5} disabled={startChat.isPending || isStreaming} className="mt-6 max-h-40 min-h-32 w-full resize-none border-0 bg-transparent px-0 py-1.5 text-[17px] leading-7 placeholder:text-muted-foreground focus-visible:ring-0" />
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-foreground/[0.10] pt-4 dark:border-white/[0.10]"><span className="text-[10px] font-medium text-muted-foreground">Rough is a good place to begin.</span><Button type="button" onClick={() => void handleStartChat()} disabled={!startPrompt.trim() || startChat.isPending || isStreaming} className={startPrompt.trim() && !startChat.isPending && !isStreaming ? "rounded-lg bg-foreground px-3.5 py-2 text-xs font-bold text-background hover:bg-foreground/90 dark:bg-white dark:text-black" : "rounded-lg bg-muted px-3.5 py-2 text-xs font-bold text-muted-foreground hover:bg-muted dark:bg-white/5 dark:hover:bg-white/10"}>{startChat.isPending ? "Opening…" : "Open thread"}</Button></div>
          </div>

          <div className="rise-in-delay-2 lg:col-span-2">
            <div className="mb-4 flex items-end justify-between gap-3 border-b border-foreground/[0.10] pb-3 dark:border-white/[0.10]"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Tools on hand</p><p className="mt-1 text-xs text-muted-foreground">Nova can work across the places you already use.</p></div><span className="hidden text-[10px] text-muted-foreground sm:block">Connect only what you need</span></div>
            <div className="grid gap-px overflow-hidden border border-foreground/[0.10] bg-foreground/[0.10] sm:grid-cols-2 lg:grid-cols-4 dark:border-white/[0.10] dark:bg-white/[0.10]">
              {connectors.map(connector => {
                const ConnectorIcon = connector.icon;
                const needsSetup = connector.name !== "More connectors" && !connector.available;
                const Card = needsSetup ? "button" : "div";
                return <Card key={connector.name} onClick={needsSetup ? () => setLocation("/app/settings") : undefined} className="bg-card/85 px-4 py-4 text-left transition hover:bg-primary/[0.06] dark:bg-card/85 dark:hover:bg-white/[0.07]"><span className="flex items-center gap-2 text-xs font-semibold text-foreground"><span className="grid size-7 shrink-0 place-items-center bg-primary/10 text-primary"><ConnectorIcon className="size-3.5" /></span><span className="min-w-0 truncate">{connector.name}</span><span className={connector.available ? "ml-auto flex shrink-0 items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400" : "ml-auto shrink-0 text-[10px] font-bold text-muted-foreground"}>{connector.available && <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500" />}{connector.available ? "Ready" : connector.name === "More connectors" ? "Soon" : "Connect"}</span></span><p className="mt-3 text-[11px] leading-5 text-muted-foreground">{connector.detail}</p></Card>;
              })}
            </div>
          </div>
        </div>
      </div>
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
