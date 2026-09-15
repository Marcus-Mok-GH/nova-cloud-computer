import DashboardLayout from "@/components/DashboardLayout";
import NovaMark from "@/components/NovaMark";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getNeonAccessToken } from "@/lib/neonAuth";
import { MarkdownText } from "@/lib/markdown";
import { ToolActivityLine } from "@/lib/toolActivityLine";
import { dedupeToolActivityMessages, parsePersistedToolActivity, reconcileChatMessages, type ToolActivity } from "@/lib/chatMessages";
import { AlertTriangle, ArrowLeft, ArrowUp, CheckCircle2, CircleDashed, FileText, Github, Mail, MessageSquareText, Send, XCircle } from "lucide-react";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { NVIDIA_UNAVAILABLE_MESSAGE } from "@shared/const";
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
  }, [chatId, savedMessages.data?.length, streamingContent, toolActivities, isStreaming]);

  const isUnavailableReply = (content: string) => content === NVIDIA_UNAVAILABLE_MESSAGE;

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
            if (parsed.type === "tool" && parsed.tool?.id) { setToolActivities(previous => { const index = previous.findIndex(activity => activity.id === parsed.tool?.id); if (index === -1) return [...previous, parsed.tool!]; const next = [...previous]; next[index] = { ...next[index], ...parsed.tool }; return next; }); continue; }
            setStreamingContent(prev => prev + (parsed.choices?.[0]?.delta?.content || ""));
          } catch { /* Ignore malformed stream fragments. */ }
        }
      }
      await finalizeStream();
    } catch (error) { console.error("Stream error:", error); toast.error(error instanceof Error ? error.message : "Failed to send message"); await finalizeStream(); }
  };
  const submit = async (event: FormEvent | React.KeyboardEvent) => {
    event.preventDefault();
    if (!draft.trim() || !chatId || isStreaming) return;
    const content = draft.trim(); setDraft("");
    await sendMessage(chatId, content);
  };
  /** Creates a new chat from the "Ask Nova anything about your work" box, navigates to it, then streams the typed prompt as its first message. */
  const handleStartChat = async () => {
    const content = startPrompt.trim();
    if (!content || startChat.isPending || isStreaming) return;
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
    const { userCommitted, replyCommitted, liveActivities } = reconcileChatMessages(persisted, baselineMessageId, pendingUserContent, streamingContent, toolActivities);
    const lastPersistedRole = persisted.length ? persisted[persisted.length - 1].role : null;
    const pendingBubbleRendered = Boolean(pendingUserContent) && !userCommitted;
    const liveLabel = (index: number) =>
      index === 0 ? (pendingBubbleRendered ? true : lastPersistedRole === "user" || lastPersistedRole === null) : false;
    const streamingLabel = liveActivities.length > 0 ? false : pendingBubbleRendered ? true : lastPersistedRole === "user" || lastPersistedRole === null;
    return (
    <DashboardLayout>
      <section className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-0 bg-background shadow-none dark:bg-background">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-primary/[0.045] to-transparent dark:from-primary/[0.07]" />
        <header className="z-10 shrink-0 border-b border-border/70 bg-background/85 backdrop-blur-md dark:border-white/5 dark:bg-background/85">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2.5 px-3 sm:px-5">
            <button onClick={() => setLocation("/app/chats")} className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-neutral-800 dark:hover:text-white" aria-label="Back to chats"><ArrowLeft className="size-4" /></button>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><NovaMark size={12} /></span>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold tracking-tight">Nova conversation</p><p className="hidden text-[11px] text-muted-foreground sm:block">Private workspace context</p></div>
            <button onClick={() => setLocation("/app")} className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-[11px] font-bold text-foreground/80 transition-colors hover:border-primary/30 hover:text-foreground dark:border-white/10 dark:bg-card dark:text-foreground/80"><MessageSquareText className="size-3.5 text-primary" />New chat</button>
          </div>
        </header>
        <div ref={scrollRef} onScroll={handleChatScroll} className="z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-6 sm:px-5 sm:py-8">
          <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5">
            {savedMessages.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading conversation…</p> : persisted.length === 0 && !pendingUserContent && !isStreaming ? (
              <div className="chat-in flex flex-col items-center justify-center gap-3 py-14 text-center">
                <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15"><NovaMark size={22} /></span>
                <p className="text-lg font-extrabold tracking-tight">What are we working on?</p>
                <p className="max-w-xs text-sm leading-6 text-muted-foreground">Ask Nova about your files, or give it a task. Replies stream in here.</p>
              </div>
            ) : dedupeToolActivityMessages(persisted).map((message, index) => {
              const persistedTool = message.role === "assistant" ? parsePersistedToolActivity(message.content) : null;
              const showLabel = index === 0 || persisted[index - 1].role === "user";
              if (persistedTool) return <div key={message.id} className="chat-in ml-[2.65rem] flex w-full shrink-0"><div className="flex min-w-0 items-center gap-1 rounded-full border border-border/70 bg-card px-2.5 py-1 shadow-[0_1px_2px_rgba(10,10,10,0.04)] dark:border-white/10 dark:bg-card"><ToolActivityLine activity={persistedTool} /></div></div>;
              if (message.role === "user") return <div key={message.id} className="chat-in flex w-full shrink-0 justify-end"><div className="max-w-[92%] rounded-3xl rounded-br-lg bg-neutral-950 px-4 py-2.5 text-[15px] leading-6 text-white shadow-[0_2px_10px_rgba(10,10,10,0.10)] sm:max-w-[85%] dark:bg-foreground dark:text-background">{message.content}</div></div>;
              return <div key={message.id} className="chat-in flex w-full shrink-0 items-start gap-2.5"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><NovaMark size={12} /></span><div className="min-w-0 max-w-[calc(100%-2.65rem)]">{showLabel && <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Nova App</p>}{isUnavailableReply(message.content) ? <div data-testid="assistant-error" className="flex items-start gap-2 break-words rounded-2xl rounded-tl-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm leading-6 text-red-700 sm:px-4 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Nova is offline</p><span>{message.content}</span></div></div> : <div className="break-words text-[15px] leading-7 text-foreground"><MarkdownText text={message.content} /></div>}</div></div>;
            })}
            {pendingUserContent && !userCommitted && <div className="chat-in flex w-full shrink-0 justify-end"><div className="max-w-[92%] rounded-3xl rounded-br-lg bg-neutral-950 px-4 py-2.5 text-[15px] leading-6 text-white shadow-[0_2px_10px_rgba(10,10,10,0.10)] sm:max-w-[85%] dark:bg-foreground dark:text-background">{pendingUserContent}</div></div>}
            {liveActivities.map((activity, index) => <div key={activity.id} className="chat-in ml-[2.65rem] flex w-full shrink-0"><div className="flex min-w-0 items-center gap-1 rounded-full border border-border/70 bg-card px-2.5 py-1 shadow-[0_1px_2px_rgba(10,10,10,0.04)] dark:border-white/10 dark:bg-card">{liveLabel(index) && <p className="mr-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Nova App</p>}<ToolActivityLine activity={activity} /></div></div>)}
            {isStreaming && !replyCommitted && <div className="chat-in flex w-full shrink-0 items-start gap-2.5"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><NovaMark size={12} /></span><div className="min-w-0 max-w-[calc(100%-2.65rem)]">{streamingLabel && <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Nova App</p>}{isUnavailableReply(streamingContent) ? <div data-testid="assistant-error" className="flex items-start gap-2 break-words rounded-2xl rounded-tl-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm leading-6 text-red-700 sm:px-4 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Nova is offline</p><span>{streamingContent}</span></div></div> : streamingContent ? <div className="break-words text-[15px] leading-7 text-foreground"><MarkdownText text={streamingContent} /><span className="stream-caret" /></div> : <TypingIndicator />}</div></div>}
          </div>
        </div>
        <form onSubmit={submit} className="z-10 shrink-0 bg-gradient-to-t from-background via-background/95 to-transparent px-3 pb-4 pt-3 sm:px-5 sm:pb-5">
          <div className="mx-auto w-full max-w-3xl">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 pl-3.5 shadow-[0_4px_14px_rgba(10,10,10,0.05)] transition-all focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/10 dark:bg-card dark:focus-within:border-primary/40">
              <Textarea
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit(event);
                  }
                }}
                placeholder="Message Nova…"
                rows={1}
                className="max-h-28 min-h-9 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-1.5 text-[15px] leading-6 placeholder:text-muted-foreground focus-visible:ring-0"
              />
              <button type="submit" disabled={!draft.trim() || isStreaming} aria-label="Send message" className={`grid size-9 shrink-0 place-items-center rounded-xl transition-all ${draft.trim() && !isStreaming ? "bg-primary text-white hover:bg-primary/90" : "bg-muted text-muted-foreground hover:bg-muted dark:bg-white/5 dark:text-muted-foreground dark:hover:bg-white/10"}`}>
                {isStreaming ? <CircleDashed className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </button>
            </div>
            <p className="mt-1.5 hidden text-center text-[10px] font-medium text-muted-foreground sm:block">Enter ↵ to send · Shift+Enter for a new line</p>
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
    { name: "More connectors", icon: CircleDashed, available: false, detail: "Slack and Notion are on the roadmap — tell Nova what you need next." },
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
    <div data-testid="typing-indicator" className="inline-flex items-center gap-1.5 break-words rounded-2xl rounded-tl-md border border-border/60 bg-card px-3.5 py-3 shadow-[0_2px_8px_rgba(10,10,10,0.05)] dark:border-white/10 dark:bg-card" aria-label="Nova is typing">
      {[0, 1, 2].map(index => <span key={index} className="typing-dot size-1.5 rounded-full bg-primary/60" />)}
    </div>
  );
}


function WorkspaceError({ onRetry }: { onRetry: () => void }) { return <DashboardLayout><div className="grid min-h-[65vh] place-items-center px-4 text-center"><div><NovaMark size={40} className="mx-auto" /><h1 className="mt-4 text-2xl font-extrabold tracking-tight">Nova could not open your computer.</h1><p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">Your workspace remains private. Try reconnecting to your computer.</p><Button className="mt-5 rounded-full bg-primary hover:bg-primary/90" onClick={onRetry}>Try again</Button></div></div></DashboardLayout>; }
