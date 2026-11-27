import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  LoaderCircle,
  MessageCircle,
  Sparkles,
  X,
} from "lucide-react";
import { MarkdownText } from "@/lib/markdown";
import {
  createSupportStreamFramer,
  parseSupportStreamLine,
} from "@/lib/supportStream";
import { cn } from "@/lib/utils";
import NovaLogo from "./NovaLogo";

type SupportMessage = {
  role: "user" | "assistant";
  content: string;
};

/** The server keeps the same cap; trimming here keeps requests small. */
const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2_000;
const PANEL_ID = "nova-support-panel";

const STARTER_QUESTIONS = [
  "What is Nova?",
  "How do I get started?",
  "Can I use my own model?",
  "How does the API work?",
];

const FALLBACK_ERROR =
  "I couldn't answer just now. Please try again in a moment.";

function TypingDots() {
  return (
    <div
      className="flex w-fit items-center gap-1 rounded-2xl rounded-tl-md bg-secondary px-3.5 py-3 text-secondary-foreground"
      aria-label="Nova is typing"
    >
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * Public Q&A widget for the landing page and API docs. It is deliberately
 * independent of auth and the workspace: the server route is public and
 * rate-limited, and the conversation lives only in this component.
 */
export default function SupportBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const canRetry = useMemo(
    () => messages[messages.length - 2]?.role === "user",
    [messages]
  );

  // Stop an in-flight stream when the widget closes or unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      launcherRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pending, error, open]);

  /**
   * Streams one answer from the public SSE endpoint.
   *
   * The fetch is deliberately auth-free: the widget is public, and asking for
   * a Neon token first would let an auth outage block the answer. Deltas are
   * appended to one assistant bubble as they arrive; a failed stream leaves
   * the partial answer visible with a retry beside it.
   */
  const submit = async (history: SupportMessage[]) => {
    setError(null);
    setPending(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const answerIndex = history.length;
    setMessages([...history, { role: "assistant", content: "" }]);

    const append = (delta: string) => {
      setMessages(current =>
        current.map((message, index) =>
          index === answerIndex
            ? { ...message, content: message.content + delta }
            : message
        )
      );
    };

    try {
      const response = await fetch("/api/support/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ messages: history.slice(-MAX_HISTORY_MESSAGES) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || FALLBACK_ERROR);
      }
      if (!response.body) throw new Error(FALLBACK_ERROR);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const handleLine = (line: string) => {
        const event = parseSupportStreamLine(line);
        if (!event) return;
        if (typeof event.delta === "string") append(event.delta);
        if (typeof event.error === "string") throw new Error(event.error);
      };
      const framer = createSupportStreamFramer(handleLine);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        framer.push(decoder.decode(value, { stream: true }));
      }
      framer.flush();
    } catch (streamError) {
      if (controller.signal.aborted) return;
      setError((streamError as Error).message || FALLBACK_ERROR);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPending(false);
    }
  };

  const send = (raw: string) => {
    const content = raw.trim();
    if (!content || pending) return;
    // If the previous turn failed, replace that unanswered question instead of
    // stacking two user turns on top of each other.
    const answered =
      messages[messages.length - 1]?.role === "user"
        ? messages.slice(0, -1)
        : messages;
    const next = [...answered, { role: "user" as const, content }];
    setMessages(next);
    setDraft("");
    submit(next);
  };

  const retry = () => {
    if (!canRetry || pending) return;
    submit(messages);
  };

  const close = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    send(draft);
  };

  return (
    <>
      {open ? (
        <section
          id={PANEL_ID}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${PANEL_ID}-title`}
          className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex h-[min(68dvh,560px)] flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-[0_24px_80px_-20px_rgba(15,21,21,0.45)] sm:inset-x-auto sm:end-6 sm:w-[380px]"
        >
          <header className="flex items-center gap-3 border-b border-border px-4 py-3.5">
            <NovaLogo size={32} />
            <div className="min-w-0 flex-1">
              <h2
                id={`${PANEL_ID}-title`}
                className="text-sm font-semibold tracking-[-0.01em]"
              >
                Nova Q&amp;A
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                Answers about the app · Powered by Nova
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close Nova Q&A"
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </button>
          </header>

          <div
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
          >
            <div className="flex justify-start">
              <div className="max-w-[87%] rounded-2xl rounded-tl-md bg-secondary px-3.5 py-2.5 text-sm leading-6 text-secondary-foreground">
                Hi! I&apos;m Nova&apos;s Q&amp;A assistant. Ask me anything
                about how Nova works.
              </div>
            </div>

            {messages.length === 0 && !pending ? (
              <div className="space-y-2 pt-1">
                <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <Sparkles className="size-3.5 text-primary" />
                  Try asking
                </p>
                <div className="flex flex-wrap gap-2">
                  {STARTER_QUESTIONS.map(question => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => send(question)}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-start text-xs font-medium text-foreground transition hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[87%] rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                    message.role === "user"
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-tl-md bg-secondary text-secondary-foreground"
                  )}
                >
                  {message.role === "assistant" ? (
                    <MarkdownText text={message.content} />
                  ) : (
                    <p className="whitespace-pre-wrap break-words">
                      {message.content}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {pending && messages[messages.length - 1]?.content === "" ? (
              <div className="flex justify-start">
                <TypingDots />
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="rounded-2xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-xs leading-5 text-foreground"
              >
                <p>{error}</p>
                {canRetry ? (
                  <button
                    type="button"
                    onClick={retry}
                    disabled={pending}
                    className="mt-2 font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <form
            onSubmit={event => {
              event.preventDefault();
              send(draft);
            }}
            className="border-t border-border p-3"
          >
            <div className="flex items-end gap-1.5 rounded-2xl border border-input bg-background p-1.5 transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/20">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={onInputKeyDown}
                rows={1}
                maxLength={MAX_MESSAGE_CHARS}
                placeholder="Ask about Nova..."
                aria-label="Ask a question about Nova"
                className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-6 outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={!draft.trim() || pending}
                aria-label="Send question"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
              >
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
            </div>
            <p className="mt-2 px-1 text-[10px] leading-4 text-muted-foreground">
              AI answers can be wrong. Check the docs for exact details.
            </p>
          </form>
        </section>
      ) : null}

      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={open ? "Close Nova Q&A" : "Ask Nova a question"}
        title={open ? "Close Nova Q&A" : "Ask Nova"}
        className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] end-5 z-50 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_12px_30px_-8px_rgba(15,21,21,0.55)] transition hover:-translate-y-0.5 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:end-6"
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>
    </>
  );
}
