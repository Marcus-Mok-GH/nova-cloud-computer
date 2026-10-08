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

/* ------------------------------------------------------------------ *
 * Shared building blocks
 * ------------------------------------------------------------------ */

/**
 * Parses a tool call's raw JSON arguments (activity.args.arguments). Args can
 * still be truncated while a call streams, so anything that is not a plain
 * object falls back to an empty record and callers render from the tool name.
 */
function parseToolArgs(activity: ToolActivity): Record<string, unknown> {
  if (typeof activity.args?.arguments !== "string") return {};
  try {
    const parsed = JSON.parse(activity.args.arguments);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    /* truncated or malformed - fall back to the tool name */
    return {};
  }
}

/** Trimmed string value of one argument key, or "" when absent/not a string. */
function trimmedArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

/** The amber spinner line shown while a tool - or the model - is working. */
function LiveNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
      <CircleDashed className="size-3.5 shrink-0 animate-spin" />
      {children}
    </p>
  );
}

/** Settled body of a panel: the full response as Markdown, or the fallback. */
function MarkdownDetail({
  detail,
  fallback,
}: {
  detail?: string;
  fallback: React.ReactNode;
}) {
  if (detail)
    return (
      <div className="break-words text-sm leading-6 text-foreground">
        <MarkdownText text={detail} />
      </div>
    );
  // An element fallback renders as-is: LiveNote already returns a <p>, and
  // wrapping it in another one nests paragraphs the HTML parser will not keep.
  if (React.isValidElement(fallback)) return <>{fallback}</>;
  return <p className="text-xs text-muted-foreground">{fallback}</p>;
}

/** Research-style panel: scrolls its own streamed report. */
const RESEARCH_PANEL_CLASS =
  "mt-2 max-h-72 w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-border/70 bg-background/70 px-3.5 py-3 shadow-inner dark:border-white/10";

/** Solver panel: an input/output stack rather than a scroll region. */
const SOLVE_EQUATION_PANEL_CLASS =
  "mt-2 flex w-full min-w-0 flex-col gap-2.5 rounded-xl border border-border/70 bg-background/70 px-3.5 py-3 shadow-inner dark:border-white/10";

/** Frame shared by the headered panels (thinker / editor / edit_file). */
const framedPanelClass = (maxHeight: string) =>
  `mt-2 flex ${maxHeight} w-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background/70 shadow-inner dark:border-white/10`;

/**
 * The collapsible shell every panel-style activity renders through: a
 * one-line header that toggles an optional detail panel beneath it. A running
 * tool starts open so live progress is visible; a settled one starts closed.
 */
function CollapsibleToolPanel({
  testId,
  panelTestId,
  activity,
  panelClassName,
  children,
}: {
  testId: string;
  panelTestId: string;
  activity: ToolActivity;
  panelClassName: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(activity.state === "running");
  return (
    <div data-testid={testId} className="flex w-full min-w-0 flex-col">
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
        <div data-testid={panelTestId} className={panelClassName}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Live body while a sub-agent works: the append-only progress log once notes
 * have streamed, otherwise the latest detail note (or the given fallback).
 */
function RunningProgress({
  activity,
  fallback,
}: {
  activity: ToolActivity;
  fallback: string;
}) {
  const log = activity.progressLog;
  if (log && log.length > 0) return <ProgressLog log={log} />;
  return <LiveNote>{activity.detail || fallback}</LiveNote>;
}

/** One row of a tool run: a panel for the specialists, a one-liner otherwise. */
function ActivityRow({ activity }: { activity: ToolActivity }) {
  return isPanelToolActivity(activity.name) ? (
    <ToolActivityPanel activity={activity} />
  ) : (
    <ToolActivityLine activity={activity} />
  );
}

/** How many steps of a run failed, for the visible failure counters. */
const failedCount = (activities: ToolActivity[]) =>
  activities.filter(activity => activity.state === "failed").length;

/* ------------------------------------------------------------------ *
 * Components
 * ------------------------------------------------------------------ */

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
  const args = parseToolArgs(activity);
  const s = (key: string) => trimmedArg(args, key);
  const topic = s("topic");
  const name = s("name"),
    file = s("file"),
    folder = s("folder");
  const newName = s("new_name"),
    parent = s("parent"),
    task = s("task"),
    text = s("text");
  // Specialist tool calls arrive structured (args.path / args.command) and
  // are namespaced under their editor call, so the raw-arguments fallback
  // still applies when only a truncated JSON survived.
  const path = s("path"),
    command = s("command");
  const brief = (value: string, max = 60) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;
  switch (activity.name) {
    case "list_files":
      return "List Files";
    case "write_file":
      return `Write File ${path || name}`.trim();
    case "run_command":
      return command ? `Run Command: ${brief(command)}` : "Run Command";
    case "list_workspace":
      return "List Files";
    case "create_file":
      return `Create File ${name}`.trim();
    case "read_file":
      // The editor specialist passes workspace paths (args.path) while the
      // main agent passes file refs (args.file); both render the same way.
      return `Read File ${file || path}`.trim();
    case "edit_file":
      return `Edit File ${file}`.trim();
    case "create_plan":
      return "Create Plan";
    case "edit_plan":
      return "Edit Plan";
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
    case "thinker": {
      const question = s("question");
      return question ? `Thinker: ${brief(question)}` : "Thinker";
    }
    case "editor":
    case "code_task": // legacy rows from before the rename
      return task ? `Editor: ${brief(task)}` : "Editor";
    case "solve_equation": {
      const expression = s("equation");
      return expression ? `Solve: ${brief(expression)}` : "Solve";
    }
    case "thinking":
      return "Thinking";
    case "browse": {
      const cleaned = s("command").replace(/^agent-browser\s+/, "");
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
          <MarkdownDetail
            detail={activity.detail}
            fallback={<LiveNote>The model is thinking…</LiveNote>}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Panel-style activities, mapped to the component that renders them. Keeping
 * one table means the "is this a panel?" check and the "which panel?"
 * dispatch below can never drift apart. `code_task` is the legacy name for
 * `editor`; `thinking` uses the generic reasoning panel.
 */
const PANEL_COMPONENTS: Record<
  string,
  React.ComponentType<{ activity: ToolActivity }>
> = {
  editor: CodeTaskToolActivity,
  code_task: CodeTaskToolActivity,
  research_web: ResearchToolActivity,
  thinker: ThinkerToolActivity,
  thinking: ThinkingToolActivity,
  solve_equation: SolveEquationToolActivity,
  edit_file: EditFileToolActivity,
};

/**
 * Whether an activity renders as an expandable panel rather than a one-line
 * chip: the sub-agent specialists, the model's thinking blocks, the equation
 * solver, and edit_file (whose dropdown holds the diff).
 */
export function isPanelToolActivity(name: string): boolean {
  return Object.hasOwn(PANEL_COMPONENTS, name);
}

/** Renders the matching panel component for a panel-style activity. */
export function ToolActivityPanel({ activity }: { activity: ToolActivity }) {
  const Panel = PANEL_COMPONENTS[activity.name] ?? ThinkingToolActivity;
  return <Panel activity={activity} />;
}

/**
 * research_web calls get a dropdown instead of a plain one-liner: while the
 * Exa deep research runs, the panel streams the live progress notes; once it
 * finishes, the panel holds the full research report and source list the
 * researcher returned. It starts open while running so progress is visible.
 */
export function ResearchToolActivity({ activity }: { activity: ToolActivity }) {
  const running = activity.state === "running";
  return (
    <CollapsibleToolPanel
      testId="research-tool-activity"
      panelTestId="research-detail-panel"
      activity={activity}
      panelClassName={RESEARCH_PANEL_CLASS}
    >
      {running ? (
        <RunningProgress
          activity={activity}
          fallback="Exa deep research is starting its web searches…"
        />
      ) : (
        <MarkdownDetail
          detail={activity.detail}
          fallback={
            activity.summary ||
            (activity.state === "failed"
              ? "The research failed."
              : "The research response is no longer available.")
          }
        />
      )}
    </CollapsibleToolPanel>
  );
}

/**
 * The settled body of a thinker panel: the full analysis the sub-agent
 * returned (rendered as Markdown), the real failure reason when it went
 * down, or a note when the analysis is no longer persisted.
 */
export function ThinkerDetail({ activity }: { activity: ToolActivity }) {
  if (activity.state === "failed")
    return (
      <p className="break-words text-sm leading-6 text-red-600 dark:text-red-400">
        {activity.detail || activity.summary || "The thinker task failed."}
      </p>
    );
  return (
    <MarkdownDetail
      detail={activity.detail}
      fallback={
        activity.summary || "The thinker's analysis is no longer available."
      }
    />
  );
}

/**
 * The question the main agent handed the thinker, plus the context it
 * supplied, as a header inside the panel. The question is always shown in
 * full (the one-liner header truncates it); a long context is clamped to a
 * few lines with a Show more/less toggle so it never buries the analysis.
 */
export function ThinkerPromptHeader({
  question,
  context,
}: {
  question: string;
  context: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!question && !context) return null;
  const longContext = context.length > 160;
  return (
    <div className="shrink-0 border-b border-border/70 px-3.5 py-2.5 dark:border-white/10">
      {question ? (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Question
          </p>
          <p className="break-words whitespace-pre-wrap text-sm leading-6 text-foreground">
            {question}
          </p>
        </div>
      ) : null}
      {context ? (
        <div className={question ? "mt-2.5" : ""}>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Context
          </p>
          <p
            className={`break-words whitespace-pre-wrap text-xs leading-5 text-muted-foreground ${
              longContext && !expanded ? "line-clamp-3" : ""
            }`}
          >
            {context}
          </p>
          {longContext ? (
            <button
              type="button"
              onClick={() => setExpanded(previous => !previous)}
              aria-expanded={expanded}
              className="mt-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-opacity hover:opacity-80"
            >
              {expanded ? "Show less" : "Show more"}
              <ChevronDown
                className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * thinker calls get the same dropdown treatment as the other specialists:
 * while the thinker reasons, the panel streams the live progress notes; once
 * it finishes, the panel holds the complete analysis it returned - the
 * reasoning, the trade-offs and the conclusions - rendered as Markdown. The
 * question and context it was handed sit in a header above that body. It
 * starts open while running so the process is visible.
 */
export function ThinkerToolActivity({ activity }: { activity: ToolActivity }) {
  const running = activity.state === "running";
  const args = parseToolArgs(activity);
  const question = trimmedArg(args, "question");
  const context = trimmedArg(args, "context");
  return (
    <CollapsibleToolPanel
      testId="thinker-tool-activity"
      panelTestId="thinker-detail-panel"
      activity={activity}
      panelClassName={framedPanelClass("max-h-96")}
    >
      <ThinkerPromptHeader question={question} context={context} />
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3.5 py-2.5">
        {running ? (
          <RunningProgress
            activity={activity}
            fallback="The thinker sub-agent is reasoning through the question…"
          />
        ) : (
          <ThinkerDetail activity={activity} />
        )}
      </div>
    </CollapsibleToolPanel>
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
  const running = activity.state === "running";
  const args = parseToolArgs(activity);
  const task = trimmedArg(args, "task");
  const language = trimmedArg(args, "language");
  return (
    <CollapsibleToolPanel
      testId="code-task-tool-activity"
      panelTestId="code-task-detail-panel"
      activity={activity}
      panelClassName={framedPanelClass("max-h-80")}
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
          <RunningProgress
            activity={activity}
            fallback="The editor is reading the task…"
          />
        ) : activity.state === "failed" ? (
          <p className="break-words text-sm leading-6 text-red-600 dark:text-red-400">
            {activity.detail || activity.summary || "The editor task failed."}
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
    </CollapsibleToolPanel>
  );
}

/**
 * solve_equation calls get the same dropdown treatment as the specialists:
 * while the solver works it starts open with a live note, and once it settles
 * the panel shows exactly what went in (the expression Nova passed) and what
 * came out (the evaluated answer) - or the real parse error when it failed.
 */
export function SolveEquationToolActivity({
  activity,
}: {
  activity: ToolActivity;
}) {
  const equation = trimmedArg(parseToolArgs(activity), "equation");
  return (
    <CollapsibleToolPanel
      testId="solve-equation-tool-activity"
      panelTestId="solve-equation-detail-panel"
      activity={activity}
      panelClassName={SOLVE_EQUATION_PANEL_CLASS}
    >
      {activity.state === "running" ? (
        <LiveNote>Evaluating…</LiveNote>
      ) : (
        <SolveEquationDetail activity={activity} equation={equation} />
      )}
    </CollapsibleToolPanel>
  );
}

/** The settled (completed/failed) input/output body of the solver panel. */
export function SolveEquationDetail({
  activity,
  equation,
}: {
  activity: ToolActivity;
  equation: string;
}) {
  return (
    <>
      {equation && (
        <div className="min-w-0">
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Input
          </p>
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
            {equation}
          </pre>
        </div>
      )}
      <div className="min-w-0">
        <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Output
        </p>
        {activity.state === "failed" ? (
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-red-600 dark:text-red-400">
            {activity.detail ||
              activity.summary ||
              "Could not evaluate the expression."}
          </pre>
        ) : activity.detail ? (
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
            {activity.detail}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">
            {activity.summary || "The result is no longer available."}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * A unified diff rendered as tinted rows: added lines green, removed lines
 * red, hunk headers quiet. A long unbroken line scrolls horizontally inside
 * the panel rather than stretching the chat bubble.
 */
export function DiffText({ diff }: { diff: string }) {
  return (
    <pre
      data-testid="edit-file-diff"
      className="max-w-full overflow-x-auto whitespace-pre font-mono text-xs leading-5"
    >
      {diff.split("\n").map((line, index) => {
        const tone = line.startsWith("+")
          ? "text-emerald-600 dark:text-emerald-400"
          : line.startsWith("-")
            ? "text-red-600 dark:text-red-400"
            : "text-muted-foreground";
        return (
          <div key={index} className={tone}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

/** The settled (completed/failed) body of an edit_file panel: the diff. */
export function EditFileDetail({ activity }: { activity: ToolActivity }) {
  if (activity.diff) return <DiffText diff={activity.diff} />;
  if (activity.state === "failed")
    return (
      <p className="break-words text-sm leading-6 text-red-600 dark:text-red-400">
        {activity.detail || activity.summary || "The edit failed."}
      </p>
    );
  return (
    <p className="text-xs text-muted-foreground">
      {activity.summary ||
        "No changes - the file already had that content."}
    </p>
  );
}

/**
 * edit_file calls get a dropdown showing the actual change: the unified diff
 * the server computed for the edit (before -> after), with additions and
 * removals tinted. It starts open while the edit runs so the live note is
 * visible, then collapses to the diff on demand. An edit whose content was
 * unchanged (or whose diff was not recorded) says so rather than opening an
 * empty panel.
 */
export function EditFileToolActivity({ activity }: { activity: ToolActivity }) {
  const running = activity.state === "running";
  return (
    <CollapsibleToolPanel
      testId="edit-file-tool-activity"
      panelTestId="edit-file-detail-panel"
      activity={activity}
      panelClassName={framedPanelClass("max-h-80")}
    >
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3.5 py-2.5">
        {running ? (
          <LiveNote>{activity.detail || "The edit is being applied…"}</LiveNote>
        ) : (
          <EditFileDetail activity={activity} />
        )}
      </div>
    </CollapsibleToolPanel>
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
  const failed = failedCount(activities);
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
          {activities.map(activity => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
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
  const failed = failedCount(activities);
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
        {visible.map(activity => (
          <ActivityRow key={activity.id} activity={activity} />
        ))}
      </div>
    </div>
  );
}
