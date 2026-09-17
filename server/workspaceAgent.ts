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
import { presentTelegramFile, sendTelegramMessage } from "./telegram";
import { COMPOSIO_TOOLKITS, type ComposioToolkit, ComposioApiError, executeComposioTool, getComposioConnectionStatus, isComposioToolkit, listComposioTools } from "./composio";

export type AgentAction = {
  kind: "folder" | "file" | "telegram" | "vm" | "connector" | "research" | "deployment" | "project";
  name: string;
  operation?:
    | "created"
    | "updated"
    | "renamed"
    | "moved"
    | "deleted"
    | "sent"
    | "presented"
    | "completed"
    | "disabled"
    | "listed"
    | "executed"
    | "deployed"
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

type WorkspaceAgentOptions = {
  onEvent?: (event: {
    type: "tool";
    tool: WorkspaceToolActivity;
  }) => void | Promise<void>;
  onChunk?: (chunk: string) => void | Promise<void>;
  /** Where the request came from — shapes how the model keeps the user posted. */
  channel?: "telegram" | "web";
  /** Data-URI images attached to this turn, sent to the model as vision input. */
  imageAttachments?: string[];
  /**
   * When this run must be finished by (epoch ms). Defaults to a budget just
   * under the Vercel maxDuration so the final reply is always persisted —
   * a gateway round started too close to the limit would be killed with the
   * function before the reply could be saved.
   */
  deadlineAtMs?: number;
};

/**
 * Vercel caps functions at 300s; leave a safety margin so the closing reply
 * is persisted well before the instance can be frozen or killed.
 */
const MAX_RUN_BUDGET_MS = 285_000;
/** Skip the final model round when less than this remains. */
const FINAL_ROUND_MIN_REMAINING_MS = 45_000;

/** Raised when a tool call is still running as the run deadline passes. */
class RunDeadlineExceeded extends Error {
  constructor() {
    super("the run deadline passed while a tool was still executing");
    this.name = "RunDeadlineExceeded";
  }
}

/**
 * Race a tool call against the run deadline. A single long call (a VM task,
 * a deploy) can outlast the 285s budget between the round-level checks, so
 * Vercel killed the function mid-tool with no closing reply. The work is a
 * factory so an already-expired deadline never starts the call at all —
 * its side effects must not begin once the run has effectively ended.
 * Losing the race stops *waiting*, not the tool — side effects already in
 * flight continue, and the caller closes the run so the reply persists in
 * the remaining margin.
 */
async function raceToolDeadline<T>(
  work: () => Promise<T>,
  deadlineAtMs: number
): Promise<T> {
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) throw new RunDeadlineExceeded();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RunDeadlineExceeded()), remainingMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
      name: "present_file",
      description:
        "Present a workspace file to the user over Telegram so they can view or download it: images are shown inline for viewing, other files arrive as a downloadable document. Use it when you create or meaningfully update a file the user asked for — over Telegram they cannot browse the workspace themselves. Only available on Telegram requests. Requires Telegram to be connected.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Name or id of the workspace file to present." },
          caption: { type: "string", description: "Optional one-line note to show alongside the file." },
        },
        required: ["file"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_progress_update",
      description:
        "Send the user a brief mid-task progress note over Telegram (opening ETA, revised ETA, interim status, or a blocker notice). Use this while working on a request; use send_telegram_message when sending a message is itself the task. Requires Telegram to be connected.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The progress note, e.g. \"I'll get this done within about 1-2 minutes.\"" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deploy_website",
      description:
        "Publish a chosen directory of the workspace as a live website on Netlify's free static hosting — always on, with SSL. The directory's contents become the site (its folder structure is kept relative to it) and its index.html is the entry page; the first deploy creates a permanent URL, later deploys update that same URL. You MUST deliberately choose which directory to deploy: the project or build-output folder that holds the site, not unrelated workspace files — pass '/' only when the site genuinely lives at the workspace root. Anything static hosting serves publishes as-is: plain HTML/CSS/JS sites, React apps, statically exported Next.js projects, single-page apps, portfolios, and so on. A deploy can take up to a minute.",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description:
              "Workspace-relative directory to publish, e.g. 'my-react-app' or 'my-next-app/out'. Pass '/' for the workspace root. Its index.html becomes the entry page.",
          },
        },
        required: ["directory"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project_template",
      description:
        "Scaffold a clean project in the workspace from a template: 'static' (plain HTML/CSS/JS site), 'react' (React single-page app that runs in the browser — no build step), or 'next' (Next.js App Router configured for static export; needs a VM build before deploying). The template lands in its own folder so deployments stay clean — deploy_website then publishes that folder (for 'next', its out/ build output). Use this when the user wants a new site or app started from scratch, or wants their project organized properly before going live. If the user did not ask for a specific stack, do not ask them — pick the best fit yourself and say which stack you chose.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Project name — becomes the folder name (e.g. 'My Portfolio' -> 'my-portfolio').",
          },
          template: {
            type: "string",
            enum: ["static", "react", "next"],
            description: "The project type to scaffold. If the user did not specify a stack, choose the best fit for their request: 'static' for content sites and landing pages, 'react' for interactive apps and demos, 'next' only when they explicitly want Next.js. Omitting it scaffolds 'static'.",
          },
        },
        required: ["name"],
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

import { deployWorkspaceSite } from "./siteDeploy";
import {
  isProjectTemplateKey,
  PROJECT_TEMPLATE_KEYS,
  renderProjectTemplate,
  slugifyProjectName,
} from "./projectTemplates";

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
- Publish websites with deploy_website — publishing is exclusively your ability (the web UI has no publish button). When the user wants their workspace, site, page, or app online (\"put this online\", \"go live\", \"host my site\", \"publish my portfolio\"), first make it deployable: it must be static (anything Netlify's static hosting serves) with an index.html at the root of the chosen directory. Then call deploy_website and deliberately choose the directory to publish — the project or build-output folder that holds the site, never a blind dump of unrelated workspace files; pass '/' only when the site genuinely lives at the workspace root. The first deploy creates the permanent live URL; later deploys update that same URL. Deploys can take up to a minute. If the tool reports that hosting is not configured yet (the operator must set NETLIFY_API_TOKEN on the server), tell the user exactly that.
- Start clean projects with create_project_template. When the user wants a new site or app, scaffold it instead of improvising loose files. If they did not specify a stack, choose the best fit yourself instead of asking — and mention the stack you chose. 'static' for a plain HTML/CSS/JS site, 'react' for a React SPA that runs in the browser (React from a CDN, no build step), 'next' for a Next.js App Router project configured for static export. The template lands in its own project folder. For 'static' and 'react', deploy_website publishes the project folder directly; for 'next', run 'npm install && npm run build' in the project folder via run_vm_task first, copy the generated out/ files into the workspace with create_file, then deploy_website with the out folder as the directory. From there, edit and extend the project with your regular file tools and redeploy with the same directory so the URL stays stable.
- Recover on your own. If a tool call fails or a name is missing, adapt: list the workspace, try an alternative, fix the input, and continue. Only surface failure after you have genuinely tried alternatives. When something is impossible with the tools available, say exactly what you would need to do it.
- Verify your work. After creating or editing, read back or otherwise confirm the outcome before claiming success.
- Report briefly. End multi-step work with a short summary of what changed (files created/edited/moved/deleted, messages sent, tasks run) — not a play-by-play.
- Keep the user posted on Telegram, and own the ETA while you work. Over Telegram the user sees only the messages you send — none of your tool activity. So for any task that will take more than a few seconds, send a first progress note right away with an honest time estimate ("I'll get this done within about 30 seconds", "…within 1–2 minutes"). From then on the estimate is yours to maintain: keep sending short updates at a steady rhythm as you work — after each meaningful step completes, and never let more than a minute or so pass in silence on a long run — and whenever reality diverges from your estimate, say so and send the revised range ("taking longer than expected — about 2 more minutes", "nearly there, ~20 seconds"). Tell the user immediately when you hit a blocker — saying whether you are solving it yourself or need something from them — and whether it changes the ETA. Use send_progress_update for every note, keep each one brief, and never send a "done" summary until the work actually is done. When you create or meaningfully update a file the user asked for, present it with present_file so they can view or download it right in the chat. In the web app the user watches your tool activity live, so skip interim notes there and just do the work.

Formatting: render replies in Markdown when it helps readability — **bold** or *italics* for emphasis, \`inline code\` for identifiers, fenced \`\`\` code blocks with a language tag, and bullet or numbered lists for steps. Keep formatting light in casual replies.

Workspace rules:
- Resolve files and folders by the exact names/ids listed below; if something is missing, list the workspace and act on what exists instead of guessing.
- edit_file replaces the file's entire content — read it first when unsure.
- Keep tool arguments exact and minimal.
- Invoke tools with real tool calls only — never write a tool call out as plain text (like {"name": ..., "parameters": ...}); the runtime only executes real tool calls.
- Never claim anything was created, edited, moved, deleted, or sent unless the tool results confirm it.
- Never expose secrets, tokens, credentials, or private data. Match the user's language when practical.

The user you are helping: {{user}}. Address them by that name or username naturally, and keep personalising your replies to them.
This request arrived via: {{channel}}.

Current folders: {{folders}}
Current files: {{files}}`;

type ToolExecution = {
  ok: boolean;
  result: string;
  action?: AgentAction;
  /** Full raw response surfaced in the research dropdown in the UI. */
  detail?: string;
};

/**
 * Some models spell a tool call out as text instead of invoking it —
 * 'The function call that best answers the given prompt is {"name": "present_file", "parameters": {...}}'.
 * Recover the intent: extract the embedded JSON object and run it as a real
 * tool call so the action still executes and the raw JSON never reaches the user.
 */
function toolCallWrittenAsText(text: string, tools: Array<{ function: { name: string } }>): { name: string; arguments: string } | undefined {
  if (!text || !text.includes('"name"')) return undefined;
  const known = new Set(tools.map(tool => tool.function.name));
  for (const match of Array.from(text.matchAll(/"name"\s*:\s*"([A-Za-z0-9_]+)"/g))) {
    const name = match[1];
    if (!known.has(name) || match.index === undefined) continue;
    const objectStart = text.lastIndexOf("{", match.index);
    if (objectStart < 0) continue;
    // Brace-match forward from the candidate start to the end of that object.
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = objectStart; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth !== 0) continue;
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(text.slice(objectStart, i + 1)) as Record<string, unknown>; } catch { break; }
        let parameters: Record<string, unknown>;
        if (typeof parsed.parameters === "object" && parsed.parameters !== null)
          parameters = parsed.parameters as Record<string, unknown>;
        else if (typeof parsed.arguments === "object" && parsed.arguments !== null)
          parameters = parsed.arguments as Record<string, unknown>;
        else {
          const { name: _toolName, ...others } = parsed;
          parameters = others;
        }
        return { name, arguments: JSON.stringify(parameters) };
      }
    }
  }
  return undefined;
}

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
    case "deploy_website": {
      const directory = str(args.directory);
      if (!directory)
        return {
          ok: false,
          result:
            "You must choose the directory to deploy. Pass '/' for the workspace root, or a workspace folder path like 'my-react-app' or 'my-next-app/out' — the directory whose contents are the site.",
        };
      const outcome = await deployWorkspaceSite(
        ownerId,
        directory === "/" ? null : directory
      );
      if (!outcome.ok)
        return {
          ok: false,
          result: `The website was not deployed: ${outcome.message}`,
          action: { kind: "deployment", name: "", operation: "failed" },
        };
      const fileCount = outcome.deployment.fileCount;
      return {
        ok: true,
        result: `The site is live at ${outcome.deployment.siteUrl} — ${fileCount} file${fileCount === 1 ? "" : "s"} published from ${directory === "/" ? "the workspace root" : `/${directory}`}. Share that URL — it stays the same on every future deploy.`,
        action: {
          kind: "deployment",
          name: outcome.deployment.siteUrl,
          operation: "deployed",
        },
      };
    }
    case "create_project_template": {
      const rawName = str(args.name);
      if (!rawName) return { ok: false, result: "A project name is required." };
      // No stack specified: the model decides, but if it omitted the template
      // entirely, scaffold the safe default that deploys without a build.
      const template = str(args.template).trim() === "" ? "static" : args.template;
      if (!isProjectTemplateKey(template))
        return {
          ok: false,
          result: `Unknown template: ${str(args.template)}. Supported templates: ${PROJECT_TEMPLATE_KEYS.join(", ")}.`,
        };
      const projectName = slugifyProjectName(rawName);
      const rendered = renderProjectTemplate(template, rawName);

      // Project folder at the workspace root — reuse it if it already exists.
      const existingProject = computer.folders.find(
        folder => folder.parentId === null && folder.name.toLowerCase() === projectName.toLowerCase()
      );
      const projectFolder =
        existingProject ??
        (await createWorkspaceFolderForUser(ownerId, {
          name: projectName,
          parentId: null,
        }));
      if (!projectFolder)
        return {
          ok: false,
          result: `Could not create the ${projectName} folder — it may already exist.`,
        };

      // Folder cache: relative path inside the project -> folder id.
      const folderIds = new Map<string, number>([["", projectFolder.id]]);
      const ensureFolder = async (relativePath: string): Promise<number | null> => {
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
              folder.parentId === parentId && folder.name.toLowerCase() === segment.toLowerCase()
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
        const folderPath = lastSlash === -1 ? "" : file.path.slice(0, lastSlash);
        const fileName = lastSlash === -1 ? file.path : file.path.slice(lastSlash + 1);
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
            result: `Could not create ${file.path} in the ${projectName} folder — a file with that name may already exist.`,
          };
        createdPaths.push(file.path);
      }

      const deployDirectory =
        rendered.deployRoot === "." ? projectName : `${projectName}/${rendered.deployRoot}`;
      return {
        ok: true,
        result: `Scaffolded the ${rawName} project (${template} template): ${createdPaths.length} files in the ${projectName} folder — ${createdPaths.join(", ")}. ${rendered.summary} When it is ready to go live, deploy_website with directory: ${deployDirectory}.`,
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
      if (!text) return { ok: false, result: "A progress note text is required." };
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
    case "present_file": {
      const file = resolveFile(computer, args.file);
      if (!file)
        return { ok: false, result: `File not found: ${str(args.file)}.` };
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
          result: `Presented ${file.name} to the user as a ${presented.as} (message #${presented.messageId}) — they can view or download it in the chat.`,
          action: { kind: "file", name: file.name, operation: "presented" },
        };
      } catch (error) {
        return {
          ok: false,
          result: `Could not present ${file.name}: ${error instanceof Error ? error.message : "Telegram rejected the file."}`,
        };
      }
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
  if (action.operation === "presented")
    return `Presented ${action.name} to the user.`;
  if (action.kind === "deployment")
    return action.operation === "failed"
      ? "Failed deploying the website."
      : `Deployed the website: ${action.name}.`;
  if (action.kind === "connector")
    return action.operation === "listed"
      ? `Listed ${action.name}.`
      : `${action.operation === "failed" ? "Failed running" : "Ran"} GitHub action: ${action.name}.`;
  return `${action.operation === "deleted" ? "Delet" : action.operation === "updated" ? "Updat" : "Creat"}ed ${action.kind}: ${action.name}.`;
}

/** Transient gateway failures worth one automatic in-run retry. */
const GATEWAY_RETRY_KINDS = new Set(["unavailable", "invalid_response"]);
let gatewayRetryDelaysMs: number[] = [400, 1200, 5000];

/**
 * NVIDIA's free tier rate limits (~40 RPM) apply per minute, but once a 429
 * lockout starts it lasts roughly 30-60 minutes — and every request sent
 * during the lockout can extend it. So upstream rate limits get ONE patient
 * retry (transient 429s under load do clear in seconds), never the fast
 * retry loop, and only when the run budget can absorb the wait.
 */
const RATE_LIMIT_RETRY_DELAY_MS = 45_000;
/** The patient retry only runs with this much run budget left afterwards. */
const RATE_LIMIT_RETRY_MIN_REMAINING_MS = 60_000;
let gatewayRateLimitRetryDelayMs: number | null = null;

/** Test hook: shrink the patient rate-limit wait so suites stay fast. */
export function setGatewayRateLimitRetryDelayForTests(ms: number | null) {
  gatewayRateLimitRetryDelayMs = ms;
}

/** Run-scoped retry bookkeeping shared across gateway rounds. */
type GatewayRetryState = { rateLimitRetryUsed: boolean };

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
  options: {
    tools?: GatewayToolDefinition[];
    onChunk?: (chunk: string) => void;
    signal?: AbortSignal;
    /** Run deadline (epoch ms) — the patient rate-limit wait must fit. */
    deadlineAtMs?: number;
    /** Run-scoped state: the patient wait happens at most once per run. */
    retryState?: GatewayRetryState;
  }
) {
  const maxAttempts = gatewayRetryDelaysMs.length + 1;
  for (let attempt = 0; ; attempt += 1) {
    let streamedChars = 0;
    const emit = options.onChunk;
    try {
      return await chatWithNvidiaGateway(ownerId, messages, {
        tools: options.tools,
        ...(options.signal ? { signal: options.signal } : {}),
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
      // A user-requested stop aborts the in-flight request: never retry it.
      if (options.signal?.aborted) throw error;
      const retryable =
        error instanceof NvidiaGatewayClientError &&
        GATEWAY_RETRY_KINDS.has(error.kind);
      // Upstream 429: one patient retry, deadline-gated, once per run. The
      // fast loop must never hammer a lockout — that only extends it.
      const isUpstreamRateLimit =
        error instanceof NvidiaGatewayClientError && error.kind === "rate_limit";
      const waitMs = gatewayRateLimitRetryDelayMs ?? RATE_LIMIT_RETRY_DELAY_MS;
      if (
        isUpstreamRateLimit &&
        streamedChars === 0 &&
        !(options.retryState?.rateLimitRetryUsed ?? false) &&
        options.deadlineAtMs !== undefined &&
        Date.now() + waitMs + RATE_LIMIT_RETRY_MIN_REMAINING_MS <= options.deadlineAtMs
      ) {
        if (options.retryState) options.retryState.rateLimitRetryUsed = true;
        await waitFor(waitMs);
        continue;
      }
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
  /** Appends the assistant's reply to the chat and returns the persisted message. */
  const persistAssistant = async (reply: string) =>
    appendChatMessageForUser(ownerId, {
      chatId,
      role: "assistant",
      content: reply,
    });

  const actions: AgentAction[] = [];
  const deadlineAtMs = options.deadlineAtMs ?? Date.now() + MAX_RUN_BUDGET_MS;
  const retryState: GatewayRetryState = { rateLimitRetryUsed: false };
  // Summaries of the tool calls in the current round — used to synthesize a
  // closing reply when the run runs out of time before the final model round.
  let lastRoundSummaries: string[] = [];
  /**
   * Closing reply for a run that hits its time budget: built from the last
   * round's completed tool summaries so the user still hears where things
   * stand, and naming the step that was cut short — skipped or interrupted —
   * instead of counting it among the completed work.
   */
  const synthesizeDeadlineReply = (
    unfinishedTool: string | null = null,
    unfinishedToolStarted = true
  ) => {
    const summaryLines = lastRoundSummaries
      .map(summary => `- ${summary}`)
      .join("\n");
    const base = lastRoundSummaries.length
      ? unfinishedTool
        ? `I ran out of processing time to finish this task. Here is where the completed steps stand:\n${summaryLines}`
        : `I completed the steps in this task, but ran out of processing time to write a full summary. Here is where things stand:\n${summaryLines}`
      : "I ran out of processing time for this task. Everything so far is saved — send another message and I will continue from here.";
    if (!unfinishedTool) return base;
    const note = unfinishedToolStarted
      ? `⏱️ The \`${unfinishedTool}\` step was still running when time ran out and was interrupted mid-flight — it is not finished. Send another message and I will continue from where it stopped.`
      : `⏱️ Time ran out before the \`${unfinishedTool}\` step could start, so it was skipped. Send another message and I will pick this task back up.`;
    return `${base}\n\n${note}`;
  };
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
    const agentTools = workspaceToolsForConnectors(connectedConnectors).filter(
      tool => options.channel === "telegram" || tool.function.name !== "present_file"
    );
    const systemMessage = (): GatewayChatMessage => {
      const { folders, files } = describeWorkspace(computer);
      return {
        role: "system",
        content: WORKSPACE_AGENT_PROMPT.replace("{{folders}}", folders).replace(
          "{{files}}",
          files
        ).replace("{{connectors}}", connectorStatusLine(connectedConnectors))
          .replace("{{user}}", userLine)
          .replace(
            "{{channel}}",
            options.channel === "telegram"
              ? "Telegram — the user only sees the messages you send, not your tool activity"
              : "the Nova web app — the user sees your tool activity live as you work"
          ),
      };
    };

    const imageParts = (options.imageAttachments ?? []).filter(uri =>
      uri.startsWith("data:image/")
    );
    let visionActive = imageParts.length > 0;
    const messages: GatewayChatMessage[] = [
      systemMessage(),
      {
        role: "user",
        content: visionActive
          ? [
              { type: "text" as const, text: content },
              ...imageParts.map(uri => ({
                type: "image_url" as const,
                image_url: { url: uri },
              })),
            ]
          : content,
      },
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

    // /stop must be able to end a run mid-response, not only between rounds:
    // the chunk stream is polled for stop requests and aborts the in-flight
    // completion so a long reply stops almost immediately.
    const stopController = new AbortController();
    let lastStopCheckMs = 0;
    const checkStopMidStream = () => {
      const now = Date.now();
      if (now - lastStopCheckMs < 250) return;
      lastStopCheckMs = now;
      void hasAgentStopAfter(ownerId, runStartedAt)
        .then(stop => {
          if (stop) stopController.abort();
        })
        .catch(() => {});
    };

    let reply = "";
    let streamedReplyChars = 0;
    let recoveredCallCount = 0;
    // Set when a tool call outlasts the deadline mid-round: the round loop
    // must stop without refreshing state or starting another gateway round.
    let closedByDeadline = false;
    for (let round = 0; ; round += 1) {
      if (round > 0 && (await hasAgentStopAfter(ownerId, runStartedAt))) return stopRun();
      // A deploy or long research can consume nearly the whole request
      // budget. Starting another gateway round this close to the maxDuration
      // limit risks the function being killed before the reply persists —
      // close the run with a synthesized status instead.
      if (round > 0 && Date.now() + FINAL_ROUND_MIN_REMAINING_MS > deadlineAtMs) {
        reply = synthesizeDeadlineReply();
        streamedReplyChars = 0;
        break;
      }
      let streamedThisRound = 0;
      const emitChunk = options.onChunk
        ? (chunk: string) => {
            streamedThisRound += chunk.length;
            streamedRunText += chunk;
            options.onChunk?.(chunk);
            checkStopMidStream();
          }
        : undefined;
      let result: Awaited<ReturnType<typeof chatWithGatewayRetry>>;
      try {
        result = await chatWithGatewayRetry(ownerId, messages, {
          tools: agentTools,
          ...(emitChunk ? { onChunk: emitChunk } : {}),
          signal: stopController.signal,
          deadlineAtMs,
          retryState,
        });
      } catch (error) {
        if (
          stopController.signal.aborted &&
          (await hasAgentStopAfter(ownerId, runStartedAt))
        )
          return stopRun();
        if (!visionActive) throw error;
        // A model without vision rejects image parts outright: drop the
        // attachment instead of failing the run, and let the model say so.
        visionActive = false;
        const userIndex = messages.findIndex(m => m.role === "user");
        if (userIndex >= 0)
          messages[userIndex] = {
            role: "user",
            content: `${content}\n\n⚠️ (This model cannot view image attachments, so the uploaded image is not visible here — it is still saved in the workspace. Say so plainly and work from what the user says.)`,
          };
        result = await chatWithGatewayRetry(ownerId, messages, {
          tools: agentTools,
          ...(emitChunk ? { onChunk: emitChunk } : {}),
          signal: stopController.signal,
          deadlineAtMs,
          retryState,
        });
      }
      // Recover a tool call the model wrote out as text: run it as a real
      // call so the action executes instead of dumping raw JSON on the user.
      const recoveredCall =
        result.toolCalls.length === 0 && recoveredCallCount < 2
          ? toolCallWrittenAsText(result.text, agentTools)
          : undefined;
      if (recoveredCall) {
        recoveredCallCount += 1;
        console.info(
          "[Workspace agent] recovered a tool call written as text:",
          recoveredCall.name
        );
      }
      if (result.toolCalls.length === 0 && !recoveredCall) {
        reply = result.text || "";
        streamedReplyChars = streamedThisRound;
        break;
      }
      const calls = result.toolCalls.length > 0
        ? result.toolCalls
        : [
            {
              id: `recovered-${Date.now()}`,
              name: recoveredCall!.name,
              arguments: recoveredCall!.arguments,
            },
          ];
      messages.push({
        role: "assistant",
        content: result.text || null,
        tool_calls: calls.map(call => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      lastRoundSummaries = [];
      for (const call of calls) {
        if (await hasAgentStopAfter(ownerId, runStartedAt)) return stopRun();
        // The budget is already gone: starting the call would begin its side
        // effects (a file write, a deploy) after the run has effectively
        // ended. Skip it, record why, and close the run instead.
        if (Date.now() >= deadlineAtMs) {
          const skipped = `${call.name} was skipped because the request budget ran out before it could start.`;
          await emitTool({
            id: call.id,
            name: call.name,
            state: "failed",
            args: { arguments: call.arguments.slice(0, 500) },
            summary: skipped,
          });
          reply = synthesizeDeadlineReply(call.name, false);
          streamedReplyChars = 0;
          closedByDeadline = true;
          break;
        }
        await emitTool({
          id: call.id,
          name: call.name,
          state: "running",
          args: { arguments: call.arguments.slice(0, 500) },
        });
        let execution: ToolExecution;
        try {
          execution = await raceToolDeadline(
            () =>
              executeWorkspaceTool(ownerId, computer, call, detail => {
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
            }),
            deadlineAtMs
          );
        } catch (error) {
          if (error instanceof RunDeadlineExceeded) {
            // A VM task or deploy outlasted the request budget between the
            // round-level checks: stop waiting, record the interruption, and
            // close the run so the reply persists inside the remaining
            // maxDuration margin. The interrupted step is reported as
            // unfinished, not counted among the completed summaries.
            await emitTool({
              id: call.id,
              name: call.name,
              state: "failed",
              args: { arguments: call.arguments.slice(0, 500) },
              summary: `${call.name} was still running when the request budget ran out and was interrupted mid-flight.`,
            });
            reply = synthesizeDeadlineReply(call.name, true);
            streamedReplyChars = 0;
            closedByDeadline = true;
            break;
          }
          console.error("[Workspace tool] failed", call.name, error);
          execution = {
            ok: false,
            result: "The tool call failed unexpectedly.",
          };
        }
        if (execution.action) actions.push(execution.action);
        lastRoundSummaries.push(toolSummary(call, execution));
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
      // The deadline hit mid-tool: the closing reply is already set — leave
      // the round loop without refreshing state or starting a new round.
      if (closedByDeadline) break;
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
    } else if (kind === "allowance_reached") {
      reply =
        "NVIDIA inference request allowance has been reached. New requests are blocked until an administrator raises the cap.";
    } else if (kind === "rate_limit") {
      reply =
        "NVIDIA's free-tier rate limit was hit (about 40 requests per minute). Their lockouts can last 30-60 minutes, and retrying during one only extends it — so I stopped after my one patient retry instead of hammering. Please try again in a little while; everything so far is saved.";
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
