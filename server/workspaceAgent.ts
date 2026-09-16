import { NVIDIA_UNAVAILABLE_MESSAGE } from "@shared/const";
import { runResearch } from "./researcher";
import { getDatabaseTime, hasAgentStopAfter } from "./db";
import { startAgentVmRun } from "./agentVm";
import {
  appendChatMessageForUser,
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  deleteWorkspaceFileForUser,
  deleteWorkspaceFolderForUser,
  getChatForUser,
  getTelegramCredentialsForUser,
  getUserIdentityForUser,
  getWorkspaceComputer,
  listChatMessagesForUser,
  renameChatIfDefaultForUser,
  updateWorkspaceFileForUser,
  updateWorkspaceFolderForUser,
} from "./db";
import {
  chatWithNvidiaGateway,
  completeWithNvidiaGateway,
  getNvidiaGatewayStatus,
  type GatewayChatMessage,
  type GatewayToolCall,
  type GatewayToolDefinition,
  NvidiaGatewayClientError,
} from "./nvidiaGateway";
import { sendTelegramMessage } from "./telegram";
import { COMPOSIO_TOOLKITS, type ComposioToolkit, ComposioApiError, executeComposioTool, getComposioConnectionStatus, isComposioToolkit, listComposioTools } from "./composio";

export type AgentAction = {
  kind: "folder" | "file" | "telegram" | "vm" | "connector" | "research";
  name: string;
  operation?:
    | "created"
    | "updated"
    | "renamed"
    | "moved"
    | "deleted"
    | "sent"
    | "completed"
    | "disabled"
    | "listed"
    | "executed"
    | "failed";
};

export type WorkspaceToolActivity = {
  id: string;
  name: string;
  state: "running" | "completed" | "failed";
  args: Record<string, string>;
  summary?: string;
  /** Live progress note while running, or the full tool response once done. */
  detail?: string;
};

/** Run-progress events: live tool activity plus round milestones and blockers. */
export type WorkspaceAgentEvent =
  | { type: "tool"; tool: WorkspaceToolActivity }
  | { type: "round_started"; round: number; toolNames: string[] }
  | { type: "blocker"; toolName: string; toolResult: string }
  | { type: "round_completed"; round: number; toolNames: string[]; failedToolNames: string[] };

type WorkspaceAgentOptions = {
  onEvent?: (event: WorkspaceAgentEvent) => void | Promise<void>;
  onChunk?: (chunk: string) => void | Promise<void>;
};

export const TOOL_ACTIVITY_MESSAGE_PREFIX = "__nova_tool_activity__:";

const DEFAULT_CHAT_TITLES = new Set([
  "New workspace conversation",
  "New conversation",
  "Telegram Chat",
]);

/** Generates a concise title for a chat based on its first user and assistant messages, but only when the title is still a default placeholder. */
export async function autoTitleChatForUser(
  ownerId: number,
  chatId: number
): Promise<void> {
  try {
    const chat = await getChatForUser(ownerId, chatId);
    if (!chat || !DEFAULT_CHAT_TITLES.has(chat.title)) return;
    const messages = await listChatMessagesForUser(ownerId, chatId);
    const firstUser = messages?.find(m => m.role === "user");
    const firstAssistant = messages?.find(
      m =>
        m.role === "assistant" &&
        !m.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX)
    );
    if (!firstUser || !firstAssistant) return;
    const prompt = [
      "Generate a concise 3-6 word title for this conversation. Reply with the title only — no quotes, no trailing punctuation.",
      firstUser.content,
      firstAssistant.content,
    ].join("\n");
    const result = await completeWithNvidiaGateway(
      ownerId,
      prompt.slice(0, 2000)
    );
    const raw = String(result.text ?? "")
      .trim()
      .split("\n")[0]
      .replace(/^["']+|["']+$/g, "")
      .trim()
      .slice(0, 60);
    if (raw)
      await renameChatIfDefaultForUser(
        ownerId,
        chatId,
        raw,
        Array.from(DEFAULT_CHAT_TITLES)
      );
  } catch (error) {
    console.error("[Chat title] auto-title failed", error);
  }
}

/** Tool schemas exposed to the model on every message. */
const WORKSPACE_TOOLS: GatewayToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_workspace",
      description:
        "List the current folders and files in the user's private workspace, with their ids and locations.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description:
        "Create a new file in the user's private workspace with the given name and content.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "File name including its extension, e.g. notes.txt",
          },
          content: {
            type: "string",
            description: "Full text content to store in the file.",
          },
          folder: {
            type: "string",
            description:
              "Optional existing folder name or id to place the file in. Omit for the workspace root.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full text content of an existing workspace file.",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description: "File name or id to read.",
          },
        },
        required: ["file"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace the entire content of an existing workspace file. Read the file first when unsure about its current content.",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description: "File name or id to edit.",
          },
          content: {
            type: "string",
            description: "The new full content for the file.",
          },
        },
        required: ["file", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_file",
      description: "Rename an existing workspace file.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "File name or id to rename." },
          new_name: {
            type: "string",
            description: "The new file name, including its extension.",
          },
        },
        required: ["file", "new_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_file",
      description: "Move an existing workspace file into a folder.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "File name or id to move." },
          folder: {
            type: "string",
            description: "Target folder name or id.",
          },
        },
        required: ["file", "folder"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file from the user's private workspace.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "File name or id to delete." },
        },
        required: ["file"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_folder",
      description: "Create a new folder in the user's private workspace.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Folder name." },
          parent: {
            type: "string",
            description:
              "Optional existing parent folder name or id. Omit for the workspace root.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_folder",
      description: "Rename an existing workspace folder.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Folder name or id to rename.",
          },
          new_name: { type: "string", description: "The new folder name." },
        },
        required: ["folder", "new_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_folder",
      description: "Move an existing workspace folder into another folder.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Folder name or id to move." },
          parent: {
            type: "string",
            description: "Target parent folder name or id.",
          },
        },
        required: ["folder", "parent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_folder",
      description:
        "Delete a folder and everything inside it from the user's private workspace.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Folder name or id to delete.",
          },
        },
        required: ["folder"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_telegram_message",
      description:
        "Send a text message to the user's linked Telegram chat. Requires Telegram to be connected.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message text to send." },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_connector_tools",
      description:
        "Search a connector catalog (GitHub or Gmail) and get the exact action slugs with their parameter schemas. Use this whenever you are unsure which action exists or what parameters it takes — never guess a slug or a parameter name, look it up here first. Requires the connector to be connected (Settings).",
      parameters: {
        type: "object",
        properties: {
          connector: { type: "string", enum: ["github", "gmail"], description: "Which connector's catalog to search." },
          search: { type: "string", description: "Optional words to filter actions, e.g. 'create issue' or 'send email'." },
          limit: { type: "number", description: "Max actions to return, 1-50 (default 25)." },
        },
        required: ["connector"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "use_connector_tool",
      description:
        "Execute a GitHub or Gmail action on the user's behalf through the connector — e.g. list or star repositories, create issues, open pull requests; search, send or reply to Gmail; draft and manage emails. The action slug must come from list_connector_tools with exactly the parameters it declares. Requires the connector to be connected (Settings).",
      parameters: {
        type: "object",
        properties: {
          connector: { type: "string", enum: ["github", "gmail"], description: "Which connector to run the action through." },
          action: { type: "string", description: "The exact action slug, e.g. GITHUB_CREATE_AN_ISSUE or GMAIL_SEND_EMAIL." },
          params: { type: "object", description: "The action's parameters as a JSON object, exactly as listed by list_connector_tools." },
        },
        required: ["connector", "action", "params"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_web",
      description:
        "Delegate deep research to Exa AI's deep research models. The chosen model fans out live web searches, reads and cross-checks the sources, and returns a research report with inline citations and a numbered source list. Use it for anything current or factual you do not know for certain. You MUST choose the difficulty yourself on every single call, estimating how deep the research needs to be before calling — never omit it, never default lazily. Say nothing about the choice unless asked.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The topic or question to research.",
          },
          difficulty: {
            type: "string",
            enum: ["deep-lite", "deep", "deep-reasoning"],
            description: "The research depth you estimate this question needs — decide deliberately every call. deep-lite (~10 seconds): a single factual lookup with one clear answer — current versions, prices, release dates, simple facts, definitions. deep: questions needing multiple searches or several sources synthesized — comparisons, how things work, market overviews, current events with context, anything with 2-3 facets. deep-reasoning: the deepest level — complex investigations with many facets, conflicting or hard-to-find evidence, technical analysis, forecasts, or multi-hop questions where the answer depends on other answers. Calibrate: most questions land on deep; only unambiguous single-fact lookups justify deep-lite; escalate to deep-reasoning when evidence conflicts or the question has 4+ facets.",
          },
          instructions: {
            type: "string",
            description: "Optional focus, constraints or specific questions the research should answer.",
          },
        },
        required: ["topic", "difficulty"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_vm_task",
      description:
        "Run a Python 3 script in an isolated E2B sandbox VM with internet access and a 240-second limit. This is the tool for real execution: installing and using packages (pip install, e.g. requests), scraping or browsing with HTTP libraries, processing data, or running shell commands via subprocess.run(['cmd','arg'], capture_output=True, text=True). It is NOT for workspace file management — use create_file / edit_file / read_file and the other dedicated tools for that; they are faster, safer, and sync instantly. Only reach for the VM when code actually needs to run. Always write complete Python code in `code` — `task` is just a short label for the run. The script sees the workspace's files under /home/user/workspace/input (each mounted with an id prefix, e.g. input/104-calc.py — the exact mounted paths are returned with every run result, so do not guess them) and should print() anything you want to report; workspace files changed or created during the run are synced back automatically.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Short label for the run (max ~80 chars).",
          },
          code: {
            type: "string",
            description:
              "The complete Python 3 script to execute in the sandbox VM. Use print() to output results.",
          },
        },
        required: ["task", "code"],
      },
    },
  },
];

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
  return computer.folders.find(
    folder =>
      (numeric !== undefined && folder.id === numeric) ||
      folder.name.toLowerCase() === key.toLowerCase()
  );
}

function resolveFile(computer: Computer, ref: unknown): FileRow | undefined {
  if (typeof ref !== "string" || !ref.trim()) return undefined;
  const key = ref.trim();
  const numeric = /^\d+$/.test(key) ? Number(key) : undefined;
  return computer.files.find(
    file =>
      (numeric !== undefined && file.id === numeric) ||
      file.name.toLowerCase() === key.toLowerCase()
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

const CONNECTOR_TOOL_NAMES = new Set(["list_connector_tools", "use_connector_tool"]);

/** Resolves which connector toolkits the user has actually connected. Failures degrade to "not connected". */
export async function getConnectedConnectorToolkits(
  ownerId: number,
  statusCheck: (ownerId: number, toolkit: ComposioToolkit) => Promise<{ connected: boolean }> = getComposioConnectionStatus
): Promise<ComposioToolkit[]> {
  try {
    const results = await Promise.all(
      COMPOSIO_TOOLKITS.map(async toolkit => ({
        toolkit,
        status: await statusCheck(ownerId, toolkit),
      }))
    );
    return results.filter(entry => entry.status.connected).map(entry => entry.toolkit);
  } catch {
    return [];
  }
}

/** Builds the model tool list: connector tools are exposed only for connected toolkits. */
export function workspaceToolsForConnectors(
  connected: ComposioToolkit[]
): GatewayToolDefinition[] {
  const nonConnector = WORKSPACE_TOOLS.filter(tool => !CONNECTOR_TOOL_NAMES.has(tool.function.name));
  if (!connected.length) return nonConnector;
  const connectorTools = WORKSPACE_TOOLS.filter(tool => CONNECTOR_TOOL_NAMES.has(tool.function.name)).map(tool => {
    const parameters = (tool.function.parameters ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: {
          ...parameters,
          properties: {
            ...parameters.properties,
            connector: {
              type: "string",
              enum: connected,
              description: `Which connector to use. Connected: ${connected.join(", ")}.`,
            },
          },
        },
      },
    };
  });
  return [...nonConnector, ...connectorTools];
}

/** Human-readable connector status line for the system prompt. */
export function connectorStatusLine(connected: ComposioToolkit[]): string {
  if (!connected.length)
    return "no connectors are connected right now, so connector tools are unavailable";
  const parts = COMPOSIO_TOOLKITS.map(toolkit =>
    `${toolkit === "github" ? "GitHub" : "Gmail"} ${connected.includes(toolkit) ? "is connected" : "is not connected"}`
  );
  return `${parts.join("; ")}. Only ${connected.map(toolkit => (toolkit === "github" ? "GitHub" : "Gmail")).join(" and ")} tools are available`;
}

const WORKSPACE_AGENT_PROMPT = `You are Nova, a fully autonomous operator of a private computer workspace. You do not wait to be told how — you decide how, then act.

Operating principles:
- Act first. When the user states a goal, complete it end-to-end in this turn: plan internally, call every tool the goal requires, verify the result, then report. Never reply with only a plan, instructions, or a question when tools could get the work done right now.
- Chain tools freely. Multi-step work is the norm: create folders before files, read before editing, verify after writing. Do not pause between steps to narrate or ask permission — the user sees your tool activity as it runs.
- Prefer dedicated tools. For workspace operations always use the purpose-built tool: create_file, edit_file, read_file, move_file, rename_file, delete_file, create_folder, and friends. Never fall back to the VM (shell, subprocess, echo, sed, heredocs) for work a dedicated tool can do — dedicated tools are instant, auditable, and sync to the workspace automatically. Reserve run_vm_task for genuine computation: running code, installing packages, network requests, data processing, browser automation. When a VM run does produce files you want to keep, copy them into the workspace with dedicated tools afterwards.
- Research before you guess. Use research_web to delegate anything current or factual you do not know for certain — it returns a full, cited research report from Exa AI's deep research models. Before every call, estimate how deep the research needs to be and pass that difficulty explicitly: deep-lite for single-fact lookups, deep for most questions, deep-reasoning for complex investigations with conflicting or multi-faceted evidence. Be deliberate — under-researching gives wrong answers, over-researching wastes the user's time. Use its findings, and cite the source URLs it provides for facts that came from them. Cited research beats a confident-sounding wrong answer.
- Use connectors for outside services: GitHub for repositories, issues and pull requests; Gmail for reading, sending and replying to email. Connector tools are only available for services that are connected — current connections: {{connectors}}. When a service is not connected, do not attempt its connector tools; tell the user to open Settings and connect it first. When it is connected, search the exact action slug and its parameters with list_connector_tools (never guess them), then execute with use_connector_tool.
- Choose your collaboration level deliberately. Default to fully autonomous for routine, reversible work: pick sensible defaults (names, structure, wording, formatting), act end-to-end, and state each choice in one line. Switch to collaborative — pause and ask one focused question — when guessing has a real cost: irreversible or destructive actions beyond the literal request, personal taste you cannot know (like the wording of a message to someone else or creative direction), missing credentials or permissions only the user can provide, or no reasonable interpretation at all. Never ask permission for steps you can safely undo; never improvise steps you cannot.
- Recover on your own. If a tool call fails or a name is missing, adapt: list the workspace, try an alternative, fix the input, and continue. Only surface failure after you have genuinely tried alternatives. When something is impossible with the tools available, say exactly what you would need to do it.
- Verify your work. After creating or editing, read back or otherwise confirm the outcome before claiming success.
- Report briefly. End multi-step work with a short summary of what changed (files created/edited/moved/deleted, messages sent, tasks run) — not a play-by-play.

Formatting: render replies in Markdown when it helps readability — **bold** or *italics* for emphasis, \`inline code\` for identifiers, fenced \`\`\` code blocks with a language tag, and bullet or numbered lists for steps. Keep formatting light in casual replies.

Workspace rules:
- Resolve files and folders by the exact names/ids listed below; if something is missing, list the workspace and act on what exists instead of guessing.
- edit_file replaces the file's entire content — read it first when unsure.
- Keep tool arguments exact and minimal.
- Never claim anything was created, edited, moved, deleted, or sent unless the tool results confirm it.
- Never expose secrets, tokens, credentials, or private data. Match the user's language when practical.

The user you are helping: {{user}}. Address them by that name or username naturally, and keep personalising your replies to them.

Current folders: {{folders}}
Current files: {{files}}`;

type ToolExecution = {
  ok: boolean;
  result: string;
  action?: AgentAction;
  /** Full raw response surfaced in the research dropdown in the UI. */
  detail?: string;
};

/** Executes a single model-requested tool call against the workspace. */
async function executeWorkspaceTool(
  ownerId: number,
  computer: Computer,
  call: GatewayToolCall,
  onProgress?: (detail: string) => void
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
  switch (call.name) {
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
      const folder =
        args.folder !== undefined
          ? resolveFolder(computer, args.folder)
          : undefined;
      if (args.folder !== undefined && !folder)
        return { ok: false, result: `Folder not found: ${str(args.folder)}.` };
      const created = await createWorkspaceFileForUser(ownerId, {
        name,
        content: str(args.content),
        folderId: folder?.id ?? null,
      });
      if (!created)
        return {
          ok: false,
          result: `Could not create the file — a file named ${name} may already exist.`,
        };
      return {
        ok: true,
        result: `Created ${created.name} (id ${created.id}).`,
        action: { kind: "file", name: created.name, operation: "created" },
      };
    }
    case "read_file": {
      const file = resolveFile(computer, args.file);
      if (!file)
        return { ok: false, result: `File not found: ${str(args.file)}.` };
      return {
        ok: true,
        result: `Content of ${file.name} (id ${file.id}):\n${String(file.content ?? "").slice(0, 20000)}`,
      };
    }
    case "edit_file": {
      const file = resolveFile(computer, args.file);
      if (!file)
        return { ok: false, result: `File not found: ${str(args.file)}.` };
      const content = typeof args.content === "string" ? args.content : "";
      const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
        content,
      });
      if (!updated)
        return { ok: false, result: `Could not edit ${file.name}.` };
      return {
        ok: true,
        result: `Updated ${file.name} (id ${file.id}).`,
        action: { kind: "file", name: file.name, operation: "updated" },
      };
    }
    case "rename_file": {
      const file = resolveFile(computer, args.file);
      const newName = str(args.new_name);
      if (!file)
        return { ok: false, result: `File not found: ${str(args.file)}.` };
      if (!newName)
        return { ok: false, result: "A new file name is required." };
      const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
        name: newName,
      });
      if (!updated)
        return {
          ok: false,
          result: `Could not rename ${file.name} — ${newName} may already exist.`,
        };
      return {
        ok: true,
        result: `Renamed ${file.name} to ${updated.name}.`,
        action: { kind: "file", name: updated.name, operation: "renamed" },
      };
    }
    case "move_file": {
      const file = resolveFile(computer, args.file);
      const folder = resolveFolder(computer, args.folder);
      if (!file)
        return { ok: false, result: `File not found: ${str(args.file)}.` };
      if (!folder)
        return { ok: false, result: `Folder not found: ${str(args.folder)}.` };
      const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
        folderId: folder.id,
      });
      if (!updated)
        return { ok: false, result: `Could not move ${file.name}.` };
      return {
        ok: true,
        result: `Moved ${file.name} into ${folder.name}.`,
        action: { kind: "file", name: file.name, operation: "moved" },
      };
    }
    case "delete_file": {
      const file = resolveFile(computer, args.file);
      if (!file)
        return { ok: false, result: `File not found: ${str(args.file)}.` };
      if (!(await deleteWorkspaceFileForUser(ownerId, file.id)))
        return { ok: false, result: `Could not delete ${file.name}.` };
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
        return {
          ok: false,
          result: `Parent folder not found: ${str(args.parent)}.`,
        };
      const created = await createWorkspaceFolderForUser(ownerId, {
        name,
        parentId: parent?.id ?? null,
      });
      if (!created)
        return {
          ok: false,
          result: `Could not create the folder — ${name} may already exist.`,
        };
      return {
        ok: true,
        result: `Created the ${created.name} folder (id ${created.id}).`,
        action: { kind: "folder", name: created.name, operation: "created" },
      };
    }
    case "rename_folder": {
      const folder = resolveFolder(computer, args.folder);
      const newName = str(args.new_name);
      if (!folder)
        return { ok: false, result: `Folder not found: ${str(args.folder)}.` };
      if (!newName)
        return { ok: false, result: "A new folder name is required." };
      const updated = await updateWorkspaceFolderForUser(ownerId, folder.id, {
        name: newName,
      });
      if (!updated)
        return {
          ok: false,
          result: `Could not rename ${folder.name} — ${newName} may already exist.`,
        };
      return {
        ok: true,
        result: `Renamed ${folder.name} to ${updated.name}.`,
        action: { kind: "folder", name: updated.name, operation: "renamed" },
      };
    }
    case "move_folder": {
      const folder = resolveFolder(computer, args.folder);
      const parent = resolveFolder(computer, args.parent);
      if (!folder)
        return { ok: false, result: `Folder not found: ${str(args.folder)}.` };
      if (!parent)
        return {
          ok: false,
          result: `Parent folder not found: ${str(args.parent)}.`,
        };
      if (folder.id === parent.id)
        return { ok: false, result: "A folder cannot be moved into itself." };
      const updated = await updateWorkspaceFolderForUser(ownerId, folder.id, {
        parentId: parent.id,
      });
      if (!updated)
        return { ok: false, result: `Could not move ${folder.name}.` };
      return {
        ok: true,
        result: `Moved ${folder.name} into ${parent.name}.`,
        action: { kind: "folder", name: folder.name, operation: "moved" },
      };
    }
    case "delete_folder": {
      const folder = resolveFolder(computer, args.folder);
      if (!folder)
        return { ok: false, result: `Folder not found: ${str(args.folder)}.` };
      if (!(await deleteWorkspaceFolderForUser(ownerId, folder.id)))
        return { ok: false, result: `Could not delete ${folder.name}.` };
      return {
        ok: true,
        result: `Deleted the ${folder.name} folder and its contents.`,
        action: { kind: "folder", name: folder.name, operation: "deleted" },
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
    case "list_connector_tools": {
      const connector = str(args.connector);
      if (!isComposioToolkit(connector))
        return { ok: false, result: "connector must be 'github' or 'gmail'." };
      const search = str(args.search) || undefined;
      const limitRaw = Number(args.limit);
      const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
      try {
        const { tools } = await listComposioTools(ownerId, connector, { search, limit });
        if (!tools.length)
          return { ok: true, result: `No GitHub actions matched "${search ?? ""}". Try a broader search.` };
        const lines = tools
          .map(tool => {
            const params = Object.entries(tool.inputParameters ?? {})
              .map(([name, schema]) => {
                const spec = schema as { type?: string; description?: string };
                return `${name}${spec?.type ? ` (${spec.type})` : ""}: ${spec?.description ?? ""}`;
              })
              .join("; ");
            return `${tool.slug} — ${tool.description}${params ? ` Parameters: ${params}` : ""}`;
          })
          .join("\n");
        return {
          ok: true,
          result: `${connector === "gmail" ? "Gmail" : "GitHub"} actions available:\n${lines}`,
          action: { kind: "connector", name: `${tools.length} GitHub actions`, operation: "listed" },
        };
      } catch (error) {
        return {
          ok: false,
          result: error instanceof ComposioApiError ? error.message : `The connector catalog is unavailable: ${str((error as Error)?.message)}.`,
        };
      }
    }
    case "use_connector_tool": {
      const connector = str(args.connector);
      const action = str(args.action);
      const params = (args.params ?? {}) as Record<string, unknown>;
      if (!isComposioToolkit(connector))
        return { ok: false, result: "connector must be 'github' or 'gmail'." };
      if (!action) return { ok: false, result: "An action slug is required." };
      try {
        const execution = await executeComposioTool(ownerId, connector, action, params);
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
          result: error instanceof ComposioApiError ? error.message : `The connector request failed: ${str((error as Error)?.message)}.`,
          action: { kind: "connector", name: action, operation: "failed" },
        };
      }
    }
    case "research_web": {
      const topic = str(args.topic);
      if (!topic) return { ok: false, result: "A research topic is required." };
      const difficulty = str(args.difficulty) || undefined;
      const instructions = str(args.instructions) || undefined;
      const level = difficulty === "deep-lite" || difficulty === "deep-reasoning" ? difficulty : "deep";
      const startedAt = Date.now();
      // Exa's deep research is a single long HTTP call, so the live progress
      // stream reports elapsed time while the researcher works.
      const progressTimer = onProgress
        ? setInterval(() => {
            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            onProgress(`Exa deep research (${level}) is reading the live web — ${elapsed}s elapsed…`);
          }, 10000)
        : undefined;
      if (onProgress)
        onProgress(`Exa deep research (${level}) is starting its web searches…`);
      try {
        const research = await runResearch(topic, difficulty, instructions);
        const sourcesBlock = research.sources.length
          ? `\n\nAll sources consulted by the researcher:\n${research.sources
              .map((source, index) => `${index + 1}. ${source.title || source.url} — ${source.url}`)
              .join("\n")}`
          : "";
        return {
          ok: true,
          result: research.report + sourcesBlock,
          detail: research.report + sourcesBlock,
          action: { kind: "research", name: topic.slice(0, 60), operation: "completed" },
        };
      } catch (error) {
        const message = `Web research failed: ${error instanceof Error ? error.message : "unknown error"}.`;
        return {
          ok: false,
          result: message,
          detail: message,
          action: { kind: "research", name: topic.slice(0, 60), operation: "failed" },
        };
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    }
    case "run_vm_task": {
      const task = str(args.task);
      if (!task) return { ok: false, result: "A task is required." };
      const started = await startAgentVmRun(ownerId, {
        task,
        code: str(args.code) || undefined,
      });
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

function toolSummary(call: GatewayToolCall, execution: ToolExecution) {
  const action = execution.action;
  if (!action) return call.name;
  if (action.kind === "research")
    return `${action.operation === "failed" ? "Failed researching" : "Researched"}: ${action.name}.`;
  if (action.kind === "connector")
    return action.operation === "listed"
      ? `Listed ${action.name}.`
      : `${action.operation === "failed" ? "Failed running" : "Ran"} GitHub action: ${action.name}.`;
  return `${action.operation === "deleted" ? "Delet" : action.operation === "updated" ? "Updat" : "Creat"}ed ${action.kind}: ${action.name}.`;
}

/** Transient gateway failures worth one automatic in-run retry. */
const GATEWAY_RETRY_KINDS = new Set(["unavailable", "invalid_response"]);
let gatewayRetryDelaysMs: number[] = [400, 1200, 5000];

/** Test hook: zero the retry backoff so suites stay fast. */
export function setGatewayRetryDelaysForTests(delays: number[]) {
  gatewayRetryDelaysMs = delays;
}

const waitFor = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calls the gateway with automatic retries for transient failures (network
 * blips, 5xx, empty completions). A round that already streamed text to the
 * client is never retried: a fresh attempt would duplicate what the user saw.
 */
async function chatWithGatewayRetry(
  ownerId: number,
  messages: GatewayChatMessage[],
  options: { tools?: GatewayToolDefinition[]; onChunk?: (chunk: string) => void }
) {
  const maxAttempts = gatewayRetryDelaysMs.length + 1;
  for (let attempt = 0; ; attempt += 1) {
    let streamedChars = 0;
    const emit = options.onChunk;
    try {
      return await chatWithNvidiaGateway(ownerId, messages, {
        tools: options.tools,
        ...(emit
          ? {
              onChunk: (chunk: string) => {
                streamedChars += chunk.length;
                emit(chunk);
              },
            }
          : {}),
      });
    } catch (error) {
      const retryable =
        error instanceof NvidiaGatewayClientError &&
        GATEWAY_RETRY_KINDS.has(error.kind);
      if (
        streamedChars > 0 ||
        !retryable ||
        attempt >= maxAttempts - 1
      ) {
        throw error;
      }
      await waitFor(gatewayRetryDelaysMs[attempt]);
    }
  }
}

/**
 * Runs the workspace agent for a message: a tool-calling loop over the NVIDIA
 * gateway. Every message goes through the model with workspace tools
 * (create/read/edit/rename/move/delete files and folders, Telegram, VM runs);
 * the loop executes requested tools and continues until the model produces a
 * final text reply (or the round cap is hit).
 */
export async function runWorkspaceAgent(
  ownerId: number,
  chatId: number,
  content: string,
  options: WorkspaceAgentOptions = {}
) {
  const emitTool = async (tool: WorkspaceToolActivity) => {
    try {
      await options.onEvent?.({ type: "tool", tool });
    } catch {}

    // Persist every state (including "running") so a conversation opened in
    // the web app can show the task as it happens; the client renders the
    // latest row per activity id.
    try {
      await appendChatMessageForUser(ownerId, {
        chatId,
        role: "assistant",
        content: `${TOOL_ACTIVITY_MESSAGE_PREFIX}${JSON.stringify(tool)}`,
      });
    } catch (error) {
      console.error("[Tool activity] failed to persist", error);
    }
  };
  /** Emits a run-progress event; delivery problems must never break the run. */
  const emit = (event: WorkspaceAgentEvent) => {
    try {
      const delivered = options.onEvent?.(event);
      if (delivered instanceof Promise) delivered.catch(() => {});
    } catch {}
  };

  /** Appends the assistant's reply to the chat and returns the persisted message. */
  const persistAssistant = async (reply: string) =>
    appendChatMessageForUser(ownerId, {
      chatId,
      role: "assistant",
      content: reply,
    });

  const actions: AgentAction[] = [];
  // Everything streamed to the client during this run — needed by the catch
  // below to keep the partial reply when the gateway fails mid-run.
  let streamedRunText = "";

  await appendChatMessageForUser(ownerId, { chatId, role: "user", content });

  try {
    const status = await getNvidiaGatewayStatus(ownerId);
    if (!status.configured) {
      const reply =
        "NVIDIA inference is not configured. An administrator must set up the server-only gateway connection before chat is available.";
      await options.onChunk?.(reply);
      const message = await persistAssistant(reply);
      return { message, actions: [] };
    }
    if (
      !status.reachable ||
      (status.providerConfigurationKnown && !status.providerConfigured)
    ) {
      const reply =
        "NVIDIA inference gateway is temporarily unreachable. Please try again shortly.";
      await options.onChunk?.(reply);
      const message = await persistAssistant(reply);
      return { message, actions: [] };
    }
    if (status.allowance.exhausted) {
      const reply = `NVIDIA inference request allowance is exhausted (${status.allowance.usedRequests}/${status.allowance.maxRequests} requests used). Please try again later or contact an administrator to raise the cap.`;
      await options.onChunk?.(reply);
      const message = await persistAssistant(reply);
      return { message, actions: [] };
    }

    let computer = await getWorkspaceComputer(ownerId);
    const connectedConnectors = await getConnectedConnectorToolkits(ownerId);
    const identity = await getUserIdentityForUser(ownerId);
    const userLine = identity.username
      ? `@${identity.username}${identity.name ? ` (${identity.name})` : ""}`
      : identity.name || identity.email || "the user";
    const agentTools = workspaceToolsForConnectors(connectedConnectors);
    const systemMessage = (): GatewayChatMessage => {
      const { folders, files } = describeWorkspace(computer);
      return {
        role: "system",
        content: WORKSPACE_AGENT_PROMPT.replace("{{folders}}", folders).replace(
          "{{files}}",
          files
        ).replace("{{connectors}}", connectorStatusLine(connectedConnectors))
          .replace("{{user}}", userLine),
      };
    };

    const messages: GatewayChatMessage[] = [
      systemMessage(),
      { role: "user", content },
    ];

    // /stop support: a stop request recorded after the run started aborts the
    // run at the next safe point (round boundary or between tool calls).
    const runStartedAt = await getDatabaseTime();
    const stopRun = async () => {
      const stoppedReply = "⏹️ Stopped — this run was cancelled with /stop.";
      await options.onChunk?.(stoppedReply);
      const message = await persistAssistant(stoppedReply);
      return { message, actions: [] };
    };

    let reply = "";
    let streamedReplyChars = 0;
    for (let round = 0; ; round += 1) {
      if (round > 0 && (await hasAgentStopAfter(ownerId, runStartedAt))) return stopRun();
      let streamedThisRound = 0;
      const emitChunk = options.onChunk
        ? (chunk: string) => {
            streamedThisRound += chunk.length;
            streamedRunText += chunk;
            options.onChunk?.(chunk);
          }
        : undefined;
      const result = await chatWithGatewayRetry(ownerId, messages, {
        tools: agentTools,
        ...(emitChunk ? { onChunk: emitChunk } : {}),
      });
      if (result.toolCalls.length === 0) {
        reply = result.text || "";
        streamedReplyChars = streamedThisRound;
        break;
      }
      messages.push({
        role: "assistant",
        content: result.text || null,
        tool_calls: result.toolCalls.map(call => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      const roundToolNames = result.toolCalls.map(call => call.name);
      emit({ type: "round_started", round, toolNames: roundToolNames });
      const failedToolNames: string[] = [];
      for (const call of result.toolCalls) {
        if (await hasAgentStopAfter(ownerId, runStartedAt)) return stopRun();
        await emitTool({
          id: call.id,
          name: call.name,
          state: "running",
          args: { arguments: call.arguments.slice(0, 500) },
        });
        let execution: ToolExecution;
        try {
          execution = await executeWorkspaceTool(ownerId, computer, call, detail => {
            // Progress updates stream live to the open chat only — they are
            // not persisted, so long research runs don't flood the archive.
            Promise.resolve(
              options.onEvent?.({
                type: "tool",
                tool: {
                  id: call.id,
                  name: call.name,
                  state: "running",
                  args: { arguments: call.arguments.slice(0, 500) },
                  detail,
                },
              })
            ).catch(() => {});
          });
        } catch (error) {
          console.error("[Workspace tool] failed", call.name, error);
          execution = {
            ok: false,
            result: "The tool call failed unexpectedly.",
          };
        }
        if (!execution.ok) {
          failedToolNames.push(call.name);
          emit({ type: "blocker", toolName: call.name, toolResult: execution.result });
        }
        if (execution.action) actions.push(execution.action);
        await emitTool({
          id: call.id,
          name: call.name,
          state: execution.ok ? "completed" : "failed",
          args: { arguments: call.arguments.slice(0, 500) },
          summary: toolSummary(call, execution),
          ...(execution.detail
            ? { detail: execution.detail.slice(0, 16000) }
            : {}),
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: execution.result,
        });
      }
      emit({ type: "round_completed", round, toolNames: roundToolNames, failedToolNames });
      // Refresh workspace state so later rounds resolve names/ids created
      // or removed by this round's tools.
      computer = await getWorkspaceComputer(ownerId);
      messages[0] = systemMessage();
    }

    if (!reply.trim()) {
      reply =
        "I could not complete that request. Please try again, or rephrase it more specifically.";
    }
    // The reply already streamed to the client token-by-token: re-sending the
    // full text would duplicate what the user watched appear.
    if (streamedReplyChars === 0) await options.onChunk?.(reply);
    const message = await persistAssistant(reply);
    return { message, actions };
  } catch (error) {
    console.error("[Chat] NVIDIA chat failed", error);
    const kind =
      error instanceof NvidiaGatewayClientError ? error.kind : "unavailable";
    const failureNote =
      "\n\nNova lost the connection to the inference gateway before this reply finished. Everything so far is saved — send another message and I will continue from here.";
    let reply: string;
    if (kind === "configuration") {
      reply =
        "NVIDIA inference is not connected yet. An administrator must configure the server-only gateway before chat is available.";
    } else if (kind === "rate_limit") {
      reply =
        "NVIDIA inference request allowance has been reached. New requests are blocked until an administrator raises the cap.";
    } else {
      // A long tool-calling run often streams part of the reply to the client
      // (the Telegram placeholder, the web stream) before the gateway fails
      // mid-run. Keep what the user already watched instead of throwing it
      // away and replacing it with an error notice.
      const partial = streamedRunText.trim();
      if (partial) {
        reply = partial + failureNote;
      } else if (kind === "invalid_response") {
        reply = "NVIDIA returned an invalid response. Please try again shortly.";
      } else {
        reply = NVIDIA_UNAVAILABLE_MESSAGE;
      }
    }
    // Only emit what the client has not already seen streamed live.
    await options.onChunk?.(streamedRunText.trim() ? failureNote : reply);
    const message = await persistAssistant(reply);
    return { message, actions };
  }
}
