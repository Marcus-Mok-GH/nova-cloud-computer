import type { WorkspaceAgentOptions } from "./workspaceAgentTypes";

/**
 * The `/ultraplan` command: a deep, planning-only pass over a task. Unlike an
 * ordinary request - which the agent is told to finish end-to-end in the same
 * turn - `/ultraplan` makes the plan the deliverable: the agent researches the
 * workspace thoroughly, compares approaches, lays out an execution plan with
 * its risks, and then stops for the user's approval before changing anything.
 *
 * It mirrors opencode / Claude Code's "ultraplan": draft a rich plan up front
 * and review it before execution, rather than discovering the shape of the
 * work only once code is already being written.
 */
export const ULTRAPLAN_COMMAND = "/ultraplan";

/**
 * Matches the command at the very start of a message, optionally addressed to
 * a bot (`/ultraplan@NovaBot`, which Telegram appends in group chats), and
 * captures everything after it as the task. The trailing `(?:\s|$)` guard
 * keeps words like `/ultraplanning` from matching.
 */
const ULTRAPLAN_PATTERN = /^\s*\/ultraplan(?:@[A-Za-z0-9_]+)?(?:\s|$)([\s\S]*)$/i;

/**
 * Parses a message as the `/ultraplan` command. Returns the task text (which
 * may be empty when the command was sent alone) or null when the message is
 * not the command.
 */
export function parseUltraplanCommand(
  text: unknown
): { task: string } | null {
  if (typeof text !== "string") return null;
  const match = ULTRAPLAN_PATTERN.exec(text);
  if (!match) return null;
  return { task: (match[1] ?? "").trim() };
}

/**
 * The tools an ultraplan turn may use: read-only exploration plus the two
 * tools that write the plan document itself - creating it is the whole point
 * of the turn, and nothing else may change. Every other writing tool is
 * withheld by name: files and folders (create/edit/rename/move/delete),
 * memory (save/delete), Telegram sends, presenting files, deploys and site
 * deletion, project scaffolding, the editor, connector and GitHub actions,
 * and both run_bash and run_vm_task - the sandbox shares a filesystem with
 * the workspace, so shell work could still create files that sync back. New
 * tools are excluded by default, exactly like the email-reply allowlist.
 */
const ULTRAPLAN_TOOL_ALLOWLIST = new Set([
  "end_turn",
  "list_workspace",
  "read_file",
  "search_memories",
  "read_memory",
  "solve_equation",
  "research_web",
  "thinker",
  // The plan document itself is the one thing an ultraplan turn writes.
  "create_plan",
  "edit_plan",
]);

/** True when a tool may run inside a planning-only `/ultraplan` turn. */
export function ultraplanAllowsTool(name: string): boolean {
  return ULTRAPLAN_TOOL_ALLOWLIST.has(name);
}

/** Writes a conversation's plan document. Available only in an ultraplan turn. */
export const CREATE_PLAN_TOOL = "create_plan";
/** Replaces a conversation's plan document. Available only in an ultraplan turn. */
export const EDIT_PLAN_TOOL = "edit_plan";

/** True when a tool is one of the ultraplan plan-writing tools. */
export function isPlanTool(name: string): boolean {
  return name === CREATE_PLAN_TOOL || name === EDIT_PLAN_TOOL;
}

/**
 * The workspace file a conversation's ultraplan is written to:
 * `PLAN_<chat id>.md` at the workspace root, so every chat keeps its own
 * plan. The id is sanitized so it is always a safe file name.
 */
export function planFileName(chatId: string | number | undefined): string {
  const safe = String(chatId ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
  return `PLAN_${safe || "unknown"}.md`;
}

/** Shown when `/ultraplan` is sent without a task to plan. */
export const ULTRAPLAN_USAGE =
  'To plan with /ultraplan, send it with the task to plan - for example "/ultraplan add a login page to the site". I\'ll research the workspace, compare the approaches and their risks, and lay out an execution plan for your approval before I change anything.';

/**
 * The turn instruction that puts the agent into ultraplan mode. It is added to
 * the model's user turn only (the visible chat bubble keeps the user's clean
 * `/ultraplan <task>` text). It deliberately overrides the system prompt's
 * "never reply with only a plan" rule for this turn: here the plan IS the
 * deliverable, and execution waits for the user's approval.
 */
export function buildUltraplanInstruction(
  task: string,
  channel: WorkspaceAgentOptions["channel"] = "web"
): string {
  const trimmed = task.trim();
  const taskLine = trimmed
    ? `The task to plan: ${trimmed}`
    : "No task was given. Reply with one short usage line - that /ultraplan needs the task to plan, with an example - then end the turn. Do not explore, plan, or change anything.";
  const formatting =
    channel === "telegram"
      ? `This request arrived over Telegram, so write the plan as plain text: no markdown of any kind (no '#', '*', '_', backticks, code fences, tables, or [label](url) links). Use plain uppercase section labels and simple hyphen or numbered lists, paste raw URLs, and keep each line short. Send the complete plan in one end_turn reply - Telegram splits long messages for you.`
      : `This request arrived in the Nova web app, so render the plan as clean Markdown: '##' section headings, a table for the approach comparison and the risk matrix, a fenced code block for the dependency graph, and bullet lists for the files affected and the verification checklist.`;
  return `[ULTRAPLAN - deep planning mode]
The user invoked /ultraplan, so on this turn planning IS the deliverable. Override the usual "never reply with only a plan" rule: apart from saving this conversation's plan document with create_plan / edit_plan, do NOT create, edit, move, rename, or delete any files, do NOT deploy, publish, send messages, run automations, or make any other change, reversible or not, and do NOT start executing the task. Finish with the complete plan and wait for the user to approve it before any work happens.
${taskLine}
Plan deeply before writing:
- Decompose the task into the concrete questions you need answered: what must change, where in the workspace it lives, which files and existing patterns are involved, what could break, and how success will be verified.
- Explore for real, in parallel where you can: use list_workspace and read_file to inspect the relevant files and folders, and search_memories / read_memory for what was decided earlier. Use thinker for the hard reasoning - architecture, integration points, trade-offs, and failure modes. Use research_web only when the plan depends on current external facts, and cite the sources you use. Do not guess about the workspace when a tool can tell you.
- This turn is read-only except for the plan document: every other write tool (create/edit/rename/move/delete for files and folders, run_bash and run_vm_task, editor, deploy/delete website, project scaffolding, Telegram sends, memory writes, and connectors) is not available to you, so never attempt to change anything. The only writes you may make are create_plan and edit_plan, which write this conversation's plan file (PLAN_<chat id>.md at the workspace root).
Then synthesize one complete plan, in this order:
1. EXECUTIVE SUMMARY - one short paragraph: the task, the approach, and the expected outcome.
2. APPROACHES - compare 2-3 genuine options on complexity, risk, effort (files touched), reversibility, and test coverage; recommend one and say why.
3. EXECUTION PLAN - the steps grouped into phases that show what can run in parallel and what depends on what (a dependency graph); name the files each step touches.
4. RISKS - a risk table with probability, impact, and a mitigation for each; call out the highest risk.
5. FILES AFFECTED - every file to be created, modified, or deleted.
6. VERIFICATION - the checks that will prove it worked (tests, typecheck, build, manual smoke test), split into before and after the change.
Save the finished plan to the workspace with create_plan - or, when a plan already exists for this conversation, read it and replace it with edit_plan - and include the full plan in your reply too. Close by stating plainly that nothing else has been changed yet and asking the user to approve, adjust, or cancel the plan. When they approve, you will implement it; until then, make no changes. Do not execute the plan yourself, and do not ask a clarifying question that stops the plan - if a requirement is ambiguous, state the assumption you made in the plan and list it as an open question.
${formatting}`;
}
