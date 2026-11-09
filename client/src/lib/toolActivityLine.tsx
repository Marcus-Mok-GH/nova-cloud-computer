import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { ToolActivity } from "@/lib/chatMessages";
import { ToolOwnerBadge } from "@/components/workspaceChat";
import { MarkdownText } from "@/lib/markdown";
import { pluralize } from "@shared/text";

/* ------------------------------------------------------------------ *
 * Shared building blocks
 * ------------------------------------------------------------------ */

/**
 * Parses a tool call's raw JSON arguments (activity.args.arguments). Args can
 * still be truncated while a call streams, so anything that is not a plain
 * object falls back to an empty record and callers render from the tool name.
 */
function parseToolArgs(activity: ToolActivity): Record<string, unknown> {
  if (typeof activity.args?.arguments !== "string") {
    // A few producers emit the identifying fields directly
    // (args.path / args.command) instead of the JSON-string shape.
    // Accept them as-is so the label still names the file or command.
    const direct: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(activity.args ?? {})) {
      if (typeof entry === "string" && entry) direct[key] = entry;
    }
    return direct;
  }
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
    <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
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

/** Header strip above a panel body (task/question context). */
const PANEL_HEADER_CLASS =
  "shrink-0 border-b border-border/70 px-3.5 py-2.5 dark:border-white/10";

/** Scrollable body region shared by the headered panels. */
const PANEL_SCROLL_CLASS =
  "min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3.5 py-2.5";

/** The small uppercase label above a panel section (Question, Input, ...). */
function PanelLabel({
  children,
  className = "mb-1",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`${className} text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground`}
    >
      {children}
    </p>
  );
}

/** Settled failure body of a panel: the real reason, in red. */
function FailedDetail({
  activity,
  fallback,
}: {
  activity: ToolActivity;
  fallback: string;
}) {
  return (
    <p className="break-words text-sm leading-6 text-red-600 dark:text-red-400">
      {activity.detail || activity.summary || fallback}
    </p>
  );
}

/** Monospace block for code/expressions inside a panel. */
function MonoPre({
  children,
  failed,
}: {
  children: React.ReactNode;
  failed?: boolean;
}) {
  return (
    <pre
      className={`max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 ${
        failed ? "text-red-600 dark:text-red-400" : "text-foreground"
      }`}
    >
      {children}
    </pre>
  );
}

/** Quiet note when a settled panel has no detail left, only the summary. */
function SummaryNote({
  activity,
  fallback,
}: {
  activity: ToolActivity;
  fallback: string;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      {activity.summary || fallback}
    </p>
  );
}

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
        className="flex w-full min-w-0 items-center gap-1 text-start transition-opacity hover:opacity-80"
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

/**
 * The one-line reason a step failed, for the inline red note under a failed
 * row. The server already writes a human summary for every settled call
 * ("Ran a bash command…", "Command failed: …") - the UI used to drop it and
 * show only "(failed)" next to a raw command, so nobody could tell what
 * went wrong without opening devtools. Detail wins when it exists (it is
 * the tool's own output); otherwise the summary. Capped to the first
 * non-empty line so a multi-kilobyte error body cannot flood the chat.
 */
export function failureReason(activity: ToolActivity): string {
  const raw = (activity.detail || activity.summary || "").trim();
  if (!raw) return "";
  const firstLine =
    raw
      .split("\n")
      .map(line => line.trim())
      .find(Boolean) ?? "";
  return firstLine.length > 180 ? `${firstLine.slice(0, 179)}…` : firstLine;
}

/** The full command behind a run_command / run_bash / browse row, if any. */
function fullCommand(activity: ToolActivity): string {
  const args = parseToolArgs(activity);
  return trimmedArg(args, "command");
}

/**
 * A plain (non-panel) step row. Most steps are just their one-liner, but a
 * step that ran a command or produced detail gets a chevron: tapping it
 * reveals the full command / output in mono, instead of the truncated
 * preview the one-liner shows. Failed steps already carry their reason
 * inline (see ToolActivityLine), so this panel is for the details behind
 * a finished step - and it stays closed until asked for, so a long run
 * does not turn into a wall of open panels.
 */
function PlainToolActivity({ activity }: { activity: ToolActivity }) {
  const [open, setOpen] = useState(false);
  const command = fullCommand(activity);
  const detail = (activity.detail || "").trim();
  const hasPanel = Boolean(command || detail);
  if (!hasPanel) return <ToolActivityLine activity={activity} />;
  return (
    <div
      data-testid="plain-tool-activity"
      className="flex w-full min-w-0 flex-col"
    >
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1 text-start transition-opacity hover:opacity-80"
      >
        <ToolActivityLine activity={activity} />
        <ChevronDown
          className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          data-testid="plain-tool-detail"
          className="mt-1.5 max-h-64 w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-lg border border-border/70 bg-background/70 px-3 py-2 shadow-inner dark:border-white/10"
        >
          {command && (
            <div className="min-w-0">
              <PanelLabel className="mb-0.5">Command</PanelLabel>
              <MonoPre>{command}</MonoPre>
            </div>
          )}
          {detail && (
            <div className={command ? "mt-2 min-w-0" : "min-w-0"}>
              <PanelLabel className="mb-0.5">Output</PanelLabel>
              <MonoPre failed={activity.state === "failed"}>{detail}</MonoPre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One row of a tool run: a panel for the specialists, a one-liner otherwise. */
function ActivityRow({ activity }: { activity: ToolActivity }) {
  return isPanelToolActivity(activity.name) ? (
    <ToolActivityPanel activity={activity} />
  ) : (
    <PlainToolActivity activity={activity} />
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
function ProgressLog({ log }: { log: string[] }) {
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
            <span className="min-w-0 break-words">{line}</span>
          </p>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

/**
 * Whether a tool activity names who made the call. The server persists
 * `owner` on every row it writes now (Nova's own calls `nova`, a coding
 * specialist's steps `coding-specialist`); rows written before the field
 * existed carry nothing, and are treated as Nova's own calls - which is how
 * the server was emitting them all along.
 */
export function isOwnerTagged(activity: ToolActivity): boolean {
  return activity.owner !== undefined;
}

/**
 * Display label for who made a tool call. Nova's own calls render no badge
 * (they are the default voice of the thread); every sub-agent is named.
 */
export function toolOwnerLabel(
  activity: ToolActivity
): string | null {
  switch (activity.owner) {
    case "coding-specialist":
      return "Editor (sub-agent)";
    case "research-agent":
      return "Research (sub-agent)";
    case "thinker-agent":
      return "Thinker (sub-agent)";
    case "vm-agent":
      return "Sandbox (sub-agent)";
    case "nova":
    case undefined:
      return null;
    default:
      return null;
  }
}

/** True for activities that were delegated to a sub-agent. */
export function isSubagentActivity(activity: ToolActivity): boolean {
  return toolOwnerLabel(activity) !== null;
}

/**
 * One-line rendering for a tool call, e.g. "Read File notes.txt".
 * Args arrive as a raw JSON string in activity.args.arguments.
 *
 * Labels are written for the chat reader, not the model: every tool name
 * the server can emit has a plain-English label here, raw shell commands
 * are previewed by program instead of dumped mid-quote, and an unknown
 * name still reads as words ("Wake Sandbox") instead of the snake_case
 * identifier the model called ("wake_sandbox") - the full command and any
 * failure reason are one tap away on the row, not crammed into the line.
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
  // A shell command is code, not a label: a 200-character
  // `python3 -c "from pathlib import Path; …"` truncated at 60 chars
  // reads as broken text and tells the user nothing they can act on.
  // Short commands ("npm test", "ls") read fine in full; long ones are
  // previewed by the program that ran, and the full command sits behind
  // the row's chevron.
  const commandPreview = (value: string): string => {
    const flat = value.replace(/\s+/g, " ").trim();
    if (!flat) return "";
    if (flat.length <= 32) return flat;
    const program = flat.split(" ")[0]?.replace(/^.*\//, "") ?? "";
    return program || brief(flat, 32);
  };
  const withArg = (label: string, arg: string) =>
    arg ? `${label} ${arg}` : label;
  switch (activity.name) {
    case "list_files":
      return "List Files";
    case "write_file":
      return withArg("Write File", path || name);
    case "run_command":
    case "run_bash": {
      const preview = commandPreview(command);
      return preview ? `Run Command: ${preview}` : "Run Command";
    }
    case "list_workspace":
      return "List Files";
    case "create_file":
      return withArg("Create File", name);
    case "read_file":
      // The editor specialist passes workspace paths (args.path) while the
      // main agent passes file refs (args.file); both render the same way.
      return withArg("Read File", file || path);
    case "edit_file":
      return withArg("Edit File", file || path);
    case "create_plan":
      return "Create Plan";
    case "edit_plan":
      return "Edit Plan";
    case "start_planning":
      return "Start Planning";
    case "rename_file":
      return `Rename File ${file} → ${newName}`.trim();
    case "move_file":
      return `Move File ${file} → ${folder}`.trim();
    case "delete_file":
      return withArg("Delete File", file);
    case "create_folder":
      return withArg("Create Folder", name);
    case "rename_folder":
      return `Rename Folder ${folder} → ${newName}`.trim();
    case "move_folder":
      return `Move Folder ${folder} → ${parent}`.trim();
    case "delete_folder":
      return withArg("Delete Folder", folder);
    case "send_telegram_message":
    case "send_progress_update":
      return text
        ? `${activity.name === "send_progress_update" ? "Send Progress Update" : "Send Telegram Message"}: ${brief(text)}`
        : activity.name === "send_progress_update"
          ? "Send Progress Update"
          : "Send Telegram Message";
    case "present_file":
      return withArg("Show File", file);
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
    case "follow_up":
      return "Suggested Follow-ups";
    case "browse": {
      const browseCommand = s("command");
      return browseCommand ? `Browse: ${brief(browseCommand)}` : "Browse";
    }
    case "wake_sandbox":
      return "Wake Workspace";
    case "read_memory":
      return "Read Memory";
    case "search_memories":
      return s("query")
        ? `Search Memories: ${brief(s("query"))}`
        : "Search Memories";
    case "save_memory":
      return "Save Memory";
    case "delete_memory":
      return "Delete Memory";
    case "read_skill":
      return withArg("Read Skill", name);
    case "set_env_var":
      return withArg("Set Environment Variable", name);
    case "set_communication_style":
      return "Save Communication Style";
    case "set_personalisation":
      return "Save Personalisation";
    case "deploy_website":
      return withArg("Deploy Website", s("directory"));
    case "delete_website":
      return "Delete Website";
    case "create_project_template":
      return withArg("Create Project", name);
    case "report_goal":
      return "Report Goal";
    case "request_purchase":
      return withArg("Request Purchase", s("item"));
    case "send_agent_email":
      return withArg("Send Email", s("to") || s("subject"));
    case "accept_own_coding":
      return "Accept Own Coding";
    case "list_connector_tools":
      return "List Connector Tools";
    case "use_connector_tool":
      return withArg("Run Connector Tool", s("tool"));
    case "end_turn":
      return "Finish Turn";
    default: {
      // Connector and future tools have no bespoke label yet: render the
      // identifier as words, and append the operation when one was passed
      // ("GitHub: search repositories") so the row still says what happened.
      const words = activity.name
        .split("_")
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      const operation = s("operation");
      return operation
        ? `${words}: ${brief(operation.replace(/_/g, " "))}`
        : words;
    }
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
  // A failed step gets the red tone instead of the muted one: in a long
  // list the failures are the only rows worth scanning for, and they must
  // not hide behind the same grey as everything else.
  const textClass =
    activity.state === "running"
      ? "text-foreground"
      : activity.state === "failed"
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground dark:text-muted-foreground";
  const line = toolLineText(activity);
  const ownerBadge = <ToolOwnerBadge activity={activity} />;
  // Panel steps (editor, research, …) explain themselves in their panel;
  // a plain step has nowhere else to say why it failed, so the reason
  // rides inline under its line.
  const reason =
    activity.state === "failed" && !isPanelToolActivity(activity.name)
      ? failureReason(activity)
      : "";
  return (
    <div
      data-testid="tool-activity-line"
      title={line}
      className={`flex min-w-0 flex-col px-1 text-[13px] font-medium leading-5 ${textClass}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <StatusIcon
          className={`size-3.5 shrink-0 ${stateClass}`}
        />
        {ownerBadge}
        <span className="min-w-0 truncate">
          {line}
          {activity.state === "failed" ? " (failed)" : ""}
        </span>
      </span>
      {reason ? (
        <span
          data-testid="tool-activity-failure-reason"
          className="min-w-0 break-words ps-5 text-xs font-normal leading-5 text-red-600/90 dark:text-red-400/90"
        >
          {reason}
        </span>
      ) : null}
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
      ? "flex w-full min-w-0 flex-col border border-s-2 border-s-primary/60 px-3 py-2 shadow-sm"
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
        className="flex w-full min-w-0 items-center gap-1 text-start transition-opacity hover:opacity-80"
      >
        <span
          data-testid="thinking-tool-activity-line"
          className="flex min-w-0 items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground dark:text-muted-foreground"
        >
          {running ? (
            <CircleDashed className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
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
      <FailedDetail activity={activity} fallback="The thinker task failed." />
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
    <div className={PANEL_HEADER_CLASS}>
      {question ? (
        <div>
          <PanelLabel>Question</PanelLabel>
          <p className="break-words whitespace-pre-wrap text-sm leading-6 text-foreground">
            {question}
          </p>
        </div>
      ) : null}
      {context ? (
        <div className={question ? "mt-2.5" : ""}>
          <PanelLabel>Context</PanelLabel>
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
      <div className={PANEL_SCROLL_CLASS}>
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
        <div className={PANEL_HEADER_CLASS}>
          <PanelLabel>Task{language ? ` · ${language}` : ""}</PanelLabel>
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
          <FailedDetail
            activity={activity}
            fallback="The editor task failed."
          />
        ) : activity.detail ? (
          <div className="min-w-0">
            <PanelLabel>Specialist's code</PanelLabel>
            <MonoPre>{activity.detail}</MonoPre>
          </div>
        ) : (
          <SummaryNote
            activity={activity}
            fallback="The specialist's code is no longer available."
          />
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
          <PanelLabel className="mb-0.5">Input</PanelLabel>
          <MonoPre>{equation}</MonoPre>
        </div>
      )}
      <div className="min-w-0">
        <PanelLabel className="mb-0.5">Output</PanelLabel>
        {activity.state === "failed" ? (
          <MonoPre failed>
            {activity.detail ||
              activity.summary ||
              "Could not evaluate the expression."}
          </MonoPre>
        ) : activity.detail ? (
          <MonoPre>{activity.detail}</MonoPre>
        ) : (
          <SummaryNote
            activity={activity}
            fallback="The result is no longer available."
          />
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
    return <FailedDetail activity={activity} fallback="The edit failed." />;
  return (
    <SummaryNote
      activity={activity}
      fallback="No changes - the file already had that content."
    />
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
      <div className={PANEL_SCROLL_CLASS}>
        {running ? (
          <LiveNote>{activity.detail || "The edit is being applied…"}</LiveNote>
        ) : (
          <EditFileDetail activity={activity} />
        )}
      </div>
    </CollapsibleToolPanel>
  );
}

/* ------------------------------------------------------------------ *
 * Run summaries: what a stretch of steps adds up to, in one line
 * ------------------------------------------------------------------ */

/**
 * Category labels for the run summary, as past-tense counts ("9 files read").
 * A run of 30 steps is a wall of one-liners; its shape - mostly reading,
 * some writing, a handful of commands - is what a reader actually wants.
 */
const CATEGORY_LABELS: Record<string, (count: string) => string> = {
  read_file: count => `${count} file${count === "1" ? "" : "s"} read`,
  write_file: count => `${count} file${count === "1" ? "" : "s"} written`,
  create_file: count => `${count} file${count === "1" ? "" : "s"} created`,
  edit_file: count => `${count} file${count === "1" ? "" : "s"} edited`,
  delete_file: count => `${count} file${count === "1" ? "" : "s"} deleted`,
  rename_file: count => `${count} file${count === "1" ? "" : "s"} renamed`,
  move_file: count => `${count} file${count === "1" ? "" : "s"} moved`,
  list_files: count => `${count} file listing${count === "1" ? "" : "s"}`,
  list_workspace: count => `${count} file listing${count === "1" ? "" : "s"}`,
  run_command: count => `${count} command${count === "1" ? "" : "s"} run`,
  run_bash: count => `${count} command${count === "1" ? "" : "s"} run`,
  run_vm_task: count => `${count} VM task${count === "1" ? "" : "s"} run`,
  create_folder: count => `${count} folder${count === "1" ? "" : "s"} created`,
  delete_folder: count => `${count} folder${count === "1" ? "" : "s"} deleted`,
  rename_folder: count => `${count} folder${count === "1" ? "" : "s"} renamed`,
  move_folder: count => `${count} folder${count === "1" ? "" : "s"} moved`,
  editor: count => `${count} coding task${count === "1" ? "" : "s"}`,
  code_task: count => `${count} coding task${count === "1" ? "" : "s"}`,
  research_web: count => `${count} research task${count === "1" ? "" : "s"}`,
  thinker: count => `${count} think${count === "1" ? "" : "s"}`,
  thinking: count => `${count} think${count === "1" ? "" : "s"}`,
  browse: count => `${count} browse step${count === "1" ? "" : "s"}`,
  solve_equation: count =>
    `${count} equation${count === "1" ? "" : "s"} solved`,
  wake_sandbox: () => "workspace woken",
  read_memory: () => "memory read",
  search_memories: () => "memories searched",
  save_memory: () => "memory saved",
};

export type ActivitySummary = {
  total: number;
  completed: number;
  failed: number;
  running: number;
  /** The step happening now, when one is still running. */
  current?: ToolActivity;
  /** One-line headline: "Working now - Read File ..." / "Finished - 30 steps". */
  headline: string;
  /** "9 files read - 5 files written - 6 commands run" for long runs. */
  categories: string;
};

/**
 * Adds up a stretch of steps into what a reader needs at a glance: how
 * many there were, how many failed, what is happening right now, and -
 * for a long run - what the steps mostly were. The headline names the
 * current step while running, so "Working..." never has to be taken on
 * faith; a settled run reads as an outcome, not a tool count.
 */
export function summarizeActivities(
  activities: ToolActivity[]
): ActivitySummary {
  const total = activities.length;
  const failed = failedCount(activities);
  const running = activities.filter(
    activity => activity.state === "running"
  ).length;
  const completed = total - failed - running;
  const current = [...activities]
    .reverse()
    .find(activity => activity.state === "running");
  const counts = new Map<string, number>();
  for (const activity of activities) {
    counts.set(activity.name, (counts.get(activity.name) ?? 0) + 1);
  }
  const categories = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => {
      const label = CATEGORY_LABELS[name];
      return label
        ? label(String(count))
        : `${count} ${toolLineText({ id: "", name, state: "completed", args: {} }).toLowerCase()}`;
    })
    .join(" · ");
  const headline = current
    ? `Working now — ${toolLineText(current)}`
    : failed > 0
      ? `${pluralize(total, "step")} · ${failed} failed`
      : `Finished · ${pluralize(total, "step")}`;
  return { total, completed, failed, running, current, headline, categories };
}

/** How many steps to show before "show all" - enough to see the shape of a
 * run, never a 30-row wall. */
const RECENT_STEPS = 5;

/**
 * The open body of a step list: what the steps mostly were, the failures
 * pinned first (they are the reason anyone opens the list), then the most
 * recent steps in order, with the rest behind a toggle. Chronological
 * order is kept inside each section so the list still reads as a story.
 */
function StepsDetail({ activities }: { activities: ToolActivity[] }) {
  const [showAll, setShowAll] = useState(false);
  const summary = summarizeActivities(activities);
  const failedActivities = activities.filter(
    activity => activity.state === "failed"
  );
  const hiddenCount = Math.max(0, activities.length - RECENT_STEPS);
  const recent = showAll ? activities : activities.slice(-RECENT_STEPS);
  const recentShown =
    showAll || failedActivities.length === 0
      ? recent
      : recent.filter(
          activity =>
            !failedActivities.some(failed => failed.id === activity.id)
        );
  return (
    <div className="flex w-full min-w-0 flex-col gap-2.5">
      {activities.length >= 4 && summary.categories ? (
        <p
          data-testid="tool-run-categories"
          className="min-w-0 break-words text-[11px] font-medium leading-5 text-muted-foreground"
        >
          {summary.categories}
        </p>
      ) : null}
      {!showAll && failedActivities.length > 0 ? (
        <div className="flex w-full min-w-0 flex-col gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-600 dark:text-red-400">
            Didn&#8217;t work
          </p>
          {failedActivities.map(activity => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </div>
      ) : null}
      {hiddenCount > 0 && !showAll ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-fit text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          + {pluralize(hiddenCount, "earlier step")} - show all{" "}
          {pluralize(activities.length, "step")}
        </button>
      ) : null}
      <div className="flex min-w-0 flex-col gap-2">
        {recentShown.map(activity => (
          <ActivityRow key={activity.id} activity={activity} />
        ))}
      </div>
      {showAll && hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="w-fit text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Show fewer
        </button>
      ) : null}
    </div>
  );
}

/**
 * One collapsible group for a stretch of tool calls in the persisted
 * transcript. Instead of one full-width chip row per tool, consecutive tool
 * runs fold into a single quiet headline that expands on demand, so a
 * finished conversation reads as messages with tidy footnotes rather
 * than a wall of tool rows. The headline is an outcome - what is
 * happening now, or how the run ended - not a tool count. A group that
 * still contains a running tool starts open, so a refreshed browser
 * keeps showing live progress, but open now means the recent steps
 * plus their failures, not all 30 rows at once.
 */
export function ToolRunGroup({
  activities,
  ownerBadge,
}: {
  activities: ToolActivity[];
  ownerBadge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(
    activities.some(activity => activity.state === "running")
  );
  const summary = summarizeActivities(activities);
  const StatusIcon =
    summary.running > 0
      ? CircleDashed
      : summary.failed > 0
        ? TriangleAlert
        : CheckCircle2;
  const iconClass =
    summary.running > 0
      ? "text-amber-600 dark:text-amber-400"
      : summary.failed > 0
        ? "text-red-600 dark:text-red-400"
        : "text-emerald-600 dark:text-emerald-400";
  return (
    <div data-testid="tool-run-group" className="flex w-full min-w-0 flex-col">
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-foreground/[0.10] bg-card/60 px-3 py-2 text-start shadow-sm transition hover:border-primary/40 dark:border-white/10 dark:bg-white/[0.04]"
      >
        <StatusIcon className={`size-3.5 shrink-0 ${iconClass}`} />
        {ownerBadge}
        <span
          data-testid="tool-run-group-summary"
          className={`min-w-0 truncate text-xs font-medium ${
            summary.running > 0
              ? "text-foreground"
              : "text-muted-foreground dark:text-muted-foreground"
          }`}
        >
          {summary.headline}
        </span>
        <ChevronDown
          className={`ms-auto size-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          data-testid="tool-run-group-detail"
          className="mt-2 flex w-full min-w-0 flex-col border-s border-foreground/[0.08] ps-3 dark:border-white/10"
        >
          <StepsDetail activities={activities} />
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
 * keep their own expandable detail inside the card. The header names the
 * outcome while it happens - the current step, or how the run ended.
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
  const summary = summarizeActivities(activities);
  const failed = summary.failed;
  const label = working
    ? "Working now"
    : failed > 0
      ? "Finished with problems"
      : "Finished";
  return (
    <div
      data-testid="live-activity-card"
      className="flex w-full min-w-0 flex-col gap-2.5 border border-foreground/[0.10] bg-card/60 px-3.5 py-3 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
    >
      <div className="flex min-w-0 items-center gap-2">
        {working ? (
          <CircleDashed className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : failed > 0 ? (
          <TriangleAlert className="size-3.5 shrink-0 text-red-600 dark:text-red-400" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <p className="ms-auto shrink-0 text-[10px] font-medium text-muted-foreground">
          {pluralize(activities.length, "step")}
          {failed > 0 ? ` · ${failed} failed` : ""}
        </p>
      </div>
      {working && summary.current ? (
        <p className="min-w-0 truncate text-[13px] font-medium leading-5 text-foreground">
          Now: {toolLineText(summary.current)}
        </p>
      ) : null}
      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-fit text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          + {pluralize(hiddenCount, "earlier step")}
        </button>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        {visible.map(activity => (
          <ActivityRow key={activity.id} activity={activity} />
        ))}
      </div>
      {showAll && hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="w-fit text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Show fewer
        </button>
      ) : null}
    </div>
  );
}
