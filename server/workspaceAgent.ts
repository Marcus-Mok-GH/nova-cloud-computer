import { NVIDIA_UNAVAILABLE_MESSAGE } from "@shared/const";
import { startAgentVmRun } from "./agentVm";
import {
  appendChatMessageForUser,
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  deleteWorkspaceFileForUser,
  deleteWorkspaceFolderForUser,
  getChatForUser,
  getTelegramCredentialsForUser,
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

export type AgentAction = {
  kind: "folder" | "file" | "telegram" | "vm";
  name: string;
  operation?:
    | "created"
    | "updated"
    | "renamed"
    | "moved"
    | "deleted"
    | "sent"
    | "completed"
    | "disabled";
};

export type WorkspaceToolActivity = {
  id: string;
  name: string;
  state: "running" | "completed" | "failed";
  args: Record<string, string>;
  summary?: string;
};

type WorkspaceAgentOptions = {
  onEvent?: (event: {
    type: "tool";
    tool: WorkspaceToolActivity;
  }) => void | Promise<void>;
  onChunk?: (chunk: string) => void | Promise<void>;
};

export const TOOL_ACTIVITY_MESSAGE_PREFIX = "__nova_tool_activity__:";

/** Safety cap on tool-calling rounds per user message. */
const MAX_TOOL_ROUNDS = 8;

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
      name: "run_vm_task",
      description:
        "Run a Python 3 script in an isolated E2B sandbox VM with internet access and a 240-second limit. This is the tool for real execution: installing and using packages (pip install, e.g. requests), scraping or browsing with HTTP libraries, processing data, or running shell commands via subprocess.run(['cmd','arg'], capture_output=True, text=True). Always write complete Python code in `code` — `task` is just a short label for the run. The script sees the workspace's files under /home/user/workspace/input and should print() anything you want to report; workspace files changed or created during the run are synced back automatically.",
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

const WORKSPACE_AGENT_PROMPT = `You are Nova, a fully autonomous operator of a private computer workspace. You do not wait to be told how — you decide how, then act.

Operating principles:
- Act first. When the user states a goal, complete it end-to-end in this turn: plan internally, call every tool the goal requires, verify the result, then report. Never reply with only a plan, instructions, or a question when tools could get the work done right now.
- Chain tools freely. Multi-step work is the norm: create folders before files, read before editing, verify after writing. Do not pause between steps to narrate or ask permission — the user sees your tool activity as it runs.
- Assume instead of asking. When a request is underspecified, choose sensible defaults (names, structure, wording, formatting) and state the choice in one line. Ask a question only when no reasonable interpretation exists at all.
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

Current folders: {{folders}}
Current files: {{files}}`;

type ToolExecution = {
  ok: boolean;
  result: string;
  action?: AgentAction;
};

/** Executes a single model-requested tool call against the workspace. */
async function executeWorkspaceTool(
  ownerId: number,
  computer: Computer,
  call: GatewayToolCall
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
  return execution.action
    ? `${execution.action.operation === "deleted" ? "Delet" : execution.action.operation === "updated" ? "Updat" : "Creat"}ed ${execution.action.kind}: ${execution.action.name}.`
    : call.name;
}

/** Transient gateway failures worth one automatic in-run retry. */
const GATEWAY_RETRY_KINDS = new Set(["unavailable", "invalid_response"]);
let gatewayRetryDelaysMs: number[] = [400, 1200];

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

    if (tool.state === "completed" || tool.state === "failed") {
      try {
        await appendChatMessageForUser(ownerId, {
          chatId,
          role: "assistant",
          content: `${TOOL_ACTIVITY_MESSAGE_PREFIX}${JSON.stringify(tool)}`,
        });
      } catch (error) {
        console.error("[Tool activity] failed to persist", error);
      }
    }
  };
  /** Appends the assistant's reply to the chat and returns the persisted message. */
  const persistAssistant = async (reply: string) =>
    appendChatMessageForUser(ownerId, {
      chatId,
      role: "assistant",
      content: reply,
    });

  const actions: AgentAction[] = [];

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
    const systemMessage = (): GatewayChatMessage => {
      const { folders, files } = describeWorkspace(computer);
      return {
        role: "system",
        content: WORKSPACE_AGENT_PROMPT.replace("{{folders}}", folders).replace(
          "{{files}}",
          files
        ),
      };
    };

    const messages: GatewayChatMessage[] = [
      systemMessage(),
      { role: "user", content },
    ];

    let reply = "";
    let streamedReplyChars = 0;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      let streamedThisRound = 0;
      const emitChunk = options.onChunk
        ? (chunk: string) => {
            streamedThisRound += chunk.length;
            options.onChunk?.(chunk);
          }
        : undefined;
      const result = await chatWithGatewayRetry(ownerId, messages, {
        tools: WORKSPACE_TOOLS,
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
      for (const call of result.toolCalls) {
        await emitTool({
          id: call.id,
          name: call.name,
          state: "running",
          args: { arguments: call.arguments.slice(0, 500) },
        });
        let execution: ToolExecution;
        try {
          execution = await executeWorkspaceTool(ownerId, computer, call);
        } catch (error) {
          console.error("[Workspace tool] failed", call.name, error);
          execution = {
            ok: false,
            result: "The tool call failed unexpectedly.",
          };
        }
        if (execution.action) actions.push(execution.action);
        await emitTool({
          id: call.id,
          name: call.name,
          state: execution.ok ? "completed" : "failed",
          args: { arguments: call.arguments.slice(0, 500) },
          summary: toolSummary(call, execution),
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: execution.result,
        });
      }
      // Refresh workspace state so later rounds resolve names/ids created
      // or removed by this round's tools.
      computer = await getWorkspaceComputer(ownerId);
      messages[0] = systemMessage();
    }

    if (!reply.trim()) {
      reply =
        "I could not complete that request within my tool-step limit. Please try a more specific request.";
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
    let reply: string;
    if (kind === "configuration") {
      reply =
        "NVIDIA inference is not connected yet. An administrator must configure the server-only gateway before chat is available.";
    } else if (kind === "rate_limit") {
      reply =
        "NVIDIA inference request allowance has been reached. New requests are blocked until an administrator raises the cap.";
    } else if (kind === "invalid_response") {
      reply = "NVIDIA returned an invalid response. Please try again shortly.";
    } else {
      reply = NVIDIA_UNAVAILABLE_MESSAGE;
    }
    await options.onChunk?.(reply);
    const message = await persistAssistant(reply);
    return { message, actions };
  }
}
