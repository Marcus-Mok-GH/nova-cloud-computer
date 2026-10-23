/**
 * The chat runtime behind the Workspace screen: composer state, the message
 * ledger poll, the run-status poll, the SSE send stream, stop/revert/
 * regenerate, the one-shot kickoff intents, and the effects that reset or
 * abort them when the reader moves between conversations. Extracted from the
 * Workspace component so the screen file is presentation (row layout, badges,
 * JSX) and this file is behavior - each can be read without the other.
 */
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getNeonAccessToken } from "@/lib/neonAuth";
import {
  collectChatImageAttachments,
  isSupportedChatImage,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  type ChatImageAttachment,
} from "@/lib/imageAttachments";
import {
  collectChatFileAttachments,
  queueComposerAttachments,
  MAX_CHAT_FILE_ATTACHMENTS,
  type ChatComposerAttachment,
  type ChatFileAttachment,
  type ChatFileUpload,
} from "@/lib/fileAttachments";
import { consumeChatAway, markChatAway } from "@/lib/awayChats";
import { stopAllSpeech } from "@/lib/speech";
import {
  appendLiveTextDelta,
  isInternalChatMessage,
  upsertLiveToolEvent,
  type LiveChatEvent,
  type ToolActivity,
} from "@/lib/chatMessages";
import React, { FormEvent, useEffect, useRef, useState } from "react";

/** Opening message for the guided personalisation session launched from Settings. */
const PERSONALISATION_KICKOFF =
  "Let's set up my personalisation. Ask me one question at a time about how I work and how I want you to work with me, wait for each answer, then save what you learn with set_personalisation and turn personalisation mode on.";

/**
 * Opening message for a freshly created team chat (launched from the Agents
 * page's team builder): the roster starts in plan mode - split the shared
 * goal into assigned tasks and wait for approval before executing.
 */
export const teamPlanKickoff = (goal: string): string => {
  const trimmed = goal.trim();
  return [
    trimmed
      ? `The team's shared goal: ${trimmed}.`
      : "Begin the team's shared goal.",
    "Start in plan mode: review the goal and the roster's roles, break the goal into concrete tasks, and assign each task to the teammate best placed to do it. Present the plan for my approval before executing any task - once I approve, execute the assigned tasks in turn order until the goal is done.",
  ].join(" ");
};

/**
 * The pieces of the workspace query this hook reads (the team-kickoff intent
 * looks up the chat's shared goal). Typed structurally so the hook does not
 * depend on the query's full generated type.
 */
type WorkspaceQuery = {
  data: { chats?: Array<{ id: string; teamGoal?: string | null }> } | undefined;
  isLoading: boolean;
  isError: boolean;
};
type WorkspaceUtils = ReturnType<typeof trpc.useUtils>;

export function useWorkspaceChat({
  chatId,
  utils,
  computer,
}: {
  /** The conversation on screen (from the URL); undefined on the home view. */
  chatId: string | undefined;
  utils: WorkspaceUtils;
  /** The workspace query, read by the team-kickoff intent. */
  computer: WorkspaceQuery;
}) {
  const [draft, setDraft] = useState("");
  const [pendingUserContent, setPendingUserContent] = useState("");
  const [liveEvents, setLiveEvents] = useState<LiveChatEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  // Peak hours defer the turn: the server answers with a queue position and
  // this notice stays up until the deferred run actually starts.
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [priorityNotice, setPriorityNotice] = useState<string | null>(null);
  const [baselineMessageId, setBaselineMessageId] = useState(0);
  // While a stop is being carried out, the ledger is held at the rows the
  // reader could already see: rows the server persists as it winds the run
  // down must not make the transcript grow after the button was pressed.
  const [stopLedgerCutoffId, setStopLedgerCutoffId] = useState(0);
  // Briefly set when the reader opens a chat whose turn ran on while they were
  // elsewhere, so the finished reply is not silently waiting on screen.
  const [settledWhileAway, setSettledWhileAway] = useState(false);
  // The conversation currently on screen, kept in a ref so an in-flight stream
  // can tell whether its chat is still the one being viewed. A reader that
  // navigates to another chat mid-run must not have the previous chat's live
  // text, tool rows, or queue notices written into the state it renders.
  const viewedChatIdRef = useRef<string | undefined>(chatId);
  viewedChatIdRef.current = chatId;
  // The in-flight stream's abort handle, and the chat that owns it, so leaving
  // that chat can stop the reader from receiving a turn it no longer shows.
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamOwnerChatIdRef = useRef<string | undefined>(undefined);
  // Set the moment Stop is pressed. Deltas that arrive while the server winds
  // the run down are dropped, so the view stops growing the instant the button
  // is hit instead of when the cancel round-trip finally lands.
  const stopRequestedRef = useRef(false);
  // Mirrors the chat viewport's "user scrolled up" flag: sendMessage clears it
  // so the next turn scrolls to the bottom again. It lives here because the
  // send path resets it; the scroll listeners that read it stay in the view.
  const userScrolledUpRef = useRef(false);
  // One-shot flag set by Settings' "Start guided setup" button; the effect
  // below turns it into the opening message of a personalisation session.
  const personaliseIntent =
    typeof window === "undefined"
      ? false
      : new URLSearchParams(window.location.search).get("personalise") === "1";
  const personaliseStartedRef = useRef(false);
  // One-shot flag set by the Agents page's team builder; the effect below
  // turns it into the team's plan-mode kickoff message.
  const teamStartIntent =
    typeof window === "undefined"
      ? false
      : new URLSearchParams(window.location.search).get("teamstart") === "1";
  const teamKickoffSentRef = useRef(false);
  const [composerAttachments, setComposerAttachments] = useState<
    ChatComposerAttachment[]
  >([]);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const composerImageInputRef = useRef<HTMLInputElement>(null);

  // Routes dropped/pasted/picked files to the right encoder - images are
  // downscaled for vision, other files encoded as data-URI uploads - then
  // queues what fits the per-message budget.
  const addChatAttachments = async (
    setter: React.Dispatch<React.SetStateAction<ChatComposerAttachment[]>>,
    current: ChatComposerAttachment[],
    files: Iterable<File>
  ) => {
    setPreparingAttachments(true);
    try {
      const picked = Array.from(files);
      const imageFiles = picked.filter(isSupportedChatImage);
      const otherFiles = picked.filter(file => !isSupportedChatImage(file));
      const imageResult: {
        attachments: ChatImageAttachment[];
        error?: string;
      } = imageFiles.length
        ? await collectChatImageAttachments(imageFiles)
        : { attachments: [] };
      const fileResult: { attachments: ChatFileAttachment[]; error?: string } =
        otherFiles.length
          ? await collectChatFileAttachments(otherFiles)
          : { attachments: [] };
      for (const error of [imageResult.error, fileResult.error])
        if (error) toast.error(error);
      const prepared: ChatComposerAttachment[] = [
        ...imageResult.attachments,
        ...fileResult.attachments,
      ];
      if (!prepared.length) return;
      const { accepted, overflow } = queueComposerAttachments(
        current,
        prepared
      );
      if (overflow > 0)
        toast.error(
          `Attach at most ${MAX_CHAT_IMAGE_ATTACHMENTS} images and ${MAX_CHAT_FILE_ATTACHMENTS} files within the size limit.`
        );
      if (accepted.length) setter([...current, ...accepted]);
    } finally {
      setPreparingAttachments(false);
    }
  };

  // Opening a different conversation must not carry over the previous one's
  // turn state. The submission baseline in particular belongs to the thread it
  // was taken in: leaving it set while viewing another chat misclassifies that
  // chat's settled history as the current turn, and its rows are laid out as a
  // live transcript instead of in place.
  useEffect(() => {
    stopAllSpeech();
    stopRequestedRef.current = false;
    setStopLedgerCutoffId(0);
    setComposerAttachments([]);
    setBaselineMessageId(0);
    setPendingUserContent("");
    setLiveEvents([]);
    setIsStreaming(false);
    setQueueNotice(null);
    setPriorityNotice(null);
    setSettledWhileAway(false);
    // A stream still running for the chat we just left feeds only that view;
    // abort it so it stops holding a connection open. The run itself continues
    // on the server and its rows are already being persisted to the ledger.
    if (streamAbortRef.current && streamOwnerChatIdRef.current !== chatId) {
      markChatAway(streamOwnerChatIdRef.current);
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
  }, [chatId]);

  // Returning to a chat whose stream we cut short refetches its ledger right
  // away, so a turn that settled while the reader was away shows up without
  // waiting for the next poll (or a manual reload).
  useEffect(() => {
    if (chatId && consumeChatAway(chatId)) {
      setSettledWhileAway(true);
      void utils.chats.messages.invalidate({ chatId });
    }
  }, [chatId, utils]);

  // The "updated while you were away" pill is a glance, not a state: it fades
  // out on its own so it never becomes chrome the reader has to dismiss.
  useEffect(() => {
    if (!settledWhileAway) return;
    const timer = setTimeout(() => setSettledWhileAway(false), 8000);
    return () => clearTimeout(timer);
  }, [settledWhileAway]);

  // Leaving the workspace screen aborts any stream still in flight; as above,
  // the server completes the run and the ledger keeps its result.
  useEffect(
    () => () => {
      stopAllSpeech();
      // Leaving the screen counts as leaving the chat: mark its turn so the
      // chat list can flag it, then drop the connection.
      if (streamAbortRef.current) markChatAway(streamOwnerChatIdRef.current);
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    },
    []
  );

  const contentFor = (text: string, attachments: ChatComposerAttachment[]) =>
    text.trim() ||
    (attachments.length === 1
      ? `Uploaded ${attachments[0].name}`
      : `Uploaded ${attachments.length} attachments`);
  const canSendComposer =
    Boolean(draft.trim() || composerAttachments.length) &&
    !preparingAttachments;
  // The backend ledger is the source of truth for active work. This keeps the
  // status visible after a refresh and for runs started from Telegram or a
  // continuation segment, where this browser does not own the fetch stream.
  // A live run polls once a second; an idle open conversation falls back to a
  // slow cadence so it is not a database query every second for as long as a
  // tab stays open.
  const runStatus = trpc.chats.runStatus.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: Boolean(chatId),
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: query =>
        Boolean(chatId) ? (query.state.data?.active ? 1000 : 15_000) : false,
      refetchIntervalInBackground: false,
    }
  );
  // While a conversation is open it polls quickly so activity started
  // elsewhere (e.g. Telegram) streams into this view in real time. Idle
  // conversations match the status query's slow cadence.
  const savedMessages = trpc.chats.messages.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: Boolean(chatId),
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: Boolean(chatId)
        ? Boolean(runStatus.data?.active) || isStreaming
          ? 2500
          : 15_000
        : false,
      refetchIntervalInBackground: false,
    }
  );
  const agentIsWorking = isStreaming || Boolean(runStatus.data?.active);
  // The worker flips the deferred turn into a live agent run; at that point the
  // waiting notice has done its job and the normal working indicator takes over.
  useEffect(() => {
    if (runStatus.data?.active) setQueueNotice(null);
  }, [runStatus.data?.active]);
  // A queued turn has no agent-run row yet, so it would otherwise look idle;
  // treat it as busy so the composer offers Stop, which cancels the queued item.
  const composerBusy = agentIsWorking || Boolean(queueNotice);
  // A notice belongs to the conversation it was raised in.
  useEffect(() => {
    setQueueNotice(null);
  }, [chatId]);
  // Stops the chat's in-flight agent run and its queued/running VM workflows
  // (the composer's send button turns into this stop button while Nova works).
  const stopRun = trpc.chats.stop.useMutation({
    onSuccess: () => {
      setQueueNotice(null);
      void runStatus.refetch();
    },
    onError: error => {
      // A failed stop leaves the run going: resume applying its stream and
      // release the held ledger.
      stopRequestedRef.current = false;
      setStopLedgerCutoffId(0);
      toast.error(
        error instanceof Error
          ? error.message
          : "Nova could not be stopped. Please try again."
      );
    },
  });
  const handleStopRun = () => {
    if (!chatId || stopRun.isPending) return;
    // Freeze the transcript immediately: the run's remaining deltas are
    // dropped on arrival, so the text - and any thinking/tool updates - stop
    // growing the moment the button is pressed, however slow the cancel
    // round-trip (or a cold serverless instance) turns out to be. A queued
    // turn keeps its notice until the mutation confirms the cancel, so a
    // failed stop can still be retried.
    stopRequestedRef.current = true;
    // Hold the ledger at what is already on screen: rows the server persists
    // while it winds the run down (a finished tool, a flushed thinking block)
    // must not appear after the button was pressed. Zero means the chat has no
    // rows yet, so there is nothing to hold.
    setStopLedgerCutoffId(current =>
      current > 0
        ? current
        : (savedMessages.data ?? []).reduce(
            (max, message) => Math.max(max, message.id),
            0
          )
    );
    stopRun.mutate({ chatId });
  };
  // A stop pressed on work this browser is not streaming - a queued turn, or a
  // run started elsewhere - has no stream end to release the held ledger, so
  // release it (and the freeze) the moment the run is no longer active.
  useEffect(() => {
    if (agentIsWorking || stopLedgerCutoffId === 0) return;
    stopRequestedRef.current = false;
    setStopLedgerCutoffId(0);
  }, [agentIsWorking, stopLedgerCutoffId]);
  const revertChat = trpc.chats.revert.useMutation();

  const refreshMessages = async (): Promise<boolean> => {
    try {
      await savedMessages.refetch();
      return !savedMessages.isError;
    } catch {
      return false;
    }
  };
  const finalizeStream = async (streamChatId: string): Promise<boolean> => {
    // The stream has ended: release the stop hold and show the ledger it was
    // holding back (the run's rows, including the stopped-reply notice, are
    // persisted by the time the stream closes).
    stopRequestedRef.current = false;
    setStopLedgerCutoffId(0);
    // The reader left this conversation while its turn was still streaming.
    // The server's ledger holds the turn and the poller will surface it when
    // that chat is opened again, so do not touch the state on screen now.
    if (viewedChatIdRef.current !== streamChatId) return true;
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
  /**
   * Streams a message into `targetChatId`, reused by the active-chat composer
   * and the one-shot kickoff intents. Resolves true when the turn streamed
   * to completion and false on any failure, so callers that need a confirmed
   * send (e.g. the team kickoff's one-shot intent) can react to it.
   */
  const sendMessage = async (
    targetChatId: string,
    content: string,
    images: string[] = [],
    files: ChatFileUpload[] = []
  ): Promise<boolean> => {
    userScrolledUpRef.current = false;
    // Supersede any stream still running (a previous send, or one left behind
    // by the chat we came from) before taking over the view.
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    streamOwnerChatIdRef.current = targetChatId;
    const toPersist = savedMessages.data ?? [];
    setBaselineMessageId(
      toPersist.length ? Math.max(...toPersist.map(message => message.id)) : 0
    );
    setPendingUserContent(content);
    setLiveEvents([]);
    setQueueNotice(null);
    setPriorityNotice(null);
    stopRequestedRef.current = false;
    setStopLedgerCutoffId(0);
    setIsStreaming(true);
    try {
      const token = await getNeonAccessToken().catch(() => null);
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        credentials: "include",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          chatId: targetChatId,
          content,
          ...(images.length ? { images } : {}),
          ...(files.length ? { files } : {}),
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
              await finalizeStream(targetChatId);
              // The run consumed credits and may have created or retitled the
              // chat: refresh the sidebar, the archive, and the credit chip
              // directly instead of relying on a background poll.
              await Promise.all([
                utils.workspace.computer.invalidate(),
                utils.workspace.chats.invalidate(),
                utils.credits.status.invalidate(),
              ]);
              return true;
            }
            // A stream that belongs to a chat the reader has navigated away
            // from must not write its events into the current view. Skipping
            // them here is safe: the persisted ledger carries the same rows.
            if (viewedChatIdRef.current !== targetChatId) continue;
            // Stop was pressed: freeze the view. Whatever the run streams
            // while the server winds it down (including the "Stopped" notice
            // itself) is dropped here and arrives through the ledger refresh.
            if (stopRequestedRef.current) continue;
            try {
              const parsed = JSON.parse(data) as {
                type?: string;
                tool?: ToolActivity;
                message?: string;
                choices?: Array<{ delta?: { content?: string } }>;
              };
              if (parsed.type === "queued") {
                setQueueNotice(
                  typeof parsed.message === "string" ? parsed.message : null
                );
                continue;
              }
              if (parsed.type === "priority") {
                setPriorityNotice(
                  typeof parsed.message === "string" ? parsed.message : null
                );
                continue;
              }
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
      await finalizeStream(targetChatId);
      return true;
    } catch (error) {
      // Navigating away (or being superseded) aborts the fetch; the run keeps
      // going on the server and the ledger carries its result, so there is
      // nothing to report to a view that is no longer showing this chat.
      if ((error as { name?: string } | null)?.name === "AbortError")
        return false;
      console.error("Stream error:", error);
      if (viewedChatIdRef.current === targetChatId)
        toast.error(
          error instanceof Error ? error.message : "Failed to send message"
        );
      await finalizeStream(targetChatId);
      return false;
    } finally {
      if (streamAbortRef.current === controller) {
        // A stream that ends (naturally or aborted) after the reader moved on
        // must still leave its marker: navigation can update the viewed chat
        // between the fetch settling and the chat-switch effect running, and
        // the effect only marks a controller that is still live. Marking here
        // covers that gap; it is a no-op when the chat is still on screen.
        if (viewedChatIdRef.current !== targetChatId)
          markChatAway(targetChatId);
        streamAbortRef.current = null;
        streamOwnerChatIdRef.current = undefined;
      }
    }
  };
  // Pending env-var value requests for the open chat: the agent raised one
  // via set_env_var without a value, so the composer becomes a secure value
  // input until it is fulfilled or dismissed. Queried only while the chat is
  // idle - a working run keeps the normal composer (with its Stop button) -
  // and polled slowly so a request raised mid-run appears once the run ends.
  const envVarRequests = trpc.workspace.envVarRequests.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: Boolean(chatId) && !composerBusy,
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: Boolean(chatId) ? 10_000 : false,
      refetchIntervalInBackground: false,
    }
  );
  const pendingEnvVarRequests = envVarRequests.data ?? [];
  const fulfillEnvVar = trpc.workspace.fulfillEnvVarRequest.useMutation();
  const cancelEnvVar = trpc.workspace.cancelEnvVarRequest.useMutation();
  // Fulfils one request: the value goes straight to the server's encrypted
  // store, then the conversation resumes with a short continuation message
  // naming the variable only - the value itself never appears in a chat
  // message, so it can never reach the model.
  const fulfillEnvVarRequest = async (
    request: { id: number; name: string },
    value: string
  ) => {
    const trimmed = value.trim();
    if (!chatId || !trimmed || fulfillEnvVar.isPending) return;
    try {
      await fulfillEnvVar.mutateAsync({ id: request.id, value: trimmed });
      await utils.workspace.envVarRequests.invalidate({ chatId });
      toast.success(`${request.name} saved`);
      await sendMessage(
        chatId,
        `I've entered the value for ${request.name} - it's saved now. Continue where you left off.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Nova could not save that value. Please try again."
      );
    }
  };
  // Dismisses one request (the user chose not to provide a value): the
  // normal composer comes back and the agent can be told another way.
  const dismissEnvVarRequest = async (request: { id: number }) => {
    if (!chatId || cancelEnvVar.isPending) return;
    try {
      await cancelEnvVar.mutateAsync({ id: request.id });
      await utils.workspace.envVarRequests.invalidate({ chatId });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Nova could not dismiss that request. Please try again."
      );
    }
  };
  const submit = async (event: FormEvent | React.KeyboardEvent) => {
    event.preventDefault();
    // While Nova works - or while this turn waits in the peak-hours queue -
    // both the Enter key and the composer button stop the run.
    if (composerBusy) {
      handleStopRun();
      return;
    }
    if ((!draft.trim() && !composerAttachments.length) || !chatId) return;
    const content = contentFor(draft, composerAttachments);
    const images = composerAttachments.flatMap(attachment =>
      attachment.kind === "image" ? [attachment.dataUri] : []
    );
    const files = composerAttachments.flatMap(
      (attachment): ChatFileUpload[] =>
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
    setDraft("");
    setComposerAttachments([]);
    await sendMessage(chatId, content, images, files);
  };
  /**
   * Regenerates the thread from one message: reverts history from the anchor
   * onwards, then resends the anchor's prompt as a fresh turn. An assistant
   * anchor regenerates from its preceding user message instead.
   */
  const handleRegenerate = async (
    anchorId: number,
    anchorRole: "user" | "assistant",
    anchorContent: string
  ) => {
    if (!chatId || agentIsWorking || revertChat.isPending) return;
    const all = savedMessages.data ?? [];
    let revertFromId = anchorId;
    let resendContent = anchorContent;
    if (anchorRole === "assistant") {
      const previousUser = [...all]
        .reverse()
        .find(
          message =>
            message.id < anchorId &&
            message.role === "user" &&
            !isInternalChatMessage(message.content)
        );
      if (!previousUser) {
        toast.error("There is no earlier message to regenerate from.");
        return;
      }
      revertFromId = previousUser.id;
      resendContent = previousUser.content;
    }
    if (!resendContent.trim()) {
      toast.error("There is nothing to regenerate here.");
      return;
    }
    try {
      await revertChat.mutateAsync({ chatId, messageId: revertFromId });
      await savedMessages.refetch();
      await sendMessage(chatId, resendContent);
    } catch (error) {
      // The revert already happened: put the prompt back in the composer so
      // a failed regeneration never eats what the user wrote.
      setDraft(resendContent);
      toast.error(
        error instanceof Error
          ? error.message
          : "Nova could not regenerate that reply."
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
  }, [
    chatId,
    personaliseIntent,
    savedMessages.isLoading,
    savedMessages.data,
    agentIsWorking,
  ]);

  // A chat opened from the Agents page's team builder begins with the team's
  // plan-mode kickoff, once. It only fires after the chat history and the
  // workspace data have loaded *successfully* (a failed query must neither
  // read as an empty history nor drop the real goal), and the URL intent is
  // consumed only after the send is confirmed - or when history already
  // exists - so a failed send stays retryable while a success can never
  // re-send on refresh or share.
  useEffect(() => {
    if (!chatId || !teamStartIntent || teamKickoffSentRef.current) return;
    if (
      savedMessages.isLoading ||
      savedMessages.isError ||
      computer.isLoading ||
      computer.isError ||
      agentIsWorking
    )
      return;
    const stripIntent = () => {
      const params = new URLSearchParams(window.location.search);
      params.delete("teamstart");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`
      );
    };
    // The chat already has history: the kickoff happened (or the user spoke
    // first), so consume the stale intent without sending.
    if ((savedMessages.data ?? []).length > 0) {
      teamKickoffSentRef.current = true;
      stripIntent();
      return;
    }
    const goal =
      (computer.data?.chats ?? []).find(chat => chat.id === chatId)?.teamGoal ??
      "";
    // Claim synchronously so overlapping effect runs cannot double-send; on
    // a failed send release the claim and keep the URL flag so the kickoff
    // retries (the message poll recovers first, then a refresh).
    teamKickoffSentRef.current = true;
    void sendMessage(chatId, teamPlanKickoff(goal)).then(sent => {
      if (sent) {
        stripIntent();
        return;
      }
      teamKickoffSentRef.current = false;
    });
  }, [
    chatId,
    teamStartIntent,
    savedMessages.isLoading,
    savedMessages.isError,
    savedMessages.data,
    agentIsWorking,
    computer.isLoading,
    computer.isError,
    computer.data,
  ]);

  return {
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
    handleStopRun,
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
    fulfillingEnvVarRequest: fulfillEnvVar.isPending,
  };
}
