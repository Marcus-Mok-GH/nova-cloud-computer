import React, { useState } from "react";
import { CheckCircle2, ChevronDown, CircleDashed, XCircle } from "lucide-react";
import type { ToolActivity } from "@/lib/chatMessages";
import { MarkdownText } from "@/lib/markdown";

/**
 * One-line rendering for a tool call, e.g. "Read File notes.txt".
 * Args arrive as a raw JSON string in activity.args.arguments.
 */
export function toolLineText(activity: ToolActivity): string {
  let args: Record<string, unknown> = {};
  if (typeof activity.args?.arguments === "string") {
    try {
      const parsed = JSON.parse(activity.args.arguments);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch { /* truncated or malformed - fall back to the tool name */ }
  }
  const s = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : "");
  const topic = s(args.topic);
  const name = s(args.name), file = s(args.file), folder = s(args.folder);
  const newName = s(args.new_name), parent = s(args.parent), task = s(args.task), text = s(args.text);
  const brief = (value: string, max = 60) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
  switch (activity.name) {
    case "list_workspace": return "List Files";
    case "create_file": return `Create File ${name}`.trim();
    case "read_file": return `Read File ${file}`.trim();
    case "edit_file": return `Edit File ${file}`.trim();
    case "rename_file": return `Rename File ${file} → ${newName}`.trim();
    case "move_file": return `Move File ${file} → ${folder}`.trim();
    case "delete_file": return `Delete File ${file}`.trim();
    case "create_folder": return `Create Folder ${name}`.trim();
    case "rename_folder": return `Rename Folder ${folder} → ${newName}`.trim();
    case "move_folder": return `Move Folder ${folder} → ${parent}`.trim();
    case "delete_folder": return `Delete Folder ${folder}`.trim();
    case "send_telegram_message": return text ? `Send Telegram Message: ${brief(text)}` : "Send Telegram Message";
    case "run_vm_task": return task ? `Run VM Task: ${brief(task)}` : "Run VM Task";
    case "research_web": return topic ? `Deep Research: ${brief(topic)}` : "Deep Research";
    case "code_task": return task ? `Code Task: ${brief(task)}` : "Code Task";
    default: return activity.name;
  }
}

export function ToolActivityLine({ activity }: { activity: ToolActivity }) {
  const StatusIcon = activity.state === "completed" ? CheckCircle2 : activity.state === "failed" ? XCircle : CircleDashed;
  const stateClass = activity.state === "completed" ? "text-emerald-600 dark:text-emerald-400" : activity.state === "failed" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
  return (
    <div data-testid="tool-activity-line" className="flex min-w-0 items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground dark:text-muted-foreground">
      <StatusIcon className={`size-3 shrink-0 ${stateClass}${activity.state === "running" ? " animate-spin" : ""}`} />
      <span className="min-w-0 truncate">{toolLineText(activity)}{activity.state === "failed" ? " (failed)" : ""}</span>
    </div>
  );
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
    <div data-testid="research-tool-activity" className="flex w-full min-w-0 flex-col">
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1 text-left transition-opacity hover:opacity-80"
      >
        <ToolActivityLine activity={activity} />
        <ChevronDown className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div data-testid="research-detail-panel" className="mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-border/70 bg-background/70 px-3.5 py-3 shadow-inner dark:border-white/10">
          {running ? (
            <p className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
              <CircleDashed className="size-3.5 shrink-0 animate-spin" />
              {activity.detail || "Exa deep research is starting its web searches…"}
            </p>
          ) : activity.detail ? (
            <div className="break-words text-sm leading-6 text-foreground">
              <MarkdownText text={activity.detail} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {activity.summary || (activity.state === "failed" ? "The research failed." : "The research response is no longer available.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
