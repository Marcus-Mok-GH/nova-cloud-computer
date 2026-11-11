import DashboardLayout from "@/components/DashboardLayout";
import PromptModelControls from "@/components/PromptModelControls";
import NovaLogo from "@/components/NovaLogo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  effortOptionsForModelId,
  FREE_CHAT_MODEL_ID,
  getChatModels,
  type EffortId,
} from "@shared/models";
import { MarkdownText } from "@/lib/markdown";
import { LiveActivityCard, ToolRunGroup } from "@/lib/toolActivityLine";
import {
  buildTurnItems,
  chatWorkflowMode,
  dedupeToolActivityMessages,
  groupPersistedChatItems,
  isContinuationPrompt,
  isInternalChatMessage,
  latestFollowUpSuggestions,
  parsePersistedToolActivity,
  reconcileChatMessages,
  type ChatWorkflowMode,
  type ToolActivity,
  type TurnRenderItem,
} from "@/lib/chatMessages";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  CornerDownLeft,
  History,
  ImagePlus,
  Loader2,
  MessageSquareText,
  Paperclip,
  Settings2,
  Square,
} from "lucide-react";
// JSX compiles to React.createElement in this build (classic runtime), so the
// default React binding must stay imported even without explicit React.* calls.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  LEGACY_AI_UNAVAILABLE_PREFIX,
  AI_UNAVAILABLE_PREFIX,
} from "@shared/const";
import { latestGoalState } from "@shared/goal";
import { SLASH_COMMANDS, type SlashCommand } from "@shared/commands";
import { SLASH_MENU_ID, SlashCommandMenu } from "@/components/SlashCommandMenu";
import { GoalBadge } from "@/components/GoalBadge";
import { ModelSelector } from "@/components/ModelSelector";
import { PersonalitySelector } from "@/components/PersonalitySelector";
import {
  matchSlashCommands,
  slashCommandInsertion,
  slashCommandQuery,
} from "@/lib/slashCommands";
import { exchangeNeonVerifierAndGetJwt, neonAuth } from "@/lib/neonAuth";
import { toast } from "sonner";
import { useWorkspaceChat } from "@/hooks/useWorkspaceChat";
import { dragCarriesFiles, isDesktopDragDrop } from "@/lib/fileAttachments";
import {
  AttachmentTray,
  CopyMessageButton,
  EnvVarRequestComposer,
  RegenerateMessageButton,
  SpeakMessageButton,
  TurnTimestamp,
  WorkspaceError,
} from "@/components/workspaceChat";

export { teamPlanKickoff } from "@/hooks/useWorkspaceChat";

/**
 * The Nova workspace screen: the Overview home page (headline + connectors)
 * when no conversation is open, and the thread view with its composer once a
 * chat is selected.
 */
export default function Workspace() {
  const computer = trpc.workspace.computer.useQuery(undefined, {
    retry: false,
  });
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const chatId =
    typeof window === "undefined"
      ? undefined
      : new URLSearchParams(window.location.search).get("chatId") || undefined;
  const {
    draft,
    setDraft,
    composerAttachments,
    setComposerAttachments,
    preparingAttachments,
    composerImageInputRef,
    addChatAttachments,
    canSendComposer,
    submit,
    sendMessage,
    handleRegenerate,
    savedMessages,
    queueNotice,
    priorityNotice,
    agentIsWorking,
    composerBusy,
    pendingUserContent,
    baselineMessageId,
    liveEvents,
    stopLedgerCutoffId,
    settledWhileAway,
    revertChat,
    userScrolledUpRef,
    pendingEnvVarRequests,
    fulfillEnvVarRequest,
    dismissEnvVarRequest,
    fulfillingEnvVarRequest,
  } = useWorkspaceChat({ chatId, utils, computer });
  // While the agent waits on a value only the user can supply (a set_env_var
  // request), the composer becomes a secure value input instead of the
  // message box - hidden while a run is working, so Stop stays reachable.
  const pendingEnvVarRequest =
    !composerBusy && pendingEnvVarRequests.length > 0
      ? pendingEnvVarRequests[0]
      : undefined;

  const scrollRef = useRef<HTMLDivElement>(null);

  const handleChatScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUpRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight > 120;
  };

  // Desktop drag & drop: while files hover the chat, an overlay invites the
  // drop and any file lands in the composer tray (images through the image
  // pipeline, everything else as a workspace upload). Entering/leaving child
  // elements is counted so the overlay survives the pointer crossing nested
  // elements. Touch devices are skipped - the affordance is desktop-only.
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);
  const filesDraggedOver = (event: React.DragEvent) =>
    isDesktopDragDrop() && dragCarriesFiles(event.dataTransfer?.types);
  const handleDragEnter = (event: React.DragEvent) => {
    if (!filesDraggedOver(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  };
  const handleDragOver = (event: React.DragEvent) => {
    if (!filesDraggedOver(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const handleDragLeave = () => {
    if (!draggingFiles) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  };
  const handleDrop = (event: React.DragEvent) => {
    if (!dragCarriesFiles(event.dataTransfer?.types)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    const files = event.dataTransfer?.files;
    if (files?.length)
      void addChatAttachments(
        setComposerAttachments,
        composerAttachments,
        Array.from(files)
      );
  };

  // Slash commands: a "/" at the start of the composer offers the commands a
  // conversation understands, fuzzy-matched as the user keeps typing. The menu
  // only borrows the keyboard while it is open - once it closes (a space, a
  // pick, or Escape) Enter sends the message exactly as it always did.
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const slashQuery = slashCommandQuery(draft);
  const slashMatches = useMemo(
    () =>
      slashQuery === null || slashMenuDismissed
        ? []
        : matchSlashCommands(SLASH_COMMANDS, slashQuery),
    [slashQuery, slashMenuDismissed]
  );
  const slashMenuOpen = slashMatches.length > 0;
  // Clamped rather than trusted: a shrinking result list must still leave a
  // command highlighted.
  const activeSlashIndex = Math.min(
    slashActiveIndex,
    Math.max(0, slashMatches.length - 1)
  );
  const activeSlashCommand = slashMatches[activeSlashIndex];

  // Each new query starts its own highlight, and Escape's dismissal lasts only
  // until the next keystroke.
  useEffect(() => {
    setSlashActiveIndex(0);
    setSlashMenuDismissed(false);
  }, [slashQuery]);

  const pickSlashCommand = (command: SlashCommand) => {
    setDraft(slashCommandInsertion(command));
    const composer = composerRef.current;
    if (!composer) return;
    // Replacing the value can leave the caret at the start, so put it after the
    // command we just inserted, ready for the task it takes.
    requestAnimationFrame(() => {
      composer.focus();
      composer.setSelectionRange(composer.value.length, composer.value.length);
    });
  };

  const handleComposerKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (slashMenuOpen) {
      const step = (delta: number) => {
        event.preventDefault();
        setSlashActiveIndex(
          index => (index + delta + slashMatches.length) % slashMatches.length
        );
      };
      if (event.key === "ArrowDown") return step(1);
      if (event.key === "ArrowUp") return step(-1);
      // Enter picks the highlighted command instead of sending: a half-typed
      // command should complete, never leave as a message. Shift+Enter still
      // opens a new line, which ends the command and closes the menu.
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        if (activeSlashCommand) pickSlashCommand(activeSlashCommand);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashMenuDismissed(true);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit(event);
    }
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

  // The overview's task-prompt model + effort selection. Declared before any
  // early return so the hook count is identical whether or not a chat is open:
  // submitting the prompt navigates to a chat, and declaring these below the
  // `if (chatId)` return would drop hooks on that re-render (React error #300).
  const createChat = trpc.chats.create.useMutation({
    onSuccess: () => {
      void utils.workspace.chats.invalidate();
      void utils.workspace.computer.invalidate();
    },
  });
  const subscription = trpc.billing.subscription.useQuery(undefined, {
    retry: false,
  });
  const [selectedModelId, setSelectedModelId] = useState(FREE_CHAT_MODEL_ID);
  const [selectedEffortId, setSelectedEffortId] = useState<EffortId>("auto");
  const [startingSession, setStartingSession] = useState(false);

  if (computer.isError)
    return <WorkspaceError onRetry={() => computer.refetch()} />;
  if (chatId) {
    const ledgerRows = savedMessages.data ?? [];
    // While a stop is being carried out, hold the ledger at the rows that were
    // on screen when the button was pressed: rows the server persists while it
    // winds the run down must not make the transcript grow under the reader.
    const persisted =
      stopLedgerCutoffId > 0
        ? ledgerRows.filter(message => message.id <= stopLedgerCutoffId)
        : ledgerRows;
    // The newest reply's follow-up chips, read from the ledger so a reload
    // shows the same suggestions. They are hidden while a run is in flight -
    // the suggestions describe a settled turn, and a tap mid-run would only
    // queue behind it - and they go stale the moment the reader replies.
    const followUpSuggestions = agentIsWorking
      ? []
      : latestFollowUpSuggestions(persisted);
    // The autonomous goal this conversation is chasing (from the same ledger
    // rows the server reads), shown as a header badge. Null for a chat that
    // never had one, or whose goal the user cleared.
    const chatGoal = latestGoalState(persisted);
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
          createdAt: item.activities[0].createdAt ?? null,
        });
      else if (item.message.role === "user")
        rows.push({
          kind: "user",
          key: `user-${item.message.id}`,
          messageId: item.message.id,
          content: item.message.content,
          pending: false,
          createdAt: item.message.createdAt ?? null,
        });
      else
        rows.push({
          kind: "reply",
          key: `reply-${item.message.id}`,
          messageId: item.message.id,
          content: item.message.content,
          live: false,
          createdAt: item.message.createdAt ?? null,
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
        streaming: agentIsWorking,
      })
    );
    // "Nova" labels the first thing it says in a turn, exactly once.
    const novaLeadsRow = (index: number) =>
      index === 0 || rows[index - 1].kind === "user";
    const hasLiveRow = rows.some(row => row.kind !== "user" && row.live);
    const showTyping = agentIsWorking && !hasLiveRow;
    const typingLabel =
      rows.length === 0 || rows[rows.length - 1].kind === "user";
    // The newest reply, which carries the follow-up chips. Not necessarily
    // the last row: a preparing-next-turn activity run renders after it.
    let lastReplyIndex = -1;
    for (let index = 0; index < rows.length; index += 1)
      if (rows[index].kind === "reply") lastReplyIndex = index;
    const persistedToolRuns = visibleMessages.filter(message =>
      parsePersistedToolActivity(message.content)
    ).length;
    // The header names the conversation; "Nova" covers the brief moment
    // before the workspace query (or the chat row) has loaded.
    const currentChatTitle =
      computer.data?.chats.find(chat => chat.id === chatId)?.title ?? "Nova";
    // The workflow stage the conversation is in, shown as a header badge.
    const workflowBadge: Record<
      ChatWorkflowMode,
      { label: string; className: string; title: string }
    > = {
      chat: {
        label: "Chat",
        className: "border-foreground/[0.14] bg-muted/70 text-muted-foreground",
        title:
          "Chat mode - Nova answers and researches, then plans before it acts.",
      },
      plan: {
        label: "Planning",
        className: "border-primary/30 bg-primary/10 text-primary",
        title: "Planning mode - Nova is drafting a plan for your approval.",
      },
      build: {
        label: "Build",
        className:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        title: "Build mode - Nova is carrying out the approved plan.",
      },
    };
    const modeBadge = workflowBadge[chatWorkflowMode(persisted)];
    return (
      <DashboardLayout>
        <section
          className="chat-editorial-shell relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-foreground"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="chat-editorial-orbit pointer-events-none absolute -right-40 -top-48 size-[34rem] rounded-full border border-primary/[0.12] dark:border-primary/[0.16]" />
          <div className="chat-editorial-orbit pointer-events-none absolute -bottom-72 -left-56 size-[32rem] rounded-full border border-foreground/[0.06] dark:border-white/[0.07]" />
          <header className="relative z-10 shrink-0 border-b border-foreground/[0.10] bg-background/75 backdrop-blur-xl dark:border-white/[0.10]">
            <div className="mx-auto flex min-h-[4.5rem] w-full max-w-[1240px] items-center gap-3 px-4 sm:px-7">
              <button
                onClick={() => setLocation("/app/chats")}
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-foreground/[0.12] bg-card/70 text-muted-foreground transition hover:-translate-x-0.5 hover:border-primary/45 hover:text-foreground dark:border-white/[0.12]"
                aria-label="Back to chats"
              >
                <ArrowLeft className="size-4 rtl:-scale-x-100" />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <NovaLogo size={18} className="shrink-0" />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="block truncate text-[15px] font-bold tracking-[-0.02em] leading-tight">
                      {currentChatTitle}
                    </span>
                    <span
                      title={modeBadge.title}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${modeBadge.className}`}
                    >
                      <span className="size-1.5 rounded-full bg-current opacity-70" />
                      {modeBadge.label}
                    </span>
                    <GoalBadge goal={chatGoal} />
                  </div>
                  {agentIsWorking && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                      <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                      Working…
                    </span>
                  )}
                  {settledWhileAway && !agentIsWorking && (
                    <span
                      data-testid="settled-while-away"
                      role="status"
                      className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                    >
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Updated while you were away
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
                    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
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
                          <button
                            type="button"
                            onClick={() => setDraft("/ultraplan ")}
                            className="border border-foreground/[0.13] bg-background/60 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/[0.06] dark:border-white/[0.12]"
                          >
                            Ultraplan a task
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
                            className="chat-in flex w-full shrink-0 flex-col ps-0 sm:ps-12"
                          >
                            {novaLeadsRow(index) && (
                              <p className="mb-1 ms-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
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
                            className="chat-in flex w-full shrink-0 ps-0 sm:ps-12"
                          >
                            <ToolRunGroup activities={row.activities} />
                          </div>
                        );
                      if (row.kind === "user") {
                        // The automatic-continuation turn the server
                        // persists when a segment ran out of time: the
                        // user never typed it, so it renders as a quiet
                        // resume divider - not as their orange bubble
                        // with copy/speak actions on system instructions.
                        if (isContinuationPrompt(row.content))
                          return (
                            <div
                              key={row.key}
                              data-testid="continuation-divider"
                              role="status"
                              className="chat-in flex w-full shrink-0 items-center gap-3 px-1"
                            >
                              <span className="h-px flex-1 bg-foreground/[0.10] dark:bg-white/[0.12]" />
                              <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                                <History className="size-3.5 text-primary" />
                                Resuming automatically
                              </span>
                              <span className="h-px flex-1 bg-foreground/[0.10] dark:bg-white/[0.12]" />
                            </div>
                          );
                        return (
                          <div
                            key={row.key}
                            className="chat-in flex w-full shrink-0 flex-col gap-1.5"
                          >
                            <TurnTimestamp createdAt={row.createdAt ?? null} />
                            <div className="flex flex-col items-end gap-1.5">
                            <div className="max-w-[92%] border border-primary/20 bg-primary px-4 py-3 text-[15px] leading-6 text-primary-foreground shadow-[0_8px_24px_rgba(130,70,35,0.16)] sm:max-w-[78%]">
                              {row.content}
                            </div>
                            <div className="flex items-center justify-end gap-1.5">
                              <SpeakMessageButton text={row.content} />
                              <CopyMessageButton text={row.content} />
                            </div>
                            </div>
                          </div>
                        );
                      }
                      const isLast = rows.indexOf(row) === rows.length - 1;
                      const streaming = row.live && agentIsWorking && isLast;
                      const unavailable = isUnavailableReply(row.content);
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
                            {unavailable ? (
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
                              <div className="border-s border-primary/40 bg-card/65 px-4 py-3.5 text-[15px] leading-7 shadow-[0_8px_30px_rgba(36,40,34,0.035)] dark:bg-white/[0.045]">
                                <div className="break-words text-foreground">
                                  <MarkdownText text={row.content} />
                                  {streaming && (
                                    <span className="stream-caret" />
                                  )}
                                </div>
                              </div>
                            )}
                            {/* The sanitized error block never offers a copy:
                                its raw detail stays out of the DOM. */}
                            {!unavailable && (
                              <div className="mt-1.5 flex justify-end gap-1.5">
                                <SpeakMessageButton
                                  text={row.content}
                                  disabled={streaming}
                                />
                                <CopyMessageButton text={row.content} />
                                {!row.live && row.messageId > 0 && (
                                  <RegenerateMessageButton
                                    disabled={agentIsWorking || streaming}
                                    pending={revertChat.isPending}
                                    onConfirm={() =>
                                      handleRegenerate(
                                        row.messageId,
                                        "assistant",
                                        row.content
                                      )
                                    }
                                  />
                                )}
                              </div>
                            )}
                            {/* Tappable next actions the newest reply offered:
                                one tap sends the suggestion as the user's
                                next message. Only the newest reply carries
                                them, and a settled one at that. */}
                            {index === lastReplyIndex &&
                              !row.live &&
                              followUpSuggestions.length > 0 && (
                                <div
                                  data-testid="follow-up-suggestions"
                                  className="mt-3 flex flex-wrap gap-2"
                                >
                                  {followUpSuggestions.map(suggestion => (
                                    <button
                                      key={suggestion}
                                      type="button"
                                      onClick={() =>
                                        void sendMessage(chatId, suggestion)
                                      }
                                      className="border border-primary/35 bg-primary/[0.06] px-3.5 py-2 text-start text-xs font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-primary/60 hover:bg-primary/[0.12]"
                                    >
                                      {suggestion}
                                    </button>
                                  ))}
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
            <div className="relative mx-auto w-full max-w-[1240px]">
              {/* Anchored to this composer wrapper, so the menu floats above
                  the input rather than over the conversation. */}
              <SlashCommandMenu
                commands={slashMatches}
                activeIndex={activeSlashIndex}
                onSelect={pickSlashCommand}
                onActiveIndexChange={setSlashActiveIndex}
              />
              <div className="border border-foreground/[0.14] bg-card/85 p-2 shadow-[0_14px_45px_rgba(36,40,34,0.10)] backdrop-blur-xl transition focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/[0.12] dark:bg-white/[0.06] dark:shadow-[0_14px_45px_rgba(0,0,0,0.25)]">
                {queueNotice && (
                  <div
                    data-testid="queue-notice"
                    role="status"
                    className="mx-2.5 mb-1.5 border-s-2 border-primary bg-primary/[0.06] px-3 py-2 text-xs font-semibold text-foreground"
                  >
                    {queueNotice}
                  </div>
                )}
                {priorityNotice && (
                  <div
                    data-testid="priority-notice"
                    role="status"
                    className="mx-2.5 mb-1.5 border-s-2 border-emerald-500 bg-emerald-500/[0.08] px-3 py-2 text-xs font-semibold text-foreground"
                  >
                    {priorityNotice}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 px-2.5 pb-1.5">
                  {chatId ? <ModelSelector chatId={chatId} /> : <span />}
                  <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">
                    Enter to send · / for commands
                  </span>
                </div>
                <AttachmentTray
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
                      void addChatAttachments(
                        setComposerAttachments,
                        composerAttachments,
                        files
                      );
                    event.target.value = "";
                  }}
                />
                <div className="flex items-end gap-2 border border-foreground/[0.08] bg-background/55 p-2 ps-3.5 dark:border-white/[0.08] dark:bg-white/[0.035]">
                  {pendingEnvVarRequest ? (
                    <EnvVarRequestComposer
                      key={pendingEnvVarRequest.id}
                      request={pendingEnvVarRequest}
                      remaining={pendingEnvVarRequests.length - 1}
                      busy={fulfillingEnvVarRequest}
                      onSubmit={value =>
                        fulfillEnvVarRequest(pendingEnvVarRequest, value)
                      }
                      onDismiss={() =>
                        dismissEnvVarRequest(pendingEnvVarRequest)
                      }
                    />
                  ) : (
                    <>
                      <Textarea
                        ref={composerRef}
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={handleComposerKeyDown}
                        onBlur={() => setSlashMenuDismissed(true)}
                        role="combobox"
                        aria-expanded={slashMenuOpen}
                        aria-controls={
                          slashMenuOpen ? SLASH_MENU_ID : undefined
                        }
                        aria-activedescendant={
                          slashMenuOpen
                            ? `${SLASH_MENU_ID}-option-${activeSlashIndex}`
                            : undefined
                        }
                        aria-autocomplete="list"
                        onPaste={event => {
                          const files = Array.from(
                            event.clipboardData?.files ?? []
                          ).filter(file => file.type.startsWith("image/"));
                          if (!files.length) return;
                          event.preventDefault();
                          void addChatAttachments(
                            setComposerAttachments,
                            composerAttachments,
                            files
                          );
                        }}
                        placeholder="Message Nova"
                        rows={1}
                        className="max-h-28 min-h-10 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-1.5 text-[16px] leading-6 placeholder:text-muted-foreground focus-visible:ring-0 sm:text-[15px]"
                      />
                      {!composerBusy && (
                        <button
                          type="button"
                          onClick={() => composerImageInputRef.current?.click()}
                          disabled={preparingAttachments}
                          aria-label="Attach images"
                          className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50 dark:hover:bg-white/[0.08]"
                        >
                          <ImagePlus className="size-4" />
                        </button>
                      )}
                      {composerBusy ? (
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
                    </>
                  )}
                </div>
              </div>
              <p className="mt-2 hidden text-center text-[10px] font-medium text-muted-foreground sm:block">
                <CornerDownLeft className="me-1 inline size-3" />
                Shift+Enter for a new line
              </p>
            </div>
          </form>
          {draggingFiles && (
            <div
              data-testid="chat-drop-overlay"
              className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-background/55 p-4 backdrop-blur-[3px]"
            >
              <div className="flex items-center gap-2.5 rounded-xl border-2 border-dashed border-primary bg-card/95 px-6 py-4 text-sm font-bold text-foreground shadow-[0_18px_50px_rgba(36,40,34,0.18)] dark:bg-white/[0.08]">
                <Paperclip className="size-4 text-primary" />
                Drop files to attach them for Nova
              </div>
            </div>
          )}
        </section>
      </DashboardLayout>
    );
  }

  /** The overview's task prompt. The model + effort selectors are real: they
   * choose the conversation the task starts on and ride into `chats.create`
   * with it (effort offers vary per model - see PromptModelControls). The
   * personality picker and the gear (settings) are the remaining
   * inline affordances on the card. */

  // `createChat`, `subscription`, `selectedModelId`, `selectedEffortId` and
  // `startingSession` are declared at the top of the component (before the
  // early returns) so the hook count stays stable across the overview -> chat
  // navigation; only the derived values live here.
  const chatModels = getChatModels();
  const handlePromptModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
    const offered = effortOptionsForModelId(modelId);
    setSelectedEffortId(previous => (offered.includes(previous) ? previous : "auto"));
  };
  const taskText = draft.trim();
  const canStartSession =
    (taskText.length > 0 || composerAttachments.length > 0) &&
    !preparingAttachments &&
    !createChat.isPending &&
    !startingSession;

  /**
   * "Start a session": open a fresh conversation carrying the task (and any
   * attached images/files) and hand it to Nova. The chat title starts as the
   * task itself; the server auto-renames the thread once the first run
   * settles, exactly like a chat started from the composer.
   */
  const startSession = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canStartSession) return;
    const images = composerAttachments.flatMap(attachment =>
      attachment.kind === "image" ? [attachment.dataUri] : []
    );
    const files = composerAttachments.flatMap(attachment =>
      attachment.kind === "file"
        ? [
            {
              name: attachment.name,
              mimeType: attachment.mimeType,
              dataUri: attachment.dataUri,
            },
          ]
        : []
    );
    const content =
      taskText ||
      (composerAttachments.length === 1
        ? `Uploaded ${composerAttachments[0].name}`
        : `Uploaded ${composerAttachments.length} attachments`);
    setStartingSession(true);
    try {
      const chat = await createChat.mutateAsync({
        title: content.slice(0, 48),
        model: selectedModelId,
        effort: selectedEffortId,
      });
      setLocation(`/app?chatId=${chat.id}`);
      await sendMessage(chat.id, content, images, files);
      setDraft("");
      setComposerAttachments([]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Nova could not start that conversation."
      );
    } finally {
      setStartingSession(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="nova-prompt-shell chat-editorial-shell relative flex min-h-full flex-col items-center justify-center px-4 py-12 sm:px-7">
        <h1 className="max-w-2xl text-center font-serif text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.05] tracking-[-0.03em] text-muted-foreground">
          What does <span className="text-foreground">Nova</span> need
          done?
        </h1>

        <form
          className="rise-in mt-8 w-full max-w-2xl rounded-2xl border border-foreground/[0.14] bg-card p-4 shadow-[0_14px_45px_rgba(36,40,34,0.10)] focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/[0.12] dark:bg-white/[0.06] dark:shadow-[0_14px_45px_rgba(0,0,0,0.25)]"
          onSubmit={startSession}
        >
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void startSession(event);
              }
            }}
            placeholder="Describe a task to start a conversation..."
            aria-label="Describe a task to start a conversation"
            autoFocus
            rows={3}
            className="w-full resize-none bg-transparent text-base leading-6 text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <AttachmentTray
            attachments={composerAttachments}
            onRemove={id =>
              setComposerAttachments(previous =>
                previous.filter(attachment => attachment.id !== id)
              )
            }
          />
          <div className="mt-3 flex items-center gap-4">
            <PromptModelControls
              models={chatModels}
              // The effective plan drives the model lock: Pro access (a paid
              // plan or a console-operator role) reads paid; the raw plan
              // still feeds anything that must know the subscription state.
              plan={subscription.data?.proAccess ? "paid" : subscription.data?.plan}
              selectedModelId={selectedModelId}
              selectedEffortId={selectedEffortId}
              onModelChange={handlePromptModelChange}
              onEffortChange={setSelectedEffortId}
              disabled={startingSession || createChat.isPending}
            />
            <button
              type="submit"
              disabled={!canStartSession}
              aria-label="Start a session"
              className="ml-auto grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background shadow-sm transition enabled:hover:-translate-y-0.5 enabled:hover:shadow-md disabled:bg-foreground/[0.15] disabled:text-muted-foreground dark:bg-white dark:text-black"
            >
              {startingSession || createChat.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4.5" />
              )}
            </button>
          </div>
        </form>

        <div className="rise-in-delay-2 mt-4 flex w-full max-w-2xl items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => composerImageInputRef.current?.click()}
              disabled={preparingAttachments}
              aria-label="Attach images"
              className="text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              <Paperclip className="size-4.5" />
            </button>
            <PersonalitySelector />
          </div>
          <button
            type="button"
            onClick={() => setLocation("/app/settings")}
            aria-label="Workspace settings"
            className="text-muted-foreground transition hover:text-foreground"
          >
            <Settings2 className="size-4.5" />
          </button>
        </div>

        <input
          ref={composerImageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={event => {
            const files = event.target.files;
            if (files?.length)
              void addChatAttachments(
                setComposerAttachments,
                composerAttachments,
                files
              );
            event.target.value = "";
          }}
        />
      </div>
    </DashboardLayout>
  );
}
