/**
 * The workspace agent's tool executor: one switch that runs every tool
 * call the model requests, plus the file/folder resolution helpers it
 * needs. Split out of workspaceAgent.ts so the run loop and the tool
 * implementations can be read and changed independently.
 */
import { runBrowserCommand } from "./agentBrowser";
import { startAgentVmRun } from "./agentVm";
import {
  requestAgentEmailApproval,
  requestWalletPurchaseApproval,
} from "./agents";
import {
  type GatewayToolCall,
} from "./aiGateway";
import {
  decodeBase44Text,
  encodeBase44Text,
} from "./base44";
import {
  MIN_CALL_RESERVE_MS,
  runAutonomousCoderTask,
  runCoderTask,
  type CoderOutcome,
  type CoderToolActivity,
} from "./coder";
import {
  ComposioApiError,
  GITHUB_OPERATIONS,
  executeComposioTool,
  executeGithubOperation,
  isGithubOperation,
  listComposioTools,
} from "./composio";
import {
  PERSONALISATION_DETAILS,
  PERSONALISATION_EXPERTISE,
  PERSONALISATION_PROACTIVENESS,
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  deleteWorkspaceFileForUser,
  deleteWorkspaceFolderForUser,
  getTelegramCredentialsForUser,
  getWorkspaceComputer,
  setCommunicationStyleForUser,
  setPersonalisationForUser,
  updateWorkspaceFileForUser,
  updateWorkspaceFolderForUser,
  type PersonalisationDetail,
  type PersonalisationExpertise,
  type PersonalisationInput,
  type PersonalisationProactiveness,
} from "./db";
import {
  type E2BSandboxLike,
} from "./e2b";
import {
  deleteMemoryForUser,
  readMemoryForUser,
  saveMemoryForUser,
  searchMemoriesForUser,
} from "./memories";
import { NimConfigError } from "./nim";
import {
  PROJECT_TEMPLATE_KEYS,
  isProjectTemplateKey,
  renderProjectTemplate,
  slugifyProjectName,
} from "./projectTemplates";
import { runResearch } from "./researcher";
import {
  folderPathOf,
  mirrorWorkspaceOp,
  runBashOnSandbox,
  syncAgentSandbox,
  workspaceRelativePathOf,
  type SandboxOp,
} from "./sandboxWorkspace";
import {
  deleteWorkspaceSite,
  deployWorkspaceSite,
} from "./siteDeploy";
import {
  presentTelegramFile,
  sendTelegramMessage,
} from "./telegram";
import { runThinkerTask } from "./thinker";
import { planFileName } from "./ultraplan";
import {
  isCodeFileName,
  isSubstantialCode,
  unifiedDiff,
} from "./workspaceEdits";
import { evaluate } from "mathjs";

import {
  type AgentChatRunOptions,
  type AgentAction,
  type WorkspaceToolActivity,
  recordSpecialistAcceptance,
} from "./workspaceAgentTypes";

type Computer = Awaited<ReturnType<typeof getWorkspaceComputer>>;
type FolderRow = Computer["folders"][number];
type FileRow = Computer["files"][number];

function resolveFolder(
  computer: Computer,
  ref: unknown
): FolderRow | undefined {
  if (typeof ref !== "string" || !ref.trim()) return undefined;
  const key = ref.trim();
  const numeric = /^\d+$/.test(key) ? Number(key) : undefined;
  if (numeric !== undefined) {
    const byId = computer.folders.find(folder => folder.id === numeric);
    if (byId) return byId;
  }
  const normalized = normalizeWorkspaceRef(key);
  const byName = computer.folders.find(
    folder => folder.name.toLowerCase() === normalized
  );
  if (byName) return byName;
  // Nested folder path, e.g. "sites/ph-meter": match the last segment with
  // its parent path.
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) return undefined;
  const base = segments[segments.length - 1];
  const dir = segments.slice(0, -1).join("/");
  const folderRows = folderRowsOf(computer);
  return computer.folders.find(
    folder =>
      folder.name.toLowerCase() === base &&
      (folderPathOf(folderRows, folder.parentId ?? null)?.toLowerCase() ??
        "") === dir
  );
}

/** Normalizes a workspace reference the way a model might write it: a bare
 * name, an id, or a path like "folder-name/index.html" (optionally prefixed
 * with "./" or "/"). Returns lowercase, no leading/trailing slashes. */
function normalizeWorkspaceRef(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:\.?\/)+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

type FolderRowLike = { id: number; name: string; parentId: number | null };

function folderRowsOf(computer: Computer): FolderRowLike[] {
  return computer.folders as FolderRowLike[];
}

/** The workspace-relative path of a file, lowercase ("folder/index.html"). */
function fileWorkspacePath(
  folderRows: FolderRowLike[],
  file: { name: string; folderId: number | null }
): string {
  return (
    workspaceRelativePathOf(
      folderRows,
      file.name,
      file.folderId
    )?.toLowerCase() ?? file.name.toLowerCase()
  );
}

function resolveFile(
  computer: Computer,
  ref: unknown,
  options: { strict?: boolean } = {}
): FileRow | undefined {
  if (typeof ref !== "string" || !ref.trim()) return undefined;
  const key = ref.trim();
  const numeric = /^\d+$/.test(key) ? Number(key) : undefined;
  if (numeric !== undefined) {
    const byId = computer.files.find(file => file.id === numeric);
    if (byId) return byId;
  }
  const normalized = normalizeWorkspaceRef(key);
  const folderRows = folderRowsOf(computer);
  // 1. Exact name match (case-insensitive) - the common case.
  const byName = computer.files.find(
    file => file.name.toLowerCase() === normalized
  );
  if (byName) return byName;
  // 2. Full workspace-path match, e.g. "ph-meter/index.html".
  const byPath = computer.files.find(
    file => fileWorkspacePath(folderRows, file) === normalized
  );
  if (byPath) return byPath;
  // 3. Path-style ref whose last segment names a file: resolve by basename,
  //    preferring the file inside the folder path the ref points at.
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) return undefined;
  const base = segments[segments.length - 1];
  const dir = segments.slice(0, -1).join("/");
  const basenameMatches = computer.files.filter(
    file => file.name.toLowerCase() === base
  );
  if (basenameMatches.length === 0) return undefined;
  if (dir) {
    const inDir = basenameMatches.find(file => {
      const parent =
        folderPathOf(folderRows, file.folderId ?? null)?.toLowerCase() ?? "";
      return parent === dir;
    });
    if (inDir) return inDir;
  }
  // Mutating tools must not act on a loose basename match for a
  // path-qualified ref: deleting "wrong-folder/report.md" should never
  // delete some other folder's report.md.
  if (options.strict) return undefined;
  return basenameMatches[0];
}

/** A "File not found" tool result that steers the model out of path-guessing
 * loops: the original ref, the closest existing candidates, and the one
 * command that always works. Keeps the "File not found:" prefix the failure
 * nudges quote. */
function fileNotFoundResult(computer: Computer, ref: unknown): string {
  const raw = typeof ref === "string" ? ref : String(ref ?? "");
  const normalized = normalizeWorkspaceRef(String(raw));
  const folderRows = folderRowsOf(computer);
  const segments = normalized.split("/").filter(Boolean);
  const base = segments[segments.length - 1] ?? normalized;
  const suggestions: string[] = [];
  const seen = new Set<string>();
  for (const file of computer.files) {
    const path = fileWorkspacePath(folderRows, file);
    if (seen.has(path)) continue;
    const pathSegments = path.split("/");
    const matches =
      file.name.toLowerCase() === base ||
      path === normalized ||
      (segments.length > 1 && path.endsWith(`/${normalized}`)) ||
      segments.some(
        seg =>
          seg.length >= 3 &&
          pathSegments.some(
            pSeg => pSeg === seg || pSeg.includes(seg) || seg.includes(pSeg)
          )
      );
    if (!matches) continue;
    seen.add(path);
    suggestions.push(`${path} (id ${file.id})`);
    if (suggestions.length >= 5) break;
  }
  const hint = suggestions.length
    ? ` Closest matches: ${suggestions.join(", ")}. Use the exact name or id from that list.`
    : " No existing file looks similar - call list_workspace to see every file and folder before trying again.";
  return `File not found: ${raw}.${hint}`;
}

/**
 * The failure returned when a tool names a folder that does not exist. Every
 * folder-taking tool steers the model the same way, from one place.
 */
function folderNotFound(
  ref: unknown,
  label: "Folder" | "Parent folder" = "Folder"
): ToolExecution {
  const raw = typeof ref === "string" ? ref.trim() : "";
  const hint =
    label === "Folder" ? " Use list_workspace to see every folder." : "";
  return { ok: false, result: `${label} not found: ${raw}.${hint}` };
}

/**
 * True when a sibling at the same level already uses this name. Root-level
 * rows never collide in the database (a NULL parent id is not compared), so
 * every create/rename/move guards itself with this same check - files through
 * their folderId, folders through their parentId.
 */
function nameTakenAtLevel<T extends { id: number; name: string }>(
  rows: readonly T[],
  name: string,
  levelOf: (row: T) => number | null,
  level: number | null,
  excludeId?: number
): boolean {
  const wanted = name.toLowerCase();
  return rows.some(
    row =>
      (excludeId === undefined || row.id !== excludeId) &&
      levelOf(row) === level &&
      row.name.toLowerCase() === wanted
  );
}

function describeWorkspace(computer: Computer) {
  const folders =
    computer.folders
      .map(
        folder =>
          `${folder.name} (id ${folder.id}${folder.parentId ? `, parent id ${folder.parentId}` : ""})`
      )
      .join(", ") || "none";
  const files =
    computer.files
      .map(
        file =>
          `${file.name} (id ${file.id}${file.folderId ? `, folder id ${file.folderId}` : ""})`
      )
      .join(", ") || "none";
  return { folders, files };
}

export type ToolExecution = {
  ok: boolean;
  result: string;
  action?: AgentAction;
  /** Full raw response surfaced in the research dropdown in the UI. */
  detail?: string;
  /** Unified diff of the change, surfaced in the edit_file dropdown in the UI. */
  diff?: string;
  /**
   * Set when the coding specialist is confirmed unavailable (a non-config
   * error survived the internal retry, or NIM is not configured). The run
   * loop uses it to stop re-nudging toward the editor: with the specialist
   * down, self-coding is legitimate degraded mode - as long as the model
   * disclosed it to the user as the failure policy requires.
   */
  specialistDown?: boolean;
};

/** Formats a numeric mathjs result for the agent: clean integers, readable decimals. */
function formatMathAnswer(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // Round long floats to 6 decimal places, trimming trailing zeros.
  return String(Math.round(value * 1e6) / 1e6);
}

/**
 * The specialist-down self-coding gate, threaded through a run. `blocked`
 * forbids non-trivial create_file/edit_file writes; the accept tool lifts it
 * only in a LATER conversation turn, never in the run where the editor failed.
 */
export type OwnCodingGate = {
  chatId: string;
  /** True while the user has not yet accepted Nova's own coding. */
  blocked: boolean;
  /** True when this run started with a pending acceptance question. */
  awaitingAcceptance: boolean;
  /** True when the editor sub-agent failed inside this same run. */
  specialistDownThisRun: boolean;
};

const SPECIALIST_DOWN_BLOCK_RESULT =
  "Blocked: the coding specialist is down and the user has not accepted Nova's own coding yet. " +
  "Do NOT write this code yourself. Tell the user exactly that the coding specialist is down for this task, " +
  "ask whether to proceed with Nova's own attempt, and end your turn. Only in a later conversation turn, " +
  "once the user has explicitly accepted, call the accept_own_coding tool to record it - then you may write " +
  "the code yourself, saying plainly it is Nova's own work without the specialist.";

/** Executes a single model-requested tool call against the workspace. */
export async function executeWorkspaceTool(
  ownerId: number,
  computer: Computer,
  call: GatewayToolCall,
  onProgress?: (detail: string) => void,
  sandbox?: E2BSandboxLike,
  gate?: OwnCodingGate,
  channel?: "telegram" | "web",
  deadlineAtMs?: number,
  chatId?: string,
  /**
   * Receives the editor specialist's own tool calls (read/write/list/command)
   * as they happen, so they stream as first-class activity rows like the
   * agent's own tool calls instead of prose notes.
   */
  onSubToolActivity?: (tool: WorkspaceToolActivity) => void | Promise<void>,
  /** Personal-agent context: scopes memory and enables the gated identity tools. */
  agentChat?: AgentChatRunOptions
): Promise<ToolExecution> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    if (args === null || typeof args !== "object") args = {};
  } catch {
    return { ok: false, result: "Invalid JSON arguments." };
  }
  const str = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  // An agent's memory tools read and write its own scope (plus shared notes);
  // the default assistant stays in the shared workspace scope.
  const memoryScope = agentChat
    ? { agentId: agentChat.profile.id }
    : undefined;
  // Sandbox-first execution: the workspace sandbox (woken at run start) is
  // the live execution surface, and the durable Neon/S3 store syncs from it.
  // Every mutating file/folder operation is mirrored onto the sandbox
  // filesystem; a mirror failure is logged but never blocks the durable op.
  const folderRows = computer.folders as Array<{
    id: number;
    name: string;
    parentId: number | null;
  }>;
  const mirror = async (op: SandboxOp) => {
    if (!sandbox) return;
    try {
      const mirrored = await mirrorWorkspaceOp(sandbox, op);
      if (!mirrored.ok)
        console.error("[Sandbox mirror] failed", op.kind, mirrored.error);
    } catch (error) {
      console.error("[Sandbox mirror] error", op.kind, error);
    }
  };
  switch (call.name) {
    case "search_memories": {
      const query = str(args.query).trim();
      const limitArg = Number(args.limit);
      const limit = Number.isFinite(limitArg) && limitArg >= 1 ? limitArg : 8;
      const records = memoryScope
        ? await searchMemoriesForUser(ownerId, query, limit, memoryScope)
        : await searchMemoriesForUser(ownerId, query, limit);
      return {
        ok: true,
        result: records.length
          ? records
              .map(
                record =>
                  `Memory ${record.id} - ${record.title} (updated ${record.updatedAt.toISOString().slice(0, 10)}): ${record.summary}`
              )
              .join("\n")
          : "No memories matched that search.",
        action: {
          kind: "tool",
          name: query.slice(0, 60) || "recent memories",
          operation: records.length ? "listed" : "failed",
        },
      };
    }
    case "read_memory": {
      const id = Number(args.id);
      const record =
        Number.isFinite(id) && id > 0
          ? await readMemoryForUser(ownerId, id, memoryScope)
          : null;
      if (!record)
        return {
          ok: false,
          result: `No memory with id ${str(args.id)} - search_memories lists the valid ids.`,
          action: {
            kind: "tool",
            name: `memory ${str(args.id)}`,
            operation: "failed",
          },
        };
      return {
        ok: true,
        result: `Memory ${record.id} - ${record.title}\n\n${record.content}`,
        action: {
          kind: "tool",
          name: `memory ${record.id}`,
          operation: "listed",
        },
      };
    }
    case "save_memory": {
      const title = str(args.title).trim();
      const summary = str(args.summary).trim();
      const content = str(args.content);
      if (!title || !summary || !content.trim())
        return {
          ok: false,
          result: "A memory needs a title, a summary, and content.",
          action: { kind: "tool", name: "save_memory", operation: "failed" },
        };
      const record = await saveMemoryForUser(ownerId, {
        title,
        summary,
        content,
        tags: args.tags !== undefined ? str(args.tags) : null,
        agentId: agentChat?.profile.id ?? null,
      });
      if (!record)
        return {
          ok: false,
          result: "The memory store is unavailable right now.",
          action: {
            kind: "tool",
            name: title.slice(0, 60),
            operation: "failed",
          },
        };
      return {
        ok: true,
        result: `Saved memory ${record.id}: ${record.title}.`,
        action: {
          kind: "tool",
          name: title.slice(0, 60),
          operation: "created",
        },
      };
    }
    case "delete_memory": {
      const id = Number(args.id);
      const deleted =
        Number.isFinite(id) && id > 0
          ? await deleteMemoryForUser(ownerId, id, memoryScope)
          : false;
      if (!deleted)
        return {
          ok: false,
          result: `No memory with id ${str(args.id)} - search_memories lists the valid ids.`,
          action: {
            kind: "tool",
            name: `memory ${str(args.id)}`,
            operation: "failed",
          },
        };
      return {
        ok: true,
        result: `Deleted memory ${id}.`,
        action: { kind: "tool", name: `memory ${id}`, operation: "deleted" },
      };
    }
    case "request_purchase": {
      if (!agentChat)
        return {
          ok: false,
          result:
            "request_purchase is only available to personal agents with a wallet.",
          action: { kind: "tool", name: "purchase request", operation: "failed" },
        };
      const outcome = await requestWalletPurchaseApproval(ownerId, {
        agentId: agentChat.profile.id,
        chatId: chatId ?? null,
        item: str(args.item),
        amountCredits: Number(args.amount_credits),
        note: str(args.note) || null,
      });
      if (!outcome.ok)
        return {
          ok: false,
          result: outcome.error,
          action: {
            kind: "tool",
            name: `purchase ${str(args.item).slice(0, 50) || "request"}`,
            operation: "failed",
          },
        };
      return { ok: true, result: outcome.message };
    }
    case "send_agent_email": {
      if (!agentChat)
        return {
          ok: false,
          result:
            "send_agent_email is only available to personal agents with an identity.",
          action: { kind: "tool", name: "agent email", operation: "failed" },
        };
      const outcome = await requestAgentEmailApproval(ownerId, {
        agentId: agentChat.profile.id,
        chatId: chatId ?? null,
        to: str(args.to),
        subject: str(args.subject),
        body: str(args.body),
      });
      if (!outcome.ok)
        return {
          ok: false,
          result: outcome.error,
          action: { kind: "tool", name: "agent email", operation: "failed" },
        };
      return { ok: true, result: outcome.message };
    }
    case "list_workspace": {
      const { folders, files } = describeWorkspace(computer);
      return {
        ok: true,
        result: `Folders: ${folders}. Files: ${files}.`,
      };
    }
    case "create_file": {
      const name = str(args.name);
      if (!name) return { ok: false, result: "A file name is required." };
      // Root-level names bypass the database unique constraint (NULL
      // folderId rows never collide in Postgres), so the guard lives here:
      // one file per name at the same level, case-insensitive like folders.
      const targetFolder =
        args.folder !== undefined
          ? resolveFolder(computer, args.folder)
          : undefined;
      if (args.folder !== undefined && !targetFolder)
        return folderNotFound(args.folder);
      if (
        nameTakenAtLevel(
          computer.files,
          name,
          file => file.folderId ?? null,
          targetFolder?.id ?? null
        )
      ) {
        return {
          ok: false,
          result: `A file named ${name} already exists in that location${targetFolder ? "" : " (workspace root)"}. Edit the existing file instead, or delete it first.`,
        };
      }
      if (
        gate?.blocked &&
        isCodeFileName(name) &&
        isSubstantialCode(str(args.content))
      ) {
        return {
          ok: false,
          result: SPECIALIST_DOWN_BLOCK_RESULT,
          action: {
            kind: "tool",
            name: `create_file: ${name}`,
            operation: "failed",
          },
        };
      }
      const created = await createWorkspaceFileForUser(ownerId, {
        name,
        content: str(args.content),
        folderId: targetFolder?.id ?? null,
      });
      if (!created)
        return {
          ok: false,
          result: `Could not create the file - a file named ${name} may already exist.`,
        };
      const createdPath = workspaceRelativePathOf(
        folderRows,
        created.name,
        created.folderId ?? null
      );
      if (createdPath)
        await mirror({
          kind: "write_file",
          path: createdPath,
          content: str(args.content),
        });
      return {
        ok: true,
        result: `Created ${created.name} (id ${created.id}).`,
        action: { kind: "file", name: created.name, operation: "created" },
      };
    }
    case "read_file": {
      const file = resolveFile(computer, args.file);
      if (!file)
        return { ok: false, result: fileNotFoundResult(computer, args.file) };
      return {
        ok: true,
        result: `Content of ${file.name} (id ${file.id}):\n${String(file.content ?? "").slice(0, 20000)}`,
      };
    }
    case "edit_file": {
      const file = resolveFile(computer, args.file, { strict: true });
      if (!file)
        return { ok: false, result: fileNotFoundResult(computer, args.file) };
      const content = typeof args.content === "string" ? args.content : "";
      const previousContent = String(file.content ?? "");
      if (
        gate?.blocked &&
        isCodeFileName(file.name) &&
        isSubstantialCode(content)
      ) {
        return {
          ok: false,
          result: SPECIALIST_DOWN_BLOCK_RESULT,
          action: {
            kind: "tool",
            name: `edit_file: ${file.name}`,
            operation: "failed",
          },
        };
      }
      const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
        content,
      });
      if (!updated)
        return { ok: false, result: `Could not edit ${file.name}.` };
      const editedPath = workspaceRelativePathOf(
        folderRows,
        file.name,
        file.folderId ?? null
      );
      if (editedPath)
        await mirror({ kind: "write_file", path: editedPath, content });
      return {
        ok: true,
        result: `Updated ${file.name} (id ${file.id}).`,
        action: { kind: "file", name: file.name, operation: "updated" },
        // The dropdown shows what actually changed; an unchanged write has
        // no diff worth surfacing.
        diff: unifiedDiff(previousContent, content) || undefined,
      };
    }
    // The two plan tools write this conversation's ultraplan document. They
    // are exposed only on a /ultraplan turn (see ultraplanAllowsTool), so the
    // plan is the one thing a read-only planning pass may create.
    case "create_plan": {
      if (!chatId)
        return {
          ok: false,
          result:
            "The plan tools need a conversation context, which is missing on this run.",
        };
      const name = planFileName(chatId);
      const content = typeof args.content === "string" ? args.content : "";
      if (!content.trim())
        return { ok: false, result: "The plan content is required." };
      const existing = computer.files.find(
        file =>
          (file.folderId ?? null) === null &&
          file.name.toLowerCase() === name.toLowerCase()
      );
      if (existing)
        return {
          ok: false,
          result: `A plan already exists for this conversation (${name}). Read it and use edit_plan to replace it.`,
        };
      const created = await createWorkspaceFileForUser(ownerId, {
        name,
        content,
        folderId: null,
      });
      if (!created)
        return { ok: false, result: `Could not create ${name}.` };
      const createdPath = workspaceRelativePathOf(
        folderRows,
        created.name,
        created.folderId ?? null
      );
      if (createdPath)
        await mirror({ kind: "write_file", path: createdPath, content });
      return {
        ok: true,
        result: `Created the plan at ${created.name} (id ${created.id}).`,
        action: { kind: "file", name: created.name, operation: "created" },
      };
    }
    case "edit_plan": {
      if (!chatId)
        return {
          ok: false,
          result:
            "The plan tools need a conversation context, which is missing on this run.",
        };
      const name = planFileName(chatId);
      const content = typeof args.content === "string" ? args.content : "";
      const file = computer.files.find(
        candidate =>
          (candidate.folderId ?? null) === null &&
          candidate.name.toLowerCase() === name.toLowerCase()
      );
      if (!file)
        return {
          ok: false,
          result: `No plan exists for this conversation yet (${name}). Use create_plan to write it.`,
        };
      const previousContent = String(file.content ?? "");
      const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
        content,
      });
      if (!updated) return { ok: false, result: `Could not edit ${file.name}.` };
      const editedPath = workspaceRelativePathOf(
        folderRows,
        file.name,
        file.folderId ?? null
      );
      if (editedPath)
        await mirror({ kind: "write_file", path: editedPath, content });
      return {
        ok: true,
        result: `Updated the plan ${file.name} (id ${file.id}).`,
        action: { kind: "file", name: file.name, operation: "updated" },
        diff: unifiedDiff(previousContent, content) || undefined,
      };
    }
    case "rename_file": {
      const file = resolveFile(computer, args.file, { strict: true });
      const newName = str(args.new_name);
      if (!file)
        return { ok: false, result: fileNotFoundResult(computer, args.file) };
      if (!newName)
        return { ok: false, result: "A new file name is required." };
      // Same root-level constraint as create_file: renames onto an existing
      // name never hit the database guard when the folder is NULL.
      if (
        nameTakenAtLevel(
          computer.files,
          newName,
          other => other.folderId ?? null,
          file.folderId ?? null,
          file.id
        )
      )
        return {
          ok: false,
          result: `A file named ${newName} already exists in that location. Pick a different name, or delete the other file first.`,
        };
      const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
        name: newName,
      });
      if (!updated)
        return {
          ok: false,
          result: `Could not rename ${file.name} - ${newName} may already exist.`,
        };
      const renameFrom = workspaceRelativePathOf(
        folderRows,
        file.name,
        file.folderId ?? null
      );
      const renameTo = workspaceRelativePathOf(
        folderRows,
        newName,
        file.folderId ?? null
      );
      if (renameFrom && renameTo)
        await mirror({ kind: "move_path", from: renameFrom, to: renameTo });
      return {
        ok: true,
        result: `Renamed ${file.name} to ${updated.name}.`,
        action: { kind: "file", name: updated.name, operation: "renamed" },
      };
    }
    case "move_file": {
      const file = resolveFile(computer, args.file, { strict: true });
      const folder = resolveFolder(computer, args.folder);
      if (!file)
        return { ok: false, result: fileNotFoundResult(computer, args.file) };
      if (!folder) return folderNotFound(args.folder);
      if (
        nameTakenAtLevel(
          computer.files,
          file.name,
          other => other.folderId ?? null,
          folder.id,
          file.id
        )
      )
        return {
          ok: false,
          result: `A file named ${file.name} already exists in ${folder.name}. Rename one of them first, or delete the other file.`,
        };
      const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
        folderId: folder.id,
      });
      if (!updated)
        return { ok: false, result: `Could not move ${file.name}.` };
      const moveFrom = workspaceRelativePathOf(
        folderRows,
        file.name,
        file.folderId ?? null
      );
      const parentPath = folderPathOf(folderRows, folder.id);
      const moveTo =
        moveFrom && parentPath
          ? `${parentPath}/${moveFrom.split("/").pop()}`
          : null;
      if (moveFrom && moveTo)
        await mirror({ kind: "move_path", from: moveFrom, to: moveTo });
      return {
        ok: true,
        result: `Moved ${file.name} into ${folder.name}.`,
        action: { kind: "file", name: file.name, operation: "moved" },
      };
    }
    case "delete_file": {
      const file = resolveFile(computer, args.file, { strict: true });
      if (!file)
        return { ok: false, result: fileNotFoundResult(computer, args.file) };
      if (!(await deleteWorkspaceFileForUser(ownerId, file.id)))
        return { ok: false, result: `Could not delete ${file.name}.` };
      const deletedPath = workspaceRelativePathOf(
        folderRows,
        file.name,
        file.folderId ?? null
      );
      if (deletedPath) await mirror({ kind: "delete_file", path: deletedPath });
      return {
        ok: true,
        result: `Deleted ${file.name}.`,
        action: { kind: "file", name: file.name, operation: "deleted" },
      };
    }
    case "create_folder": {
      const name = str(args.name);
      if (!name) return { ok: false, result: "A folder name is required." };
      const parent =
        args.parent !== undefined
          ? resolveFolder(computer, args.parent)
          : undefined;
      if (args.parent !== undefined && !parent)
        return folderNotFound(args.parent, "Parent folder");
      // Same-name siblings created ambiguity the agent cannot see: a later
      // create_file by folder name resolves to whichever folder came first,
      // so a workspace ends up with two same-named folders. Refuse up front.
      if (
        nameTakenAtLevel(
          folderRows,
          name,
          folder => folder.parentId ?? null,
          parent?.id ?? null
        )
      ) {
        return {
          ok: false,
          result: `A folder named ${name} already exists in that location. Use a different name, or work in the existing ${name} folder instead.`,
        };
      }
      const created = await createWorkspaceFolderForUser(ownerId, {
        name,
        parentId: parent?.id ?? null,
      });
      if (!created)
        return {
          ok: false,
          result: `Could not create the folder - ${name} may already exist.`,
        };
      const parentPath = folderPathOf(folderRows, created.parentId ?? null);
      const newFolderPath = parentPath
        ? `${parentPath}/${created.name}`
        : created.name;
      await mirror({ kind: "create_folder", path: newFolderPath });
      return {
        ok: true,
        result: `Created the ${created.name} folder (id ${created.id}).`,
        action: { kind: "folder", name: created.name, operation: "created" },
      };
    }
    case "rename_folder": {
      const folder = resolveFolder(computer, args.folder);
      const newName = str(args.new_name);
      if (!folder) return folderNotFound(args.folder);
      if (!newName)
        return { ok: false, result: "A new folder name is required." };
      const updated = await updateWorkspaceFolderForUser(ownerId, folder.id, {
        name: newName,
      });
      if (!updated)
        return {
          ok: false,
          result: `Could not rename ${folder.name} - ${newName} may already exist.`,
        };
      const folderRenameFrom = folderPathOf(folderRows, folder.id);
      const folderRenameParent = folderPathOf(
        folderRows,
        folder.parentId ?? null
      );
      const folderRenameTo = folderRenameFrom
        ? folderRenameParent
          ? `${folderRenameParent}/${newName}`
          : newName
        : null;
      if (folderRenameFrom && folderRenameTo)
        await mirror({
          kind: "move_path",
          from: folderRenameFrom,
          to: folderRenameTo,
        });
      return {
        ok: true,
        result: `Renamed ${folder.name} to ${updated.name}.`,
        action: { kind: "folder", name: updated.name, operation: "renamed" },
      };
    }
    case "move_folder": {
      const folder = resolveFolder(computer, args.folder);
      const parent = resolveFolder(computer, args.parent);
      if (!folder) return folderNotFound(args.folder);
      if (!parent) return folderNotFound(args.parent, "Parent folder");
      if (folder.id === parent.id)
        return { ok: false, result: "A folder cannot be moved into itself." };
      const updated = await updateWorkspaceFolderForUser(ownerId, folder.id, {
        parentId: parent.id,
      });
      if (!updated)
        return { ok: false, result: `Could not move ${folder.name}.` };
      const folderMoveFrom = folderPathOf(folderRows, folder.id);
      const folderMoveParent = folderPathOf(folderRows, parent.id);
      const folderMoveTo =
        folderMoveFrom && folderMoveParent
          ? `${folderMoveParent}/${folderMoveFrom.split("/").pop()}`
          : null;
      if (folderMoveFrom && folderMoveTo)
        await mirror({
          kind: "move_path",
          from: folderMoveFrom,
          to: folderMoveTo,
        });
      return {
        ok: true,
        result: `Moved ${folder.name} into ${parent.name}.`,
        action: { kind: "folder", name: folder.name, operation: "moved" },
      };
    }
    case "delete_folder": {
      const folder = resolveFolder(computer, args.folder);
      if (!folder) return folderNotFound(args.folder);
      if (!(await deleteWorkspaceFolderForUser(ownerId, folder.id)))
        return { ok: false, result: `Could not delete ${folder.name}.` };
      const removedFolderPath = folderPathOf(folderRows, folder.id);
      if (removedFolderPath)
        await mirror({ kind: "delete_folder", path: removedFolderPath });
      return {
        ok: true,
        result: `Deleted the ${folder.name} folder and its contents.`,
        action: { kind: "folder", name: folder.name, operation: "deleted" },
      };
    }
    case "deploy_website": {
      const directory = str(args.directory);
      if (!directory)
        return {
          ok: false,
          result:
            "You must choose the directory to deploy. Pass '/' for the workspace root, or a workspace folder path like 'my-react-app' or 'my-next-app/out' - the directory whose contents are the site.",
        };
      const deploymentKey = str(args.deployment).trim();
      const description = str(args.description).trim();
      const outcome = await deployWorkspaceSite(
        ownerId,
        directory === "/" ? null : directory,
        {
          deployment: deploymentKey || undefined,
          description: description || undefined,
        }
      );
      if (!outcome.ok)
        return {
          ok: false,
          result: `The website was not deployed: ${outcome.message}`,
          action: { kind: "deployment", name: "", operation: "failed" },
        };
      const fileCount = outcome.deployment.fileCount;
      const fromLine =
        directory === "/" ? "the workspace root" : `/${directory}`;
      return {
        ok: true,
        result: deploymentKey
          ? `Deployment ${outcome.deployment.deploymentKey} is live at ${outcome.deployment.siteUrl} - ${fileCount} file${fileCount === 1 ? "" : "s"} published from ${fromLine}. Its URL never changed: redeploying to the same ID always keeps the same URL.`
          : `A brand-new deployment is live: ID ${outcome.deployment.deploymentKey}, ${outcome.deployment.siteUrl} - ${fileCount} file${fileCount === 1 ? "" : "s"} published from ${fromLine}. Tell the user the URL and the deployment ID - future deploys pass that ID to update this exact deployment, and its description ('${description}') is kept in the deployment registry across chats.`,
        action: {
          kind: "deployment",
          name: outcome.deployment.siteUrl,
          operation: "deployed",
        },
      };
    }
    case "delete_website": {
      const deleteAll = args.all === true;
      const deploymentKey = str(args.deployment).trim();
      const confirmAll = Array.isArray(args.confirm_all)
        ? args.confirm_all.map(key => String(key))
        : undefined;
      const outcome = await deleteWorkspaceSite(ownerId, {
        deployment: deploymentKey || undefined,
        all: deleteAll,
        confirmAll,
      });
      if (!outcome.ok && "confirmationRequired" in outcome) {
        // The sweep gate fired: nothing was deleted. Hand the model the exact
        // target list so it can confirm with the user and re-call bound to it.
        return {
          ok: true,
          result: `Nothing was deleted yet - deleting every deployment is irreversible and needs explicit confirmation. ${outcome.message}`,
          action: {
            kind: "deployment",
            name: outcome.targets.map(t => t.key).join(", "),
            operation: "presented",
          },
        };
      }
      if (!outcome.ok)
        return {
          ok: false,
          result: `No website was deleted: ${outcome.message}`,
          action: { kind: "deployment", name: "", operation: "failed" },
        };
      const listed = outcome.deleted
        .map(entry => `${entry.key} (${entry.siteUrl})`)
        .join(", ");
      const failedNote =
        outcome.failed > 0
          ? ` (${outcome.failed} other deployment${outcome.failed === 1 ? "" : "s"} failed to delete - check the deployment history)`
          : "";
      return {
        ok: true,
        result: `Deleted ${outcome.deleted.length === 1 ? `deployment ${listed}` : `${outcome.deleted.length} deployments: ${listed}`}. The URL${outcome.deleted.length === 1 ? " is" : "s are"} offline and the deletion is irreversible - but every workspace file is untouched, and a new deploy_website creates a fresh deployment with a new ID and URL. Tell the user plainly what went offline.${failedNote}`,
        action: {
          kind: "deployment",
          name: outcome.deleted.map(entry => entry.siteUrl).join(", "),
          operation: "deleted",
        },
      };
    }
    case "create_project_template": {
      const rawName = str(args.name);
      if (!rawName) return { ok: false, result: "A project name is required." };
      // No stack specified: the model decides, but if it omitted the template
      // entirely, scaffold the default stack - a real React project, not a
      // loose HTML file.
      const template =
        str(args.template).trim() === "" ? "react" : args.template;
      if (!isProjectTemplateKey(template))
        return {
          ok: false,
          result: `Unknown template: ${str(args.template)}. Supported templates: ${PROJECT_TEMPLATE_KEYS.join(", ")}.`,
        };
      const projectName = slugifyProjectName(rawName);
      const rendered = renderProjectTemplate(template, rawName);

      // Project folder at the workspace root - reuse it if it already exists.
      const existingProject = computer.folders.find(
        folder =>
          folder.parentId === null &&
          folder.name.toLowerCase() === projectName.toLowerCase()
      );
      // Reusing an existing folder only works when it is empty: the template
      // files would collide with whatever the earlier project left behind
      // (the workspace enforces one file per folder and name), and a raw
      // duplicate-key error helps nobody. Refuse with a message the model
      // can act on: different name, or delete the stale folder first.
      const staleDescendantIds = new Set<number>();
      if (existingProject) {
        // Template files land in nested subfolders (src/, out/), so collect
        // the project root plus every descendant before judging reuse: a
        // stale file anywhere beneath the root would collide with the
        // scaffold, and a same-name subfolder would be duplicated.
        staleDescendantIds.add(existingProject.id);
        let grew = true;
        while (grew) {
          grew = false;
          for (const folder of folderRows) {
            if (
              folder.parentId != null &&
              staleDescendantIds.has(folder.parentId) &&
              !staleDescendantIds.has(folder.id)
            ) {
              staleDescendantIds.add(folder.id);
              grew = true;
            }
          }
        }
      }
      const hasStaleContent =
        existingProject !== undefined &&
        (folderRows.some(
          folder =>
            folder.id !== existingProject.id &&
            staleDescendantIds.has(folder.id)
        ) ||
          computer.files.some(
            file =>
              file.folderId != null && staleDescendantIds.has(file.folderId)
          ));
      if (existingProject && hasStaleContent) {
        return {
          ok: false,
          result:
            `A ${projectName} project folder already exists with files in it from an earlier project, so the ${template} template would collide with them. ` +
            `Scaffold with a different project name instead, or delete the ${projectName} folder first if the old project is no longer needed.`,
        };
      }
      const projectFolder =
        existingProject ??
        (await createWorkspaceFolderForUser(ownerId, {
          name: projectName,
          parentId: null,
        }));
      if (!projectFolder)
        return {
          ok: false,
          result: `Could not create the ${projectName} folder - it may already exist.`,
        };

      // Folder cache: relative path inside the project -> folder id.
      const folderIds = new Map<string, number>([["", projectFolder.id]]);
      const ensureFolder = async (
        relativePath: string
      ): Promise<number | null> => {
        let parentId = projectFolder.id;
        let pathSoFar = "";
        for (const segment of relativePath.split("/")) {
          pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
          const cached = folderIds.get(pathSoFar);
          if (cached) {
            parentId = cached;
            continue;
          }
          const existing = computer.folders.find(
            folder =>
              folder.parentId === parentId &&
              folder.name.toLowerCase() === segment.toLowerCase()
          );
          const folder =
            existing ??
            (await createWorkspaceFolderForUser(ownerId, {
              name: segment,
              parentId,
            }));
          if (!folder) return null;
          folderIds.set(pathSoFar, folder.id);
          parentId = folder.id;
        }
        return parentId;
      };

      const createdPaths: string[] = [];
      for (const file of rendered.files) {
        const lastSlash = file.path.lastIndexOf("/");
        const folderPath =
          lastSlash === -1 ? "" : file.path.slice(0, lastSlash);
        const fileName =
          lastSlash === -1 ? file.path : file.path.slice(lastSlash + 1);
        const folderId = await ensureFolder(folderPath);
        if (folderId === null)
          return {
            ok: false,
            result: `Could not create the folders for ${file.path} in ${projectName}.`,
          };
        const created = await createWorkspaceFileForUser(ownerId, {
          name: fileName,
          content: file.content,
          mimeType: file.mimeType,
          folderId,
        });
        if (!created)
          return {
            ok: false,
            result: `Could not create ${file.path} in the ${projectName} folder - a file with that name may already exist.`,
          };
        createdPaths.push(file.path);
      }

      const deployDirectory =
        rendered.deployRoot === "."
          ? projectName
          : `${projectName}/${rendered.deployRoot}`;
      return {
        ok: true,
        result: `Scaffolded the ${rawName} project (${template} template): ${createdPaths.length} files in the ${projectName} folder - ${createdPaths.join(", ")}. ${rendered.summary} When it is ready to go live, deploy_website with directory: ${deployDirectory}.`,
        action: { kind: "project", name: projectName, operation: "created" },
      };
    }
    case "send_telegram_message": {
      const text = str(args.text);
      if (!text) return { ok: false, result: "Message text is required." };
      const credentials = await getTelegramCredentialsForUser(ownerId);
      if (!credentials?.chatId)
        return {
          ok: false,
          result:
            "Telegram is not connected. Tell the user to connect Telegram in Settings, send /start to their bot, and discover its chat first.",
        };
      const sent = await sendTelegramMessage(
        credentials.token,
        credentials.chatId,
        text
      );
      return {
        ok: true,
        result: `Sent the Telegram message (message #${sent.message_id}).`,
        action: { kind: "telegram", name: text, operation: "sent" },
      };
    }
    case "send_progress_update": {
      const text = str(args.text);
      if (!text)
        return { ok: false, result: "A progress note text is required." };
      if (channel !== "telegram")
        return {
          ok: false,
          result:
            "send_progress_update is only available over Telegram - the web app already shows the user your tool activity live, so just do the work and deliver the result with end_turn.",
        };
      const credentials = await getTelegramCredentialsForUser(ownerId);
      if (!credentials?.chatId)
        return {
          ok: false,
          result:
            "Telegram is not connected. Tell the user to connect Telegram in Settings, send /start to their bot, and discover its chat first.",
        };
      const sent = await sendTelegramMessage(
        credentials.token,
        credentials.chatId,
        text
      );
      return {
        ok: true,
        result: `Sent the progress update (message #${sent.message_id}).`,
        action: { kind: "telegram", name: text, operation: "sent" },
      };
    }
    case "set_communication_style": {
      const style = (str(args.style) ?? "").trim();
      try {
        const saved = await setCommunicationStyleForUser(ownerId, style);
        return {
          ok: true,
          result: saved
            ? `Saved the user's preferred communication style: "${saved}" - follow it in every reply from now on, on every channel and in every chat.`
            : "Cleared the saved communication-style preference - your default style applies from now on.",
        };
      } catch (error) {
        return {
          ok: false,
          result: `Could not save the style preference: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    case "set_personalisation": {
      const input: PersonalisationInput = {};
      if (typeof args.enabled === "boolean") input.enabled = args.enabled;
      if (args.profile !== undefined) input.profile = str(args.profile) || null;
      if (args.tone !== undefined) input.tone = str(args.tone) || null;
      const detail = str(args.detail);
      if (args.detail !== undefined && (detail === "" || PERSONALISATION_DETAILS.includes(detail as PersonalisationDetail)))
        input.detail = detail === "" ? null : (detail as PersonalisationDetail);
      const proactiveness = str(args.proactiveness);
      if (args.proactiveness !== undefined && (proactiveness === "" || PERSONALISATION_PROACTIVENESS.includes(proactiveness as PersonalisationProactiveness)))
        input.proactiveness = proactiveness === "" ? null : (proactiveness as PersonalisationProactiveness);
      const expertise = str(args.expertise);
      if (args.expertise !== undefined && (expertise === "" || PERSONALISATION_EXPERTISE.includes(expertise as PersonalisationExpertise)))
        input.expertise = expertise === "" ? null : (expertise as PersonalisationExpertise);
      if (Object.keys(input).length === 0)
        return {
          ok: false,
          result:
            "No personalisation changes were provided. Pass at least one of enabled, profile, tone, detail, proactiveness or expertise.",
        };
      try {
        const saved = await setPersonalisationForUser(ownerId, input);
        const summary = [
          saved.profile ? `profile: "${saved.profile}"` : null,
          saved.tone ? `tone: ${saved.tone}` : null,
          saved.detail ? `detail: ${saved.detail}` : null,
          saved.proactiveness ? `proactiveness: ${saved.proactiveness}` : null,
          saved.expertise ? `expertise: ${saved.expertise}` : null,
        ].filter(Boolean).join(", ");
        return {
          ok: true,
          result: `Saved the user's personalisation preferences${summary ? ` (${summary})` : ""}.${saved.enabled ? " Personalisation mode is on - keep noticing and saving lasting preferences." : " Personalisation mode is off."}`,
        };
      } catch (error) {
        return {
          ok: false,
          result: `Could not save the personalisation preferences: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    case "present_file": {
      const file = resolveFile(computer, args.file);
      if (!file)
        return { ok: false, result: fileNotFoundResult(computer, args.file) };
      const credentials = await getTelegramCredentialsForUser(ownerId);
      if (!credentials?.chatId)
        return {
          ok: false,
          result:
            "Telegram is not connected. Tell the user to connect Telegram in Settings, send /start to their bot, and discover its chat first.",
        };
      try {
        const presented = await presentTelegramFile(
          credentials.token,
          credentials.chatId,
          {
            name: file.name,
            content: String(file.content ?? ""),
            mimeType: file.mimeType,
          },
          str(args.caption) || undefined
        );
        return {
          ok: true,
          result: `Presented ${file.name} to the user as a ${presented.as} (message #${presented.messageId}) - they can view or download it in the chat.`,
          action: { kind: "file", name: file.name, operation: "presented" },
        };
      } catch (error) {
        return {
          ok: false,
          result: `Could not present ${file.name}: ${error instanceof Error ? error.message : "Telegram rejected the file."}`,
        };
      }
    }
    case "github": {
      const operation = str(args.operation);
      if (!isGithubOperation(operation))
        return {
          ok: false,
          result: `GitHub operation must be one of: ${GITHUB_OPERATIONS.join(", ")}.`,
          action: { kind: "connector", name: "GitHub", operation: "failed" },
        };
      try {
        const execution = await executeGithubOperation(
          ownerId,
          operation,
          args
        );
        const payload = JSON.stringify(execution.data, null, 2);
        const label = operation.replace(/_/g, " ");
        return {
          ok: execution.ok,
          result: execution.ok
            ? `GitHub ${label} succeeded.${payload && payload !== "null" ? `\nResult:\n${payload.slice(0, 4000)}` : ""}`
            : `GitHub ${label} failed: ${execution.error ?? "unknown error"}.`,
          detail: payload?.slice(0, 20_000),
          action: {
            kind: "connector",
            name: `GitHub: ${label}`,
            operation: execution.ok ? "executed" : "failed",
          },
        };
      } catch (error) {
        return {
          ok: false,
          result:
            error instanceof ComposioApiError
              ? error.message
              : `The GitHub request failed: ${str((error as Error)?.message)}.`,
          action: {
            kind: "connector",
            name: `GitHub: ${operation}`,
            operation: "failed",
          },
        };
      }
    }
    case "list_connector_tools": {
      const connector = str(args.connector);
      if (connector !== "gmail")
        return {
          ok: false,
          result:
            "This catalog tool is only for Gmail. Use the github tool for GitHub.",
        };
      const search = str(args.search) || undefined;
      const limitRaw = Number(args.limit);
      const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
      try {
        const { tools } = await listComposioTools(ownerId, connector, {
          search,
          limit,
        });
        if (!tools.length)
          return {
            ok: true,
            result: `No Gmail actions matched "${search ?? ""}". Try a broader search.`,
          };
        const lines = tools
          .map(tool => {
            const params = Object.entries(tool.inputParameters ?? {})
              .map(([name, schema]) => {
                const spec = schema as { type?: string; description?: string };
                return `${name}${spec?.type ? ` (${spec.type})` : ""}: ${spec?.description ?? ""}`;
              })
              .join("; ");
            return `${tool.slug} - ${tool.description}${params ? ` Parameters: ${params}` : ""}`;
          })
          .join("\n");
        return {
          ok: true,
          result: "Gmail actions available:\n" + lines,
          action: {
            kind: "connector",
            name: `${tools.length} Gmail actions`,
            operation: "listed",
          },
        };
      } catch (error) {
        return {
          ok: false,
          result:
            error instanceof ComposioApiError
              ? error.message
              : `The connector catalog is unavailable: ${str((error as Error)?.message)}.`,
        };
      }
    }
    case "use_connector_tool": {
      const connector = str(args.connector);
      const action = str(args.action);
      const params = (args.params ?? {}) as Record<string, unknown>;
      if (connector !== "gmail")
        return {
          ok: false,
          result:
            "This raw action tool is only for Gmail. Use the github tool for GitHub.",
        };
      if (!action) return { ok: false, result: "An action slug is required." };
      try {
        const execution = await executeComposioTool(
          ownerId,
          connector,
          action,
          params
        );
        const payload = JSON.stringify(execution.data, null, 2);
        return {
          ok: execution.ok,
          result: execution.ok
            ? `${connector === "gmail" ? "Gmail" : "GitHub"} action ${action} succeeded.${payload && payload !== "null" ? `\nResult:\n${payload.slice(0, 4000)}` : ""}`
            : `${connector === "gmail" ? "Gmail" : "GitHub"} action ${action} failed: ${execution.error ?? "unknown error"}. Check the parameters with list_connector_tools and retry.`,
          action: { kind: "connector", name: action, operation: "executed" },
        };
      } catch (error) {
        return {
          ok: false,
          result:
            error instanceof ComposioApiError
              ? error.message
              : `The connector request failed: ${str((error as Error)?.message)}.`,
          action: { kind: "connector", name: action, operation: "failed" },
        };
      }
    }
    case "solve_equation": {
      const equation = str(args.equation).trim();
      if (!equation)
        return { ok: false, result: "An equation to solve is required." };
      try {
        const answer = evaluate(equation);
        if (
          answer === undefined ||
          answer === null ||
          (typeof answer === "number" && !Number.isFinite(answer))
        ) {
          const noNumber = `That expression does not evaluate to a number (got: ${String(answer)}). Pass a single numeric expression like '20 - 11.33'.`;
          return {
            ok: false,
            result: noNumber,
            detail: noNumber,
            action: {
              kind: "tool",
              name: equation.slice(0, 60),
              operation: "failed",
            },
          };
        }
        const formatted =
          typeof answer === "number"
            ? formatMathAnswer(answer)
            : String(answer);
        return {
          ok: true,
          result: `${equation} = ${formatted}`,
          detail: `${equation} = ${formatted}`,
          action: {
            kind: "tool",
            name: equation.slice(0, 60),
            operation: "completed",
          },
        };
      } catch (error) {
        const failure = `Could not evaluate '${equation}': ${error instanceof Error ? error.message : "invalid expression"}. Pass a single numeric expression like '20 - 11.33' or 'sqrt(196) * 3.5'.`;
        return {
          ok: false,
          result: failure,
          detail: failure,
          action: {
            kind: "tool",
            name: equation.slice(0, 60),
            operation: "failed",
          },
        };
      }
    }
    case "base44": {
      const operation = str(args.operation);
      if (operation !== "encode" && operation !== "decode")
        return {
          ok: false,
          result: "Base44 operation must be either encode or decode.",
          action: { kind: "tool", name: "base44", operation: "failed" },
        };
      if (typeof args.value !== "string")
        return {
          ok: false,
          result: "A value is required for Base44 encoding or decoding.",
          action: {
            kind: "tool",
            name: `base44 ${operation}`,
            operation: "failed",
          },
        };
      try {
        const value = args.value;
        const result =
          operation === "encode"
            ? encodeBase44Text(value)
            : decodeBase44Text(value);
        return {
          ok: true,
          result,
          detail: result,
          action: {
            kind: "tool",
            name: `base44 ${operation}`,
            operation: "completed",
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "invalid Base44 value";
        return {
          ok: false,
          result: `Base44 ${operation} failed: ${message}.`,
          action: {
            kind: "tool",
            name: `base44 ${operation}`,
            operation: "failed",
          },
        };
      }
    }
    case "research_web": {
      const topic = str(args.topic);
      if (!topic) return { ok: false, result: "A research topic is required." };
      const difficulty = str(args.difficulty) || undefined;
      const instructions = str(args.instructions) || undefined;
      const level =
        difficulty === "deep-lite" || difficulty === "deep-reasoning"
          ? difficulty
          : "deep";
      const startedAt = Date.now();
      // The researcher streams its real process now (sub-search results, the
      // start of report synthesis). The elapsed-time heartbeat only fires
      // when the stream has gone quiet, so the log shows work, not ticking.
      let lastNoteAt = Date.now();
      const note = (detail: string) => {
        lastNoteAt = Date.now();
        onProgress?.(detail);
      };
      const progressTimer = onProgress
        ? setInterval(() => {
            if (Date.now() - lastNoteAt < 25_000) return;
            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            lastNoteAt = Date.now();
            onProgress(`Deep research is still working - ${elapsed}s elapsed…`);
          }, 10000)
        : undefined;
      note(`Deep research is starting its web searches…`);
      try {
        const research = await runResearch(
          topic,
          difficulty,
          instructions,
          note
        );
        const sourcesBlock = research.sources.length
          ? `\n\nAll sources consulted by the researcher:\n${research.sources
              .map(
                (source, index) =>
                  `${index + 1}. ${source.title || source.url} - ${source.url}`
              )
              .join("\n")}`
          : "";
        return {
          ok: true,
          result: research.report + sourcesBlock,
          detail: research.report + sourcesBlock,
          action: {
            kind: "research",
            name: topic.slice(0, 60),
            operation: "completed",
          },
        };
      } catch (error) {
        const message = `Web research failed: ${error instanceof Error ? error.message : "unknown error"}.`;
        return {
          ok: false,
          result: message,
          detail: message,
          action: {
            kind: "research",
            name: topic.slice(0, 60),
            operation: "failed",
          },
        };
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    }
    case "thinker": {
      const question = str(args.question).trim();
      if (!question)
        return { ok: false, result: "A question to think through is required." };
      const context = str(args.context) || undefined;
      const startedAt = Date.now();
      // The thinker works in one long model call; a quiet-stream heartbeat
      // keeps the activity panel honest while it reasons. The elapsed-time
      // note only fires when nothing newer has arrived.
      let lastNoteAt = Date.now();
      const note = (detail: string) => {
        lastNoteAt = Date.now();
        onProgress?.(detail);
      };
      const progressTimer = onProgress
        ? setInterval(() => {
            if (Date.now() - lastNoteAt < 25_000) return;
            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            lastNoteAt = Date.now();
            onProgress(
              `The thinker sub-agent is still reasoning - ${elapsed}s elapsed…`
            );
          }, 10000)
        : undefined;
      note("The thinker sub-agent is reasoning through the question…");
      try {
        const thought = await runThinkerTask(question, context);
        return {
          ok: true,
          result: thought.analysis,
          detail: thought.analysis.slice(0, 16000),
          action: {
            kind: "tool",
            name: `thinker: ${question.slice(0, 45)}`,
            operation: "completed",
          },
        };
      } catch (error) {
        // Config problems (missing key, missing model ID for a custom
        // endpoint) already carry a clean, user-facing explanation.
        const message =
          error instanceof NimConfigError
            ? error.message
            : `The thinker sub-agent failed: ${
                error instanceof Error ? error.message : "unknown error"
              }.`;
        return {
          ok: false,
          result: message,
          detail: message,
          action: {
            kind: "tool",
            name: `thinker: ${question.slice(0, 45)}`,
            operation: "failed",
          },
        };
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    }
    case "accept_own_coding": {
      if (!gate) {
        return {
          ok: false,
          result:
            "There is no pending coding-specialist acceptance question - continue normally.",
        };
      }
      if (gate.specialistDownThisRun) {
        return {
          ok: false,
          result:
            "The coding specialist failed in this same run, so the user has not had a turn to answer yet. " +
            "Tell the user the specialist is down, ask whether to proceed with Nova's own attempt, and end your turn. " +
            "Only call accept_own_coding in a later conversation turn, after the user explicitly accepted.",
          action: {
            kind: "tool",
            name: "accept_own_coding",
            operation: "failed",
          },
        };
      }
      if (!gate.awaitingAcceptance) {
        return {
          ok: false,
          result:
            "There is no pending coding-specialist acceptance question. Only call this tool when the user has just " +
            "explicitly accepted Nova writing the code itself while the specialist is down.",
          action: {
            kind: "tool",
            name: "accept_own_coding",
            operation: "failed",
          },
        };
      }
      gate.awaitingAcceptance = false;
      gate.blocked = false;
      await recordSpecialistAcceptance(ownerId, gate.chatId, "accepted");
      return {
        ok: true,
        result:
          "Recorded: the user accepted Nova writing this code itself without the coding specialist. " +
          "You may proceed with create_file/edit_file for this task, and say plainly that the result is Nova's own work.",
        action: {
          kind: "tool",
          name: "accept_own_coding",
          operation: "completed",
        },
      };
    }
    case "editor": {
      const task = str(args.task).trim();
      if (!task) return { ok: false, result: "A coding task is required." };
      const context = str(args.context) || undefined;
      const language = str(args.language) || undefined;
      const startedAt = Date.now();
      // One coding task, two possible shapes: with a live sandbox the
      // specialist works autonomously (it lists, reads and writes workspace
      // files and runs commands itself, and its writes sync back into the
      // durable store); without one - or when the model lacks function
      // calling - it returns complete code for this agent to place. The
      // specialist streams its own steps; the elapsed-time heartbeat only
      // fires when its stream has gone quiet.
      let lastNoteAt = Date.now();
      const note = (detail: string) => {
        lastNoteAt = Date.now();
        onProgress?.(detail);
      };
      const progressTimer = onProgress
        ? setInterval(() => {
            if (Date.now() - lastNoteAt < 25_000) return;
            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            lastNoteAt = Date.now();
            onProgress(
              `The coding specialist is still working - ${elapsed}s elapsed…`
            );
          }, 10000)
        : undefined;
      note(
        sandbox
          ? "The coding specialist is taking over the task - reading the workspace on its own…"
          : "The coding specialist is reading the task…"
      );
      const specialistError = (error: unknown) => {
        // Config problems already carry a clean, user-facing explanation.
        // Anything else is logged for diagnosis and replaced with a fixed
        // message: raw specialist errors can name internal services or
        // endpoints, and this text is fed back into the chat.
        if (error instanceof NimConfigError) return `${error.message}.`;
        console.error("[Editor] specialist failed:", error);
        return "The coding specialist failed unexpectedly. Please try again shortly.";
      };
      const runSpecialist = (): Promise<CoderOutcome> =>
        sandbox
          ? runAutonomousCoderTask({
              task,
              context,
              language,
              sandbox,
              onProgress: note,
              deadlineAtMs,
              // The specialist's own tool calls stream out as real activity
              // rows, namespaced under this editor call's id so they can
              // never collide across editor invocations in one run. Args are
              // repacked into the same { arguments: json } shape every tool
              // row uses, so the client renders them with its usual labels.
              ...(onSubToolActivity
                ? {
                    onToolActivity: (activity: CoderToolActivity) => {
                      return onSubToolActivity({
                        id: `${call.id}:${activity.id}`,
                        name: activity.name,
                        state: activity.state,
                        args: { arguments: JSON.stringify(activity.args) },
                        ...(activity.summary
                          ? { summary: activity.summary }
                          : {}),
                      });
                    },
                  }
                : {}),
            })
          : runCoderTask(task, context, language, deadlineAtMs).then(
              result => ({ kind: "single", ...result })
            );
      try {
        let outcome: CoderOutcome;
        try {
          outcome = await runSpecialist();
        } catch (error) {
          // A config error is deterministic - no retry helps, and the user
          // must hear exactly which key the operator has to set. Any
          // NimConfigError (missing key, missing model ID for a custom
          // endpoint, refused plaintext transport) is classified by type,
          // not by message text.
          if (error instanceof NimConfigError) throw error;
          const message = error instanceof Error ? error.message : "";
          if (message.includes("not configured")) throw error;
          // Transient specialist failures (timeouts, NIM hiccups) get one
          // automatic retry, so a single blip never pushes the agent into
          // silently hand-writing the code itself. The retry only runs when
          // the remaining budget still covers the wait plus the reserve the
          // specialist needs to start; otherwise it would begin work after
          // the run deadline and be discarded anyway.
          const retryWaitMs = 1500;
          if (
            deadlineAtMs !== undefined &&
            deadlineAtMs - Date.now() - retryWaitMs < 2 * MIN_CALL_RESERVE_MS
          )
            throw error;
          note("The coding specialist hit a snag - retrying once…");
          await new Promise(resolve => setTimeout(resolve, retryWaitMs));
          outcome = await runSpecialist();
        }
        if (outcome.kind === "single") {
          return {
            ok: true,
            result: outcome.code,
            detail: outcome.code.slice(0, 16000),
            action: {
              kind: "tool",
              name: `editor: ${task.slice(0, 45)}`,
              operation: "completed",
            },
          };
        }
        // Autonomous: the specialist's writes are already in the sandbox -
        // sync them into the durable store now so this run's later rounds
        // (and the workspace UI) see the real files. syncAgentSandbox never
        // throws, but a sync that silently failed is not a success story:
        // the claim below is anchored on the files the specialist wrote
        // (authoritative from the loop), and the end-of-run sync is the
        // backstop - so the instruction to read the files back and verify
        // also catches a file the sync missed.
        await syncAgentSandbox(ownerId, computer.workspace.id, sandbox);
        const fileList =
          outcome.writtenPaths.length > 0
            ? outcome.writtenPaths.join(", ")
            : "(none)";
        return {
          ok: true,
          result:
            `The coding specialist worked autonomously in the sandbox. Its summary: ${outcome.summary}\n\n` +
            `Files it wrote: ${fileList}. Read the changed files back from the workspace, verify the work actually meets the task, fix anything it left broken, and present the result to the user. If a changed file is missing from the workspace, say so plainly instead of improvising it.`,
          detail: `${outcome.summary}\n\nFiles written: ${fileList}`.slice(
            0,
            16000
          ),
          action: {
            kind: "tool",
            name: `editor: ${task.slice(0, 45)}`,
            operation: "completed",
          },
        };
      } catch (error) {
        const message = specialistError(error);
        return {
          ok: false,
          result:
            `${message} The specialist is unavailable for this task, so do NOT silently write the code yourself: ` +
            `tell the user exactly that the coding specialist is down, and ask whether to proceed with Nova's own attempt. ` +
            `Non-trivial create_file and edit_file are blocked in this run; only in a LATER conversation turn, once the user has explicitly ` +
            `accepted Nova's own coding, call the accept_own_coding tool to record it, then write the code yourself and say plainly that ` +
            `it is Nova's own work without the specialist, so a broken result never comes as a surprise. ` +
            `Genuinely tiny fixes (a one-line change, a few lines of markup) remain allowed. ` +
            `If the user wants to wait instead, tell them the workspace owner needs to finish setting up the editor.`,
          detail: message,
          specialistDown: true,
          action: {
            kind: "tool",
            name: `editor: ${task.slice(0, 45)}`,
            operation: "failed",
          },
        };
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    }
    case "run_bash": {
      const command = str(args.command);
      if (!command) return { ok: false, result: "A bash command is required." };
      if (!sandbox)
        return {
          ok: false,
          result:
            "The workspace sandbox is not available right now - it either failed to wake or it is not set up on this workspace yet. Use run_vm_task for shell work instead, and tell the user the sandbox needs to be set up first.",
          action: { kind: "vm", name: "bash", operation: "disabled" },
        };
      const bash = await runBashOnSandbox(sandbox, command);
      return {
        ok: bash.ok,
        result: bash.result,
        detail: bash.result.slice(0, 16000),
        action: {
          kind: "vm",
          name: "bash",
          operation: bash.ok ? "completed" : "failed",
        },
      };
    }
    case "browse": {
      const command = str(args.command);
      if (!command)
        return { ok: false, result: "An agent-browser command is required." };
      if (!sandbox)
        return {
          ok: false,
          result:
            "The workspace sandbox is not available right now - it either failed to wake or it is not set up on this workspace yet, and the browser runs inside that sandbox. Tell the user the sandbox needs to be set up first.",
          action: { kind: "browser", name: "browser", operation: "disabled" },
        };
      const browse = await runBrowserCommand(sandbox, command);
      return {
        ok: browse.ok,
        result: browse.result,
        detail: browse.result.slice(0, 16000),
        action: {
          kind: "browser",
          name:
            command
              .trim()
              .replace(/^agent-browser\s+/, "")
              .split(/\s+/)[0]
              .slice(0, 45) || "browser",
          operation: browse.ok ? "completed" : "failed",
        },
      };
    }
    case "run_vm_task": {
      const task = str(args.task);
      if (!task) return { ok: false, result: "A task is required." };
      const started = await startAgentVmRun(
        ownerId,
        {
          task,
          code: str(args.code) || undefined,
          chatId,
        },
        // The sandbox already woke with this run and its files are current,
        // so a mid-run restore (which wipes and re-uploads the workspace,
        // losing bash-created files) must not run again.
        { skipRestore: Boolean(sandbox) }
      );
      if (!started.configured)
        return {
          ok: false,
          result: started.message,
          action: { kind: "vm", name: "E2B", operation: "disabled" },
        };
      return {
        ok: true,
        result: started.message,
        action: {
          kind: "vm",
          name: `run #${started.run?.id ?? ""}`,
          operation: "completed",
        },
      };
    }
    default:
      return { ok: false, result: `Unknown tool: ${call.name}.` };
  }
}
