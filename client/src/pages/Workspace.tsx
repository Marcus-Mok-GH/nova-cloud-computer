import DashboardLayout from "@/components/DashboardLayout";
import NovaLogo from "@/components/NovaLogo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getNeonAccessToken } from "@/lib/neonAuth";
import { MarkdownText } from "@/lib/markdown";
import {
  collectChatImageAttachments,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_TOTAL_CHARS,
  type ChatImageAttachment,
} from "@/lib/imageAttachments";
import { LiveActivityCard, ToolRunGroup } from "@/lib/toolActivityLine";
import {
  appendLiveTextDelta,
  buildTurnItems,
  dedupeToolActivityMessages,
  groupPersistedChatItems,
  isInternalChatMessage,
  parsePersistedToolActivity,
  reconcileChatMessages,
  upsertLiveToolEvent,
  type LiveChatEvent,
  type ToolActivity,
  type TurnRenderItem,
} from "@/lib/chatMessages";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  CircleDashed,
  CornerDownLeft,
  Github,
  ImagePlus,
  Mail,
  MessageSquareText,
  Send,
  Square,
  X,
} from "lucide-react";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { LEGACY_AI_UNAVAILABLE_PREFIX, AI_UNAVAILABLE_PREFIX } from "@shared/const";
import { exchangeNeonVerifierAndGetJwt, neonAuth } from "@/lib/neonAuth";

/** Thumbnail strip of the images queued for the next message. */
function ImageAttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: ChatImageAttachment[];
  onRemove: (id: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {attachments.map(attachment => (
        <div
          key={attachment.id}
          className="relative size-16 overflow-hidden rounded-lg border border-foreground/[0.12] bg-muted/40 dark:border-white/[0.12]"
        >
          <img
            src={attachment.dataUri}
            alt={attachment.name}
            className="size-full object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.name}`}
            className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/65 text-white transition hover:bg-black/85"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Opening message for the guided personalisation session launched from Settings. */
const PERSONALISATION_KICKOFF =
  "Let's set up my personalisation. Ask me one question at a time about how I work and how I want you to work with me, wait for each answer, then save what you learn with set_personalisation and turn personalisation mode on.";

export default function Workspace() {
  const computer = trpc.workspace.computer.useQuery(undefined, {
    retry: false,
  });
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [draft, setDraft] = useState("");
  const [startPrompt, setStartPrompt] = useState("");
  const [pendingUserContent, setPendingUserContent] = useState("");
  const [liveEvents, setLiveEvents] = useState<LiveChatEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [baselineMessageId, setBaselineMessageId] = useState(0);
  const chatId =
    typeof window === "undefined"
      ? undefined
      : new URLSearchParams(window.location.search).get("chatId") || undefined;
  // One-shot flag set by Settings' "Start guided setup" button; the effect
  // below turns it into the opening message of a personalisation session.
  const personaliseIntent =
    typeof window === "undefined"
      ? false
      : new URLSearchParams(window.location.search).get("personalise") ===
        "1";
  const personaliseStartedRef = useRef(false);
  const [composerAttachments, setComposerAttachments] = useState<
    ChatImageAttachment[]
  >([]);
  const [starterAttachments, setStarterAttachments] = useState<
    ChatImageAttachment[]
  >([]);
  const [preparingImages, setPreparingImages] = useState(false);
  const composerImageInputRef = useRef<HTMLInputElement>(null);
  const starterImageInputRef = useRef<HTMLInputElement>(null);

  // Downscales and encodes picked/pasted files, then queues them for the next
  // message up to the per-message cap.
  const addChatImages = async (
    setter: React.Dispatch<React.SetStateAction<ChatImageAttachment[]>>,
    current: ChatImageAttachment[],
    files: Iterable<File>
  ) => {
    setPreparingImages(true);
    try {
      const { attachments: prepared, error } =
        await collectChatImageAttachments(files);
      if (error) toast.error(error);
      if (!prepared.length) return;
      const room = Math.max(0, MAX_CHAT_IMAGE_ATTACHMENTS - current.length);
      const accepted: ChatImageAttachment[] = [];
      let totalChars = current.reduce(
        (sum, attachment) => sum + attachment.dataUri.length,
        0
      );
      for (const attachment of prepared) {
        if (accepted.length >= room) break;
        if (
          totalChars + attachment.dataUri.length >
          MAX_CHAT_IMAGE_TOTAL_CHARS
        )
          continue;
        accepted.push(attachment);
        totalChars += attachment.dataUri.length;
      }
      if (accepted.length < prepared.length)
        toast.error(
          `Attach at most ${MAX_CHAT_IMAGE_ATTACHMENTS} images within the size limit.`
        );
      setter([...current, ...accepted]);
    } finally {
      setPreparingImages(false);
    }
  };

  // Starting a conversation clears any images queued on the previous one.
  useEffect(() => {
    setComposerAttachments([]);
  }, [chatId]);

  const contentFor = (text: string, attachments: ChatImageAttachment[]) =>
    text.trim() ||
    (attachments.length === 1
      ? `Uploaded ${attachments[0].name}`
      : `Uploaded ${attachments.length} images`);
  const canSendComposer =
    Boolean(draft.trim() || composerAttachments.length) && !preparingImages;
  const startChat = trpc.chats.create.useMutation({
    onSuccess: async chat => {
      await utils.workspace.computer.invalidate();
      setLocation(`/app?chatId=${chat.id}`);
    },
  });
  const canStartChat =
    Boolean(startPrompt.trim() || starterAttachments.length) &&
    !preparingImages &&
    !startChat.isPending &&
    !isStreaming;
  // While a conversation is open it polls every 2.5s so activity started
  // elsewhere (e.g. Telegram) streams into this view in real time.
  const savedMessages = trpc.chats.messages.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: Boolean(chatId),
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: Boolean(chatId) ? 2500 : false,
      refetchIntervalInBackground: false,
    }
  );
  // The backend ledger is the source of truth for active work. This keeps the
  // status visible after a refresh and for runs started from Telegram or a
  // continuation segment, where this browser does not own the fetch stream.
  const runStatus = trpc.chats.runStatus.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: Boolean(chatId),
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: Boolean(chatId) ? 1000 : false,
      refetchIntervalInBackground: false,
    }
  );
  const agentIsWorking = isStreaming || Boolean(runStatus.data?.active);
  // Stops the chat's in-flight agent run and its queued/running VM workflows
  // (the composer's send button turns into this stop button while Nova works).
  const stopRun = trpc.chats.stop.useMutation({
    onSuccess: () => runStatus.refetch(),
    onError: error =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Nova could not be stopped. Please try again."
      ),
  });
  const handleStopRun = () => {
    if (!chatId || stopRun.isPending) return;
    stopRun.mutate({ chatId });
  };
  // Connector/Telegram status feeds the home dashboard cards. These hooks
  // MUST run before any early return (React error #300 when the chat view
  // renders fewer hooks than the home view did), so they live up here with the
  // other hooks and are simply disabled while a chat conversation is open.
  const connectorStatus = trpc.composio.status.useQuery(undefined, {
    retry: false,
    enabled: !chatId,
  });
  const telegramStatus = trpc.telegram.status.useQuery(undefined, {
    retry: false,
    enabled: !chatId,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const handleChatScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUpRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight > 120;
  };

  useEffect(() => {
    userScrolledUpRef.current = false;
  }, [chatId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [chatId, savedMessages.data?.length, liveEvents, agentIsWorking]);

  // The header shows the chat's title, which the server auto-renames a moment
  // after a run finishes. When work transitions to done, refresh the workspace
  // query (and once more shortly after) so the renamed title appears without
  // waiting for a window refocus.
  const prevWorkingRef = useRef(false);
  useEffect(() => {
    const wasWorking = prevWorkingRef.current;
    prevWorkingRef.current = agentIsWorking;
    if (!chatId || wasWorking === agentIsWorking || agentIsWorking) return;
    void utils.workspace.computer.invalidate();
    const timer = setTimeout(
      () => void utils.workspace.computer.invalidate(),
      5000
    );
    return () => clearTimeout(timer);
  }, [agentIsWorking, chatId, utils]);

  // Persisted failure replies are marked with the (legacy) prefix; the raw
  // detail after it may name an internal service, so only fixed, generic
  // copy is ever rendered here.
  const isUnavailableReply = (content: string) =>
    content.startsWith(AI_UNAVAILABLE_PREFIX) ||
    content.startsWith(LEGACY_AI_UNAVAILABLE_PREFIX);

  useEffect(() => {
    if (typeof window === "undefined" || !neonAuth) return;
    const params = new URLSearchParams(window.location.search);
    const verifier = params.get("verifier");
    if (!verifier) return;
    void (async () => {
      try {
        const jwt = await exchangeNeonVerifierAndGetJwt(neonAuth);
        if (jwt) {
          params.delete("verifier");
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`
          );
          setLocation("/app");
        }
      } catch (err) {
        console.warn(
          "[Workspace] Failed to exchange Neon verifier",
          err instanceof Error ? err.message : err
        );
      }
    })();
  }, []);

  const refreshMessages = async (): Promise<boolean> => {
    try {
      await savedMessages.refetch();
      return !savedMessages.isError;
    } catch {
      return false;
    }
  };
  const finalizeStream = async (): Promise<boolean> => {
    const refreshed = await refreshMessages();
    setIsStreaming(false);
    if (refreshed) {
      setPendingUserContent("");
      setLiveEvents([]);
    } else {
      toast.error(
        "Nova replied, but it could not be reloaded yet. Please wait a moment before sending again."
      );
    }
    return refreshed;
  };
  /** Streams a message into `targetChatId`, reused by the active-chat composer and the "Start a chat" prompt box. */
  const sendMessage = async (
    targetChatId: string,
    content: string,
    images: string[] = []
  ) => {
    userScrolledUpRef.current = false;
    const toPersist = savedMessages.data ?? [];
    setBaselineMessageId(
      toPersist.length ? Math.max(...toPersist.map(message => message.id)) : 0
    );
    setPendingUserContent(content);
    setLiveEvents([]);
    setIsStreaming(true);
    try {
      const token = await getNeonAccessToken().catch(() => null);
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          chatId: targetChatId,
          content,
          ...(images.length ? { images } : {}),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Nova could not start this response. Please retry shortly."
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Stream not supported");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines)
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              await finalizeStream();
              await utils.workspace.computer.invalidate();
              return;
            }
            try {
              const parsed = JSON.parse(data) as {
                type?: string;
                tool?: ToolActivity;
                choices?: Array<{ delta?: { content?: string } }>;
              };
              if (parsed.type === "tool" && parsed.tool?.id) {
                setLiveEvents(previous =>
                  upsertLiveToolEvent(previous, parsed.tool!)
                );
                continue;
              }
              setLiveEvents(previous =>
                appendLiveTextDelta(
                  previous,
                  parsed.choices?.[0]?.delta?.content || ""
                )
              );
            } catch {
              /* Ignore malformed stream fragments. */
            }
          }
      }
      await finalizeStream();
    } catch (error) {
      console.error("Stream error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to send message"
      );
      await finalizeStream();
    }
  };
  const submit = async (event: FormEvent | React.KeyboardEvent) => {
    event.preventDefault();
    // While Nova works, both the Enter key and the composer button stop the run.
    if (agentIsWorking) {
      handleStopRun();
      return;
    }
    if ((!draft.trim() && !composerAttachments.length) || !chatId) return;
    const content = contentFor(draft, composerAttachments);
    const images = composerAttachments.map(attachment => attachment.dataUri);
    setDraft("");
    setComposerAttachments([]);
    await sendMessage(chatId, content, images);
  };
  /** Creates a new chat from the "Ask Nova anything about your work" box, navigates to it, then streams the typed prompt as its first message. */
  const handleStartChat = async () => {
    if (
      (!startPrompt.trim() && !starterAttachments.length) ||
      startChat.isPending ||
      agentIsWorking
    )
      return;
    const content = contentFor(startPrompt, starterAttachments);
    const images = starterAttachments.map(attachment => attachment.dataUri);
    try {
      const chat = await startChat.mutateAsync({
        title: "New workspace conversation",
      });
      setStartPrompt("");
      setStarterAttachments([]);
      setLocation(`/app?chatId=${chat.id}`);
      await sendMessage(chat.id, content, images);
    } catch (error) {
      console.error("Failed to start chat:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Nova could not start that conversation."
      );
    }
  };
  // A chat opened from Settings' "Start guided setup" link begins with the
  // personalisation kickoff, once. The intent is stripped from the URL so a
  // refresh or share does not send it again.
  useEffect(() => {
    if (!chatId || !personaliseIntent || personaliseStartedRef.current) return;
    if (savedMessages.isLoading || agentIsWorking) return;
    if ((savedMessages.data ?? []).length > 0) return;
    personaliseStartedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    params.delete("personalise");
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`
    );
    void sendMessage(chatId, PERSONALISATION_KICKOFF);
  }, [chatId, personaliseIntent, savedMessages.isLoading, savedMessages.data, agentIsWorking]);

  if (computer.isError)
    return <WorkspaceError onRetry={() => computer.refetch()} />;
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
    const liveTextContent = liveEvents.reduce(
      (acc, event) => (event.kind === "text" ? acc + event.content : acc),
      ""
    );
    const liveTools = liveEvents.flatMap(event =>
      event.kind === "tool" ? [event.activity] : []
    );
    const { userCommitted, liveActivities } = reconcileChatMessages(
      persisted,
      baselineMessageId,
      pendingUserContent,
      liveTextContent,
      liveTools
    );
    // Rows written before this submission read as settled history. Everything
    // above the baseline is this turn, laid out as one arrival-ordered
    // timeline - user, what Nova said, the tools it used, what it said next -
    // so a line written before calling tools stays above those tools instead
    // of being left behind below them.
    const rows: TurnRenderItem[] = [];
    for (const item of groupPersistedChatItems(
      visibleMessages.filter(message => message.id <= baselineMessageId)
    )) {
      if (item.kind === "toolRun")
        rows.push({
          kind: "toolRun",
          key: `tools-${item.activities[0].id}`,
          activities: item.activities,
          live: false,
        });
      else if (item.message.role === "user")
        rows.push({
          kind: "user",
          key: `user-${item.message.id}`,
          content: item.message.content,
          pending: false,
        });
      else
        rows.push({
          kind: "reply",
          key: `reply-${item.message.id}`,
          content: item.message.content,
          live: false,
        });
    }
    rows.push(
      ...buildTurnItems({
        messages: visibleMessages.filter(
          message => message.id > baselineMessageId
        ),
        liveEvents,
        pendingUserContent,
        userCommitted,
      })
    );
    // "Nova" labels the first thing it says in a turn, exactly once.
    const novaLeadsRow = (index: number) =>
      index === 0 || rows[index - 1].kind === "user";
    const hasLiveRow = rows.some(row => row.kind !== "user" && row.live);
    const showTyping = agentIsWorking && !hasLiveRow;
    const typingLabel =
      rows.length === 0 || rows[rows.length - 1].kind === "user";
    const persistedToolRuns = visibleMessages.filter(message =>
      parsePersistedToolActivity(message.content)
    ).length;
    // The header names the conversation; "Nova" covers the brief moment
    // before the workspace query (or the chat row) has loaded.
    const currentChatTitle =
      computer.data?.chats.find(chat => chat.id === chatId)?.title ?? "Nova";
    return (
      <DashboardLayout>
        <section className="chat-editorial-shell relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-foreground">
          <div className="chat-editorial-orbit pointer-events-none absolute -right-40 -top-48 size-[34rem] rounded-full border border-primary/[0.12] dark:border-primary/[0.16]" />
          <div className="chat-editorial-orbit pointer-events-none absolute -bottom-72 -left-56 size-[32rem] rounded-full border border-foreground/[0.06] dark:border-white/[0.07]" />
          <header className="relative z-10 shrink-0 border-b border-foreground/[0.10] bg-background/75 backdrop-blur-xl dark:border-white/[0.10]">
            <div className="mx-auto flex min-h-[4.5rem] w-full max-w-[1240px] items-center gap-3 px-4 sm:px-7">
              <button
                onClick={() => setLocation("/app/chats")}
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-foreground/[0.12] bg-card/70 text-muted-foreground transition hover:-translate-x-0.5 hover:border-primary/45 hover:text-foreground dark:border-white/[0.12]"
                aria-label="Back to chats"
              >
                <ArrowLeft className="size-4" />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <NovaLogo size={18} className="shrink-0" />
                <div className="min-w-0">
                  <span className="block truncate text-[15px] font-bold tracking-[-0.02em] leading-tight">
                    {currentChatTitle}
                  </span>
                  {agentIsWorking && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                      <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                      Working…
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setLocation("/app")}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[11px] font-bold text-background shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-white dark:text-black"
              >
                <MessageSquareText className="size-3.5" />
                New thread
              </button>
            </div>
          </header>

          <div
            ref={scrollRef}
            onScroll={handleChatScroll}
            className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-7 sm:px-7 sm:py-10"
          >
            <div
              className={`mx-auto grid w-full max-w-[1240px] min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_248px] lg:gap-14${
                rows.length > 0 ? " mt-auto" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-col gap-6">
                  {savedMessages.isLoading ? (
                    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                      <TypingIndicator />
                      <span>Opening the thread…</span>
                    </div>
                  ) : rows.length === 0 && !agentIsWorking ? (
                    <div className="chat-blank-state relative isolate overflow-hidden border border-foreground/[0.12] bg-card/75 px-6 py-12 shadow-[0_24px_80px_rgba(36,40,34,0.08)] sm:px-12 sm:py-16 dark:border-white/[0.10] dark:bg-white/[0.045] dark:shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
                      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full border border-primary/20" />
                      <div className="relative max-w-2xl">
                        <h1 className="max-w-2xl font-serif text-4xl font-medium leading-[0.98] tracking-[-0.045em] text-foreground sm:text-6xl">
                          How can I help?
                        </h1>
                        <p className="mt-6 max-w-lg text-sm leading-7 text-muted-foreground sm:text-base">
                          Ask about your files, hand off a task, or set
                          something up. Nova works inside this workspace and can
                          read, write, and run things for you.
                        </p>
                        <div className="mt-9 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setDraft("Summarize what's in my workspace files")
                            }
                            className="border border-foreground/[0.13] bg-background/60 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/[0.06] dark:border-white/[0.12]"
                          >
                            Summarize my files
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDraft("Help me organize my files and folders")
                            }
                            className="border border-foreground/[0.13] bg-background/60 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/[0.06] dark:border-white/[0.12]"
                          >
                            Organize my folders
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDraft("What can you do in this workspace?")
                            }
                            className="border border-foreground/[0.13] bg-background/60 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/[0.06] dark:border-white/[0.12]"
                          >
                            What can you do?
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    rows.map(row => {
                      const index = rows.indexOf(row);
                      if (row.kind === "toolRun")
                        return row.live ? (
                          <div
                            key={row.key}
                            className="chat-in flex w-full shrink-0 flex-col pl-0 sm:pl-12"
                          >
                            {novaLeadsRow(index) && (
                              <p className="mb-1 ml-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                Nova
                              </p>
                            )}
                            <LiveActivityCard
                              activities={row.activities}
                              working={agentIsWorking}
                            />
                          </div>
                        ) : (
                          <div
                            key={row.key}
                            className="chat-in flex w-full shrink-0 pl-0 sm:pl-12"
                          >
                            <ToolRunGroup activities={row.activities} />
                          </div>
                        );
                      if (row.kind === "user")
                        return (
                          <div
                            key={row.key}
                            className="chat-in flex w-full shrink-0 justify-end"
                          >
                            <div className="max-w-[92%] border border-primary/20 bg-primary px-4 py-3 text-[15px] leading-6 text-primary-foreground shadow-[0_8px_24px_rgba(130,70,35,0.16)] sm:max-w-[78%]">
                              {row.content}
                            </div>
                          </div>
                        );
                      const isLast = rows.indexOf(row) === rows.length - 1;
                      const streaming = row.live && agentIsWorking && isLast;
                      return (
                        <div
                          key={row.key}
                          className="chat-in flex w-full shrink-0 items-start gap-3"
                        >
                          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background shadow-sm dark:bg-white dark:text-black">
                            <NovaLogo size={12} />
                          </span>
                          <div className="min-w-0 max-w-[calc(100%-2.75rem)]">
                            <div className="mb-2 flex items-center gap-2">
                              {novaLeadsRow(index) && (
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                  Nova
                                </p>
                              )}
                              {streaming && (
                                <span className="size-1 animate-pulse rounded-full bg-primary" />
                              )}
                            </div>
                            {isUnavailableReply(row.content) ? (
                              <div
                                data-testid="assistant-error"
                                className="flex items-start gap-2 break-words border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 shadow-sm sm:px-5 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300"
                              >
                                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                <div>
                                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                                    Nova is offline
                                  </p>
                                  <span>
                                    Nova hit an unexpected error and could not
                                    finish this reply. Everything so far is
                                    saved - please try again shortly.
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="border-l border-primary/40 bg-card/65 px-4 py-3.5 text-[15px] leading-7 shadow-[0_8px_30px_rgba(36,40,34,0.035)] dark:bg-white/[0.045]">
                                <div className="break-words text-foreground">
                                  <MarkdownText text={row.content} />
                                  {streaming && (
                                    <span className="stream-caret" />
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {showTyping && (
                    <div className="chat-in flex w-full shrink-0 items-start gap-3">
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background shadow-sm dark:bg-white dark:text-black">
                        <NovaLogo size={12} />
                      </span>
                      <div className="min-w-0 max-w-[calc(100%-2.75rem)]">
                        <div className="mb-2 flex items-center gap-2">
                          {typingLabel && (
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                              Nova
                            </p>
                          )}
                          {typingLabel && (
                            <span className="size-1 animate-pulse rounded-full bg-primary" />
                          )}
                        </div>
                        <div className="border-l border-primary/40 bg-card/65 px-4 py-3.5 shadow-sm dark:bg-white/[0.045]">
                          <TypingIndicator />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <aside className="hidden lg:block">
                <div className="sticky top-5 border-t-2 border-primary bg-card/55 pt-4 dark:bg-white/[0.035]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    In this thread
                  </p>
                  <div className="mt-4 divide-y divide-foreground/[0.08] text-xs dark:divide-white/[0.08]">
                    <div className="flex items-center justify-between py-3">
                      <span className="text-muted-foreground">Messages</span>
                      <span className="font-bold text-foreground">
                        {visibleMessages.length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <span className="text-muted-foreground">Tool runs</span>
                      <span className="font-bold text-foreground">
                        {persistedToolRuns + liveActivities.length}
                      </span>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>

          <form
            onSubmit={submit}
            className="chat-editorial-composer relative z-10 shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-7 sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto w-full max-w-[1240px]">
              <div className="border border-foreground/[0.14] bg-card/85 p-2 shadow-[0_14px_45px_rgba(36,40,34,0.10)] backdrop-blur-xl transition focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/[0.12] dark:bg-white/[0.06] dark:shadow-[0_14px_45px_rgba(0,0,0,0.25)]">
                <div className="flex items-center justify-end px-2.5 pb-1.5">
                  <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">
                    Enter to send
                  </span>
                </div>
                <ImageAttachmentTray
                  attachments={composerAttachments}
                  onRemove={id =>
                    setComposerAttachments(previous =>
                      previous.filter(attachment => attachment.id !== id)
                    )
                  }
                />
                <input
                  ref={composerImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  hidden
                  onChange={event => {
                    const files = event.target.files;
                    if (files?.length)
                      void addChatImages(
                        setComposerAttachments,
                        composerAttachments,
                        files
                      );
                    event.target.value = "";
                  }}
                />
                <div className="flex items-end gap-2 border border-foreground/[0.08] bg-background/55 p-2 pl-3.5 dark:border-white/[0.08] dark:bg-white/[0.035]">
                  <Textarea
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void submit(event);
                      }
                    }}
                    onPaste={event => {
                      const files = Array.from(
                        event.clipboardData?.files ?? []
                      ).filter(file => file.type.startsWith("image/"));
                      if (!files.length) return;
                      event.preventDefault();
                      void addChatImages(
                        setComposerAttachments,
                        composerAttachments,
                        files
                      );
                    }}
                    placeholder="Message Nova"
                    rows={1}
                    className="max-h-28 min-h-10 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-1.5 text-[16px] leading-6 placeholder:text-muted-foreground focus-visible:ring-0 sm:text-[15px]"
                  />
                  {!agentIsWorking && (
                    <button
                      type="button"
                      onClick={() => composerImageInputRef.current?.click()}
                      disabled={preparingImages}
                      aria-label="Attach images"
                      className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50 dark:hover:bg-white/[0.08]"
                    >
                      <ImagePlus className="size-4" />
                    </button>
                  )}
                  {agentIsWorking ? (
                    <button
                      type="submit"
                      aria-label="Stop Nova"
                      className="grid size-10 shrink-0 place-items-center rounded-lg bg-red-600 text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-red-500 hover:shadow-md"
                    >
                      <Square className="size-4 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!canSendComposer}
                      aria-label="Send message"
                      className={
                        canSendComposer
                          ? "grid size-10 shrink-0 place-items-center rounded-lg bg-foreground text-background shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-white dark:text-black"
                          : "grid size-10 shrink-0 place-items-center rounded-lg bg-foreground/[0.07] text-muted-foreground transition dark:bg-white/[0.08]"
                      }
                    >
                      <ArrowUp className="size-4" />
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 hidden text-center text-[10px] font-medium text-muted-foreground sm:block">
                <CornerDownLeft className="mr-1 inline size-3" />
                Shift+Enter for a new line
              </p>
            </div>
          </form>
        </section>
      </DashboardLayout>
    );
  }

  const githubConnected =
    connectorStatus.data?.toolkits?.github?.connected ?? false;
  const gmailConnected =
    connectorStatus.data?.toolkits?.gmail?.connected ?? false;
  // The bot token being configured is not "connected": the owner's Telegram
  // chat only counts as Ready once Telegram has actually linked a chat.
  const telegramLinked = Boolean(
    telegramStatus.data?.configured && telegramStatus.data?.chatId
  );
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const connectors = [
    {
      name: "Telegram",
      icon: Send,
      available: telegramLinked,
      detail:
        "Delivers messages and routine updates straight to your Telegram chat.",
    },
    {
      name: "GitHub",
      icon: Github,
      available: githubConnected,
      detail:
        "Star repos, file issues and open pull requests from a task. Connect it in Settings.",
    },
    {
      name: "Gmail",
      icon: Mail,
      available: gmailConnected,
      detail:
        "Search, send and reply to email from a task. Connect it in Settings.",
    },
    {
      name: "More connectors",
      icon: CircleDashed,
      available: false,
      detail:
        "Slack and Notion are on the roadmap - tell Nova what you need next.",
    },
  ];

  return (
    <DashboardLayout>
      <div className="chat-editorial-shell relative min-h-full overflow-hidden">
        <div className="chat-editorial-orbit pointer-events-none absolute -right-48 -top-56 size-[36rem] rounded-full border border-primary/[0.12] dark:border-primary/[0.16]" />
        <div className="relative mx-auto grid max-w-[1240px] gap-12 px-4 py-12 sm:px-7 sm:py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.65fr)] lg:items-start lg:gap-20">
          <div className="rise-in">
            <p className="text-[10px] font-bold uppercase tracking-[0.20em] text-primary">
              Private workbench / {greeting}
            </p>
            <h1 className="mt-6 max-w-3xl font-serif text-5xl font-medium leading-[0.94] tracking-[-0.055em] text-foreground sm:text-7xl">
              What are we working on today?
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
              Open a thread for whatever needs doing — a question, a file, or a
              task you would rather hand off.
            </p>
            <div className="mt-10 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-emerald-500" />
              Your workspace stays private to your account
            </div>
          </div>

          <div className="rise-in-delay-1 border-t-2 border-primary bg-card/75 p-4 shadow-[0_20px_70px_rgba(36,40,34,0.08)] dark:bg-white/[0.045] dark:shadow-[0_20px_70px_rgba(0,0,0,0.20)] sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                <MessageSquareText className="size-3.5 text-primary" />
                New thread
              </span>
              <span className="text-[10px] text-muted-foreground">Enter ↵</span>
            </div>
            <ImageAttachmentTray
              attachments={starterAttachments}
              onRemove={id =>
                setStarterAttachments(previous =>
                  previous.filter(attachment => attachment.id !== id)
                )
              }
            />
            <input
              ref={starterImageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={event => {
                const files = event.target.files;
                if (files?.length)
                  void addChatImages(
                    setStarterAttachments,
                    starterAttachments,
                    files
                  );
                event.target.value = "";
              }}
            />
            <Textarea
              value={startPrompt}
              onChange={event => setStartPrompt(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleStartChat();
                }
              }}
              onPaste={event => {
                const files = Array.from(
                  event.clipboardData?.files ?? []
                ).filter(file => file.type.startsWith("image/"));
                if (!files.length) return;
                event.preventDefault();
                void addChatImages(
                  setStarterAttachments,
                  starterAttachments,
                  files
                );
              }}
              placeholder="What do you want Nova to help with?"
              rows={5}
              disabled={startChat.isPending || isStreaming}
              className="mt-6 max-h-40 min-h-32 w-full resize-none border-0 bg-transparent px-0 py-1.5 text-[17px] leading-7 placeholder:text-muted-foreground focus-visible:ring-0"
            />
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-foreground/[0.10] pt-4 dark:border-white/[0.10]">
              <span className="text-[10px] font-medium text-muted-foreground">
                Nova sees only your workspace.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => starterImageInputRef.current?.click()}
                  disabled={preparingImages || startChat.isPending || isStreaming}
                  aria-label="Attach images"
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50 dark:hover:bg-white/[0.08]"
                >
                  <ImagePlus className="size-4" />
                </button>
                <Button
                  type="button"
                  onClick={() => void handleStartChat()}
                  disabled={!canStartChat}
                  className={
                    canStartChat
                    ? "rounded-lg bg-foreground px-3.5 py-2 text-xs font-bold text-background hover:bg-foreground/90 dark:bg-white dark:text-black"
                      : "rounded-lg bg-muted px-3.5 py-2 text-xs font-bold text-muted-foreground hover:bg-muted dark:bg-white/5 dark:hover:bg-white/10"
                  }
                >
                  {startChat.isPending ? "Opening…" : "Open thread"}
                </Button>
              </div>
            </div>
          </div>

          <div className="rise-in-delay-2 lg:col-span-2">
            <div className="mb-4 flex items-end justify-between gap-3 border-b border-foreground/[0.10] pb-3 dark:border-white/[0.10]">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                  Tools on hand
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nova can work across the places you already use.
                </p>
              </div>
              <span className="hidden text-[10px] text-muted-foreground sm:block">
                Connect only what you need
              </span>
            </div>
            <div className="grid gap-px overflow-hidden border border-foreground/[0.10] bg-foreground/[0.10] sm:grid-cols-2 lg:grid-cols-4 dark:border-white/[0.10] dark:bg-white/[0.10]">
              {connectors.map(connector => {
                const ConnectorIcon = connector.icon;
                const needsSetup =
                  connector.name !== "More connectors" && !connector.available;
                const Card = needsSetup ? "button" : "div";
                return (
                  <Card
                    key={connector.name}
                    onClick={
                      needsSetup
                        ? () => setLocation("/app/settings")
                        : undefined
                    }
                    className="bg-card/85 px-4 py-4 text-left transition hover:bg-primary/[0.06] dark:bg-card/85 dark:hover:bg-white/[0.07]"
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <span className="grid size-7 shrink-0 place-items-center bg-primary/10 text-primary">
                        <ConnectorIcon className="size-3.5" />
                      </span>
                      <span className="min-w-0 truncate">{connector.name}</span>
                      <span
                        className={
                          connector.available
                            ? "ml-auto flex shrink-0 items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
                            : "ml-auto shrink-0 text-[10px] font-bold text-muted-foreground"
                        }
                      >
                        {connector.available && (
                          <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500" />
                        )}
                        {connector.available
                          ? "Ready"
                          : connector.name === "More connectors"
                            ? "Soon"
                            : "Connect"}
                      </span>
                    </span>
                    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                      {connector.detail}
                    </p>
                  </Card>
                );
              })}
            </div>
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

function WorkspaceError({ onRetry }: { onRetry: () => void }) {
  return (
    <DashboardLayout>
      <div className="grid min-h-[65vh] place-items-center px-4 text-center">
        <div>
          <NovaLogo size={40} className="mx-auto" />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
            Nova could not open your computer.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
            Your workspace remains private. Try reconnecting to your computer.
          </p>
          <Button
            className="mt-5 rounded-full bg-primary hover:bg-primary/90"
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
