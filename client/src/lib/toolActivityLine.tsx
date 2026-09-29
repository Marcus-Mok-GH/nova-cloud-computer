import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ListChecks,
  XCircle,
} from "lucide-react";
import type { ToolActivity } from "@/lib/chatMessages";
import { MarkdownText } from "@/lib/markdown";

/**
 * The append-only live log of a running sub-agent's process: every progress
 * note the backend streamed while the specialist worked, oldest first, with
 * the latest line spinning. Auto-scrolls to the newest line so the user can
 * watch the process happen instead of a single "working..." line.
 */
export function ProgressLog({ log }: { log: string[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [log.length]);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {log.map((line, index) => {
        const latest = index === log.length - 1;
        return (
          <p
            key={index}
            className={
              latest
                ? "flex min-w-0 items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400"
                : "min-w-0 break-words text-xs leading-5 text-muted-foreground"
            }
          >
            {latest ? (
              <CircleDashed className="size-3.5 shrink-0 animate-spin" />
            ) : null}
            <span className="min-w-0 break-words">{line}</span>
          </p>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

/**
 * One-line rendering for a tool call, e.g. "Read File notes.txt".
 * Args arrive as a raw JSON string in activity.args.arguments.
 */
export function toolLineText(activity: ToolActivity): string {
  let args: Record<string, unknown> = {};
  if (typeof activity.args?.arguments === "string") {
    try {
      const parsed = JSON.parse(activity.args.arguments);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        args = parsed as Record<string, unknown>;
    } catch {
      /* truncated or malformed - fall back to the tool name */
    }
  }
  const s = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : "";
  const topic = s(args.topic);
  const name = s(args.name),
    file = s(args.file),
    folder = s(args.folder);
  const newName = s(args.new_name),
    parent = s(args.parent),
    task = s(args.task),
    text = s(args.text);
  const brief = (value: string, max = 60) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;
  switch (activity.name) {
    case "list_workspace":
      return "List Files";
    case "create_file":
      return `Create File ${name}`.trim();
    case "read_file":
      return `Read File ${file}`.trim();
    case "edit_file":
      return `Edit File ${file}`.trim();
    case "rename_file":
      return `Rename File ${file} → ${newName}`.trim();
    case "move_file":
      return `Move File ${file} → ${folder}`.trim();
    case "delete_file":
      return `Delete File ${file}`.trim();
    case "create_folder":
      return `Create Folder ${name}`.trim();
    case "rename_folder":
      return `Rename Folder ${folder} → ${newName}`.trim();
    case "move_folder":
      return `Move Folder ${folder} → ${parent}`.trim();
    case "delete_folder":
      return `Delete Folder ${folder}`.trim();
    case "send_telegram_message":
      return text
        ? `Send Telegram Message: ${brief(text)}`
        : "Send Telegram Message";
    case "run_vm_task":
      return task ? `Run VM Task: ${brief(task)}` : "Run VM Task";
    case "research_web":
      return topic ? `Deep Research: ${brief(topic)}` : "Deep Research";
    case "editor":
    case "code_task": // legacy rows from before the rename
      return task ? `Editor: ${brief(task)}` : "Editor";
    case "thinking":
      return "Thinking";
    case "browse": {
      const cleaned = s(args.command).replace(/^agent-browser\s+/, "");
      return cleaned ? `Browse: ${brief(cleaned)}` : "Browse";
    }
    default:
      return activity.name;
  }
}

export function ToolActivityLine({ activity }: { activity: ToolActivity }) {
  const StatusIcon =
    activity.state === "completed"
      ? CheckCircle2
      : activity.state === "failed"
        ? XCircle
        : CircleDashed;
  const stateClass =
    activity.state === "completed"
      ? "text-emerald-600 dark:text-emerald-400"
      : activity.state === "failed"
        ? "text-red-600 dark:text-red-400"
        : "text-amber-600 dark:text-amber-400";
  // A tool that is still running is the one thing worth reading at a glance
  // while Nova works, so it gets the same bright text as an actual reply
  // instead of the muted tone settled (completed/failed) rows keep.
  const textClass =
    activity.state === "running"
      ? "text-foreground"
      : "text-muted-foreground dark:text-muted-foreground";
  return (
    <div
      data-testid="tool-activity-line"
      className={`flex min-w-0 items-center gap-1.5 px-1 text-xs font-medium ${textClass}`}
    >
      <StatusIcon
        className={`size-3 shrink-0 ${stateClass}${activity.state === "running" ? " animate-spin" : ""}`}
      />
      <span className="min-w-0 truncate">
        {toolLineText(activity)}
        {activity.state === "failed" ? " (failed)" : ""}
      </span>
    </div>
  );
}

/**
 * Container class for a tool activity's chat-list chip. A running tool - the
 * one Nova is doing right now - gets a clearly visible card so it reads as
 * "happening" instead of blending into the background; once it settles
 * (completed/failed) it steps back to the quieter resting style.
 */
export function toolChipContainerClass(
  activity: ToolActivity,
  variant: "line" | "panel"
): string {
  const base =
    variant === "panel"
      ? "flex w-full min-w-0 flex-col border border-l-2 border-l-primary/60 px-3 py-2 shadow-sm"
      : "flex min-w-0 items-center gap-1 border px-3 py-1.5 shadow-sm";
  const tone =
    activity.state === "running"
      ? "border-foreground/[0.18] bg-card/80 dark:border-white/25 dark:bg-white/[0.10]"
      : "border-foreground/[0.10] bg-card/60 dark:border-white/10 dark:bg-white/[0.04]";
  return `${base} ${tone}`;
}

/**
 * thinking blocks: the private reasoning a reasoning-capable model streams
 * before its answer (reasoning_content), as a collapsible panel like the
 * research and editor blocks. While the model thinks it starts open with
 * the live reasoning text; when the round settles it collapses so the
 * answer leads, and expands again for the full reasoning on demand.
 */
export function ThinkingToolActivity({ activity }: { activity: ToolActivity }) {
  const running = activity.state === "running";
  const [open, setOpen] = useState(running);
  // Collapse when the round settles so the finished answer leads the panel.
  useEffect(() => {
    if (activity.state !== "running") setOpen(false);
  }, [activity.state]);
  return (
    <div
      data-testid="thinking-tool-activity"
      className="flex w-full min-w-0 flex-col"
    >
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1 text-left transition-opacity hover:opacity-80"
      >
        <span
          data-testid="thinking-tool-activity-line"
          className="flex min-w-0 items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground dark:text-muted-foreground"
        >
          {running ? (
            <CircleDashed className="size-3 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
          ) : (
            <CheckCircle2 className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <span className="min-w-0 truncate italic">Thinking</span>
        </span>
        <ChevronDown
          className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          data-testid="thinking-detail-panel"
          className="mt-2 max-h-72 w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-border/70 bg-background/70 px-3.5 py-3 shadow-inner dark:border-white/10"
        >
          {activity.detail ? (
            <div className="break-words text-sm leading-6 text-foreground">
              <MarkdownText text={activity.detail} />
            </div>
          ) : (
            <p className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
              <CircleDashed className="size-3.5 shrink-0 animate-spin" />
              The model is thinking…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Whether an activity renders as an expandable panel rather than a one-line
 * chip: the sub-agent specialists and the model's thinking blocks.
 */
export function isPanelToolActivity(name: string): boolean {
  return (
    name === "editor" ||
    name === "code_task" ||
    name === "research_web" ||
    name === "thinking"
  );
}

/** Renders the matching panel component for a panel-style activity. */
export function ToolActivityPanel({ activity }: { activity: ToolActivity }) {
  if (activity.name === "editor" || activity.name === "code_task")
    return <CodeTaskToolActivity activity={activity} />;
  if (activity.name === "research_web")
    return <ResearchToolActivity activity={activity} />;
  return <ThinkingToolActivity activity={activity} />;
}

/**
 * research_web calls get a dropdown instead of a plain one-liner: while the
 * Exa deep research runs, the panel streams the live progress notes; once it
 * finishes, the panel holds the full research report and source list the
 * researcher returned. It starts open while running so progress is visible.
 */
export function ResearchToolActivity({ activity }: { activity: ToolActivity }) {
  const [open, setOpen] = useState(activity.state === "running");
  const running = activity.state === "running";
  return (
    <div
      data-testid="research-tool-activity"
      className="flex w-full min-w-0 flex-col"
    >
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1 text-left transition-opacity hover:opacity-80"
      >
        <ToolActivityLine activity={activity} />
        <ChevronDown
          className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          data-testid="research-detail-panel"
          className="mt-2 max-h-72 w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-border/70 bg-background/70 px-3.5 py-3 shadow-inner dark:border-white/10"
        >
          {running ? (
            (activity.progressLog?.length ?? 0) > 0 ? (
              <ProgressLog log={activity.progressLog!} />
            ) : (
              <p className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                <CircleDashed className="size-3.5 shrink-0 animate-spin" />
                {activity.detail ||
                  "Exa deep research is starting its web searches…"}
              </p>
            )
          ) : activity.detail ? (
            <div className="break-words text-sm leading-6 text-foreground">
              <MarkdownText text={activity.detail} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {activity.summary ||
                (activity.state === "failed"
                  ? "The research failed."
                  : "The research response is no longer available.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
/**
 * editor calls (persisted as code_task before the rename) get the same
 * dropdown treatment as research_web: while the editor sub-agent works, the
 * panel shows the full task it was handed plus the live progress notes; once
 * it finishes, the panel holds the complete code the editor returned (or the
 * failure reason if it went down). It starts open while running so the user
 * sees what the editor is doing.
 */
export function CodeTaskToolActivity({ activity }: { activity: ToolActivity }) {
  const [open, setOpen] = useState(activity.state === "running");
  const running = activity.state === "running";
  let task = "";
  let language = "";
  try {
    const parsed = JSON.parse(activity.args?.arguments ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (typeof parsed.task === "string") task = parsed.task.trim();
      if (typeof parsed.language === "string")
        language = parsed.language.trim();
    }
  } catch {
    /* truncated or malformed - the header one-liner still applies */
  }
  return (
    <div
      data-testid="code-task-tool-activity"
      className="flex w-full min-w-0 flex-col"
    >
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1 text-left transition-opacity hover:opacity-80"
      >
        <ToolActivityLine activity={activity} />
        <ChevronDown
          className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          data-testid="code-task-detail-panel"
          className="mt-2 flex max-h-80 w-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background/70 shadow-inner dark:border-white/10"
        >
          {task && (
            <div className="shrink-0 border-b border-border/70 px-3.5 py-2.5 dark:border-white/10">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Task{language ? ` · ${language}` : ""}
              </p>
              <p className="break-words text-sm leading-6 text-foreground">
                {task}
              </p>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2.5">
            {running ? (
              (activity.progressLog?.length ?? 0) > 0 ? (
                <ProgressLog log={activity.progressLog!} />
              ) : (
                <p className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <CircleDashed className="size-3.5 shrink-0 animate-spin" />
                  {activity.detail || "The editor is reading the task…"}
                </p>
              )
            ) : activity.state === "failed" ? (
              <p className="break-words text-sm leading-6 text-red-600 dark:text-red-400">
                {activity.detail ||
                  activity.summary ||
                  "The editor task failed."}
              </p>
            ) : activity.detail ? (
              <div className="min-w-0">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Specialist's code
                </p>
                <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
                  {activity.detail}
                </pre>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {activity.summary ||
                  "The specialist's code is no longer available."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One collapsible group for a stretch of tool calls in the persisted
 * transcript. Instead of one full-width chip row per tool, consecutive tool
 * runs fold into a single quiet "Used N tools" line that expands on demand,
 * so a finished conversation reads as messages with tidy footnotes rather
 * than a wall of tool rows. A group that still contains a running tool
 * starts open, so a refreshed browser keeps showing live progress.
 */
export function ToolRunGroup({ activities }: { activities: ToolActivity[] }) {
  const [open, setOpen] = useState(
    activities.some(activity => activity.state === "running")
  );
  const failed = activities.filter(
    activity => activity.state === "failed"
  ).length;
  const count = activities.length;
  return (
    <div data-testid="tool-run-group" className="flex w-full min-w-0 flex-col">
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-foreground/[0.10] bg-card/60 px-3 py-2 text-left shadow-sm transition hover:border-primary/40 dark:border-white/10 dark:bg-white/[0.04]"
      >
        <ListChecks className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          data-testid="tool-run-group-summary"
          className="min-w-0 truncate text-xs font-medium text-muted-foreground dark:text-muted-foreground"
        >
          Used {count} tool{count === 1 ? "" : "s"}
        </span>
        {failed > 0 && (
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
            {failed} failed
          </span>
        )}
        <ChevronDown
          className={`ml-auto size-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          data-testid="tool-run-group-detail"
          className="mt-2 flex w-full min-w-0 flex-col gap-2 border-l border-foreground/[0.08] pl-3 dark:border-white/10"
        >
          {activities.map(activity =>
            isPanelToolActivity(activity.name) ? (
              <ToolActivityPanel key={activity.id} activity={activity} />
            ) : (
              <ToolActivityLine key={activity.id} activity={activity} />
            )
          )}
        </div>
      )}
    </div>
  );
}

const LIVE_RECENT_STEPS = 3;

/**
 * The single card that holds every step of a live agent run. Instead of a
 * new full-width row per tool call - which made working sessions read like a
 * log dump - all live tool activity collects into one compact card: the
 * current step spins at the bottom, the last few finished steps sit above
 * it as quiet one-liners, and longer histories fold behind a
 * "+N earlier steps" toggle. Panel specialists (editor / research / thinking)
 * keep their own expandable detail inside the card.
 */
export function LiveActivityCard({
  activities,
  working,
}: {
  activities: ToolActivity[];
  working: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const hiddenCount = Math.max(0, activities.length - LIVE_RECENT_STEPS);
  const visible =
    showAll || hiddenCount === 0
      ? activities
      : activities.slice(-LIVE_RECENT_STEPS);
  const failed = activities.filter(
    activity => activity.state === "failed"
  ).length;
  return (
    <div
      data-testid="live-activity-card"
      className="flex w-full min-w-0 flex-col gap-2.5 border border-foreground/[0.10] bg-card/60 px-3.5 py-3 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
    >
      <div className="flex min-w-0 items-center gap-2">
        {working ? (
          <CircleDashed className="size-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {working ? "Working" : "Steps"}
        </p>
        <p className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">
          {activities.length} step{activities.length === 1 ? "" : "s"}
          {failed > 0 ? ` · ${failed} failed` : ""}
        </p>
      </div>
      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-fit text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          + {hiddenCount} earlier step{hiddenCount === 1 ? "" : "s"}
        </button>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        {visible.map(activity =>
          isPanelToolActivity(activity.name) ? (
            <ToolActivityPanel key={activity.id} activity={activity} />
          ) : (
            <ToolActivityLine key={activity.id} activity={activity} />
          )
        )}
      </div>
    </div>
  );
}
