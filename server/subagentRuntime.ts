/**
 * The subagent runtime shared by the autonomous editor (coder.ts) and the
 * preparing-next-turn pass (agentsInit.ts). Both run the same miniature loop
 * - a NIM-served model with list_files / read_file / write_file / run_command
 * over the live E2B sandbox - and historically each carried its own copy of
 * the context-compaction budget, the tool executor and the sandbox helpers,
 * so a fix to one silently missed the other. Everything identical now lives
 * here.
 */
import { E2B_WORKSPACE_DIR, type E2BSandboxLike } from "./e2b";
import { mirrorWorkspaceOp } from "./sandboxWorkspace";
import { safeRelativePath as safeWorkspacePath } from "./workspace/paths";
import type { NimAgentMessage } from "./nim";

/** Cap applied when a file is read back through read_file. */
export const READ_LIMIT = 16_000;
/** Cap applied to a command's stdout and stderr sections. */
export const COMMAND_OUTPUT_LIMIT = 4_000;
/** Default wall-clock budget for one sandbox command. */
export const COMMAND_TIMEOUT_MS = 120_000;
/**
 * The subagent's conversation grows by a full tool result every round - a
 * file read can be 16k characters and a command's output 4k - so a long
 * autonomous task eventually pushes the request past the model's context
 * window and the call is refused. The conversation is compacted before it
 * gets there: what matters for the remaining work is the recent exchange and
 * the files already written, not the byte payloads of every earlier read, so
 * the oldest tool results collapse to a short stub. The assistant tool_call
 * to tool-result pairing and every call's id are preserved, keeping the
 * conversation valid for the model while the window stops filling up. This is
 * what lets a long task finish instead of dying at the context limit.
 */
export const CONTEXT_CHAR_BUDGET = 300_000;
/**
 * Output-token cap for one subagent round. The file content in a write_file
 * call counts as output, so a small cap truncates a large file into malformed
 * JSON and fails the write; 16384 comfortably covers the files this workspace
 * handles while staying well inside what NIM-served coding models emit.
 */
export const SUBAGENT_MAX_TOKENS = 16_384;
export const CONTEXT_KEEP_RECENT_MESSAGES = 8;
export const CONTEXT_RECENT_TOOL_CAP = 12_000;
export const CONTEXT_ASSISTANT_CAP = 4_000;
export const CONTEXT_OLD_TOOL_STUB =
  "(earlier tool output omitted to stay within the model's context window)";

/** Truncates to `max` characters, appending a visible suffix. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…(truncated)`;
}

/** Approximate size of the subagent's conversation, in characters. */
export function contextChars(messages: NimAgentMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (message.role === "tool") total += message.content.length;
    else if (message.role === "assistant") {
      total += message.content?.length ?? 0;
      for (const call of message.tool_calls ?? [])
        total += call.function.arguments.length;
    } else total += message.content.length;
  }
  return total;
}

/**
 * Shrinks the subagent's conversation toward the context budget without
 * breaking it. Messages up to and including the first user turn (the system
 * prompt and the task intro) are never touched: they are the anchor the model
 * needs to stay on task. Older tool results become a stub, the most recent
 * ones are capped, and long interim assistant text is trimmed - the
 * assistant's tool_calls are always kept intact, so every tool result still
 * follows the call it answers. Returns true when anything changed, so callers
 * can tell whether compaction can free more before giving up.
 */
export function compactContext(
  messages: NimAgentMessage[],
  options?: { aggressive?: boolean }
): boolean {
  const aggressive = options?.aggressive ?? false;
  const firstUser = messages.findIndex(message => message.role === "user");
  if (firstUser < 0) return false;
  const keepRecent = aggressive ? 4 : CONTEXT_KEEP_RECENT_MESSAGES;
  const recentStart = Math.max(firstUser + 1, messages.length - keepRecent);
  const toolCap = aggressive ? 2_000 : CONTEXT_RECENT_TOOL_CAP;
  const assistantCap = aggressive ? 500 : CONTEXT_ASSISTANT_CAP;
  let changed = false;
  for (let index = firstUser + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "tool") {
      if (index < recentStart) {
        if (message.content !== CONTEXT_OLD_TOOL_STUB) {
          messages[index] = { ...message, content: CONTEXT_OLD_TOOL_STUB };
          changed = true;
        }
      } else if (message.content.length > toolCap) {
        const capped = truncate(message.content, toolCap);
        // truncate appends a suffix, so compare the result: re-capping an
        // already-shortened message must not read as progress, or the caller
        // would retry the same over-long request forever.
        if (capped !== message.content) {
          messages[index] = { ...message, content: capped };
          changed = true;
        }
      }
    } else if (message.role === "assistant") {
      let next = message;
      if (message.content && message.content.length > assistantCap) {
        const capped = truncate(message.content, assistantCap);
        if (capped !== message.content) {
          next = { ...next, content: capped };
          changed = true;
        }
      }
      // An old exchange keeps the file payloads of its write_file calls in the
      // tool-call arguments, and those can dwarf the results themselves. Once
      // the exchange is old its arguments are no longer needed, so replace
      // them with an empty object - still valid JSON, matched by the stubbed
      // tool result - or a task that repeatedly writes large files would keep
      // the window pinned open no matter how its text is trimmed. The recent
      // calls keep their arguments intact.
      if (index < recentStart && next.tool_calls?.length) {
        let shrank = false;
        const toolCalls = next.tool_calls.map(call => {
          if (call.function.arguments === "{}") return call;
          shrank = true;
          return { ...call, function: { ...call.function, arguments: "{}" } };
        });
        if (shrank) {
          next = { ...next, tool_calls: toolCalls };
          changed = true;
        }
      }
      if (next !== message) messages[index] = next;
    }
  }
  return changed;
}

/**
 * Runs one shell command in the workspace directory of the live sandbox and
 * formats a model-ready result.
 */
export async function runSandboxCommand(
  sandbox: E2BSandboxLike,
  command: string,
  remainingMs: number
): Promise<{ ok: boolean; result: string }> {
  // Never grant more time than the segment has left: the caller skips a call
  // once the deadline passes, and a command must not outlive the segment.
  const timeoutMs = Math.min(COMMAND_TIMEOUT_MS, Math.max(0, remainingMs));
  const result = await sandbox.commands.run(
    `cd ${E2B_WORKSPACE_DIR} && (${command})`,
    { timeoutMs }
  );
  const stdout = String((result as { stdout?: unknown }).stdout ?? "");
  const stderr = String((result as { stderr?: unknown }).stderr ?? "");
  const exitCode = (result as { exitCode?: unknown }).exitCode ?? 0;
  const parts: string[] = [];
  if (stdout.trim()) parts.push(truncate(stdout, COMMAND_OUTPUT_LIMIT));
  if (stderr.trim())
    parts.push(`[stderr]\n${truncate(stderr, COMMAND_OUTPUT_LIMIT)}`);
  parts.push(`[exit code ${exitCode}]`);
  return {
    ok: exitCode === 0,
    result: parts.join("\n") || "(no output)",
  };
}

/**
 * Lists the workspace files for a subagent's intro prompt and list_files
 * tool. Failures stay failures: a thrown command or a non-zero exit must not
 * read as a successful empty listing, or the subagent (and the user's
 * activity feed) would believe the workspace is empty.
 */
export async function listWorkspaceFiles(
  sandbox: E2BSandboxLike
): Promise<{ ok: boolean; result: string }> {
  try {
    const result = await sandbox.commands.run(
      `cd ${E2B_WORKSPACE_DIR} && find . -type f -not -path './.git/*' | sort | head -200`,
      { timeoutMs: 15_000 }
    );
    const exitCode = (result as { exitCode?: unknown }).exitCode ?? 0;
    if (exitCode !== 0)
      return {
        ok: false,
        result: `(could not list the workspace: exit code ${exitCode})`,
      };
    const listing = String((result as { stdout?: unknown }).stdout ?? "")
      .split("\n")
      .map(line => line.trim().replace(/^\.\//, ""))
      .filter(Boolean);
    return {
      ok: true,
      result:
        listing.length > 0 ? listing.join("\n") : "(the workspace is empty)",
    };
  } catch {
    return { ok: false, result: "(could not list the workspace)" };
  }
}

/** The short identifying args an activity carries (no payloads). */
export function subagentToolArgs(
  name: string,
  rawArguments: string
): Record<string, string> {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      args = parsed as Record<string, unknown>;
  } catch {
    // Truncated or malformed JSON - the label falls back to the tool name.
  }
  const s = (value: unknown) => (typeof value === "string" ? value : "");
  if (name === "read_file" || name === "write_file")
    return args.path ? { path: s(args.path) } : {};
  if (name === "run_command")
    return args.command ? { command: s(args.command) } : {};
  return {};
}

/** One-line summary of a settled subagent tool call. */
export function subagentToolSummary(
  name: string,
  args: Record<string, string>,
  ok: boolean
): string {
  const brief = (value: string, max: number) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;
  switch (name) {
    case "list_files":
      return ok
        ? "Listed the workspace files."
        : "Could not list the workspace files.";
    case "read_file":
      return ok ? `Read ${args.path}.` : `Could not read ${args.path}.`;
    case "write_file":
      return ok ? `Wrote ${args.path}.` : `Could not write ${args.path}.`;
    case "run_command":
      return `${ok ? "Ran" : "Command failed"}: ${brief(args.command ?? "", 80)}`;
    default:
      return ok ? "Completed." : "Failed.";
  }
}

/** Executes one subagent tool call, returning its ok flag and result text. */
export async function executeSubagentToolCall(
  sandbox: E2BSandboxLike,
  name: string,
  rawArguments: string,
  writtenPaths: Set<string>,
  remainingMs = COMMAND_TIMEOUT_MS
): Promise<{ ok: boolean; result: string }> {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      args = parsed as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      result: "Invalid JSON arguments - call the tool again with valid JSON.",
    };
  }
  const str = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  // File content is the one argument that must survive byte-exact: leading
  // indentation, trailing newlines and inner whitespace are all meaningful.
  const raw = (value: unknown) => (typeof value === "string" ? value : "");
  switch (name) {
    case "list_files":
      return await listWorkspaceFiles(sandbox);
    case "read_file": {
      const path = safeWorkspacePath(str(args.path));
      if (!path) return { ok: false, result: `Unsafe path: ${str(args.path)}` };
      try {
        const content = await sandbox.files.read(
          `${E2B_WORKSPACE_DIR}/${path}`,
          { format: "text" }
        );
        const text =
          typeof content === "string"
            ? content
            : Buffer.from(content as Uint8Array).toString("utf8");
        return {
          ok: true,
          result:
            text.length > 0
              ? truncate(text, READ_LIMIT)
              : "(the file is empty)",
        };
      } catch {
        return {
          ok: false,
          result: `Could not read ${path} - it may not exist. Use list_files first.`,
        };
      }
    }
    case "write_file": {
      const path = safeWorkspacePath(str(args.path));
      const content = raw(args.content);
      if (!path) return { ok: false, result: `Unsafe path: ${str(args.path)}` };
      if (!content)
        return {
          ok: false,
          result: "write_file needs the file's full content.",
        };
      const mirrored = await mirrorWorkspaceOp(sandbox, {
        kind: "write_file",
        path,
        content,
      });
      if (!mirrored.ok)
        return {
          ok: false,
          result: `Could not write ${path}: ${mirrored.error}`,
        };
      writtenPaths.add(path);
      return {
        ok: true,
        result: `Wrote ${path} (${content.length} characters).`,
      };
    }
    case "run_command": {
      const command = str(args.command);
      if (!command)
        return { ok: false, result: "run_command needs a command." };
      // The durable store only ever imports sandbox files - it never
      // deletes - so a shell delete or rename would diverge from it and
      // the file would resurrect on the next run. The system prompt asks
      // the model not to; this boundary check makes it stick for the
      // common cases (rm, mv, unlink, rmdir, shred, and the git
      // equivalents). Anything else destructive is the prompt's job.
      const forbidden =
        /(^|[;&|\s])(rm|rmdir|unlink|shred)\b|(^|[;&|\s])mv\b|git\s+(rm|clean)\b/.test(
          command
        );
      if (forbidden) {
        return {
          ok: false,
          result:
            "Rejected: this workspace must not delete or rename files with shell " +
            "commands (the durable store would resurrect them). To replace content, " +
            "use write_file with the full new content; to move a file, write_file " +
            "the new path and ask Nova to remove the old one afterwards.",
        };
      }
      try {
        return await runSandboxCommand(sandbox, command, remainingMs);
      } catch (error) {
        return {
          ok: false,
          result: `The command failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        };
      }
    }
    default:
      return { ok: false, result: `Unknown tool: ${name}` };
  }
}
