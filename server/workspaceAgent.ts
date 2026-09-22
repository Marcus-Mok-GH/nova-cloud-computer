import { MISTRAL_UNAVAILABLE_PREFIX } from "@shared/const";
import { runResearch } from "./researcher";
import { runAutonomousCoderTask, runCoderTask, type CoderOutcome } from "./coder";
import { NimConfigError } from "./nim";
import type { E2BSandboxLike } from "./e2b";
import {
  type SandboxOp,
  mirrorWorkspaceOp,
  prepareAgentSandbox,
  runBashOnSandbox,
  syncAgentSandbox,
  workspaceRelativePathOf,
  folderPathOf,
} from "./sandboxWorkspace";
import { runBrowserCommand, warmBrowserInBackground } from "./agentBrowser";
import { evaluate } from "mathjs";
import { getDatabaseTime, hasAgentStopAfter } from "./db";
import { startAgentVmRun } from "./agentVm";
import {
  appendChatMessageForUser,
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  deleteWorkspaceFileForUser,
  deleteWorkspaceFolderForUser,
  getChatForUser,
  getCommunicationStyleForUser,
  getTelegramCredentialsForUser,
  getUserIdentityForUser,
  getWorkspaceComputer,
  listChatMessagesForUser,
  renameChatIfDefaultForUser,
  setCommunicationStyleForUser,
  updateWorkspaceFileForUser,
  updateWorkspaceFolderForUser,
} from "./db";
import {
  getMistralGatewayStatus,
  type GatewayChatMessage,
  type GatewayToolCall,
  type GatewayToolDefinition,
  MistralGatewayClientError,
  configuredVisionChatModel,
} from "./mistralGateway";
import {
  chatWithWorkspaceModel,
  completeWithWorkspaceModel,
  getActiveCustomModel,
} from "./byokGateway";
import { presentTelegramFile, sendTelegramMessage } from "./telegram";
import { COMPOSIO_TOOLKITS, type ComposioToolkit, ComposioApiError, executeComposioTool, getComposioConnectionStatus, isComposioToolkit, listComposioTools } from "./composio";

export type AgentAction = {
  kind: "folder" | "file" | "telegram" | "vm" | "browser" | "connector" | "research" | "deployment" | "project" | "tool";
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
  /** Where the request came from - shapes how the model keeps the user posted. */
  channel?: "telegram" | "web";
  /** Data-URI images attached to this turn, sent to the model as vision input. */
  imageAttachments?: string[];
  /**
   * When this run must be finished by (epoch ms). Defaults to a budget just
   * under the Vercel maxDuration so the final reply is always persisted -
   * a gateway round started too close to the limit would be killed with the
   * function before the reply could be saved.
   */
  deadlineAtMs?: number;
  /**
   * True when a segmented run will automatically continue in the next
   * segment (serverless invocation) once this segment's budget ends. The
   * deadline closing status then reads as a progress note the user does not
   * have to act on, instead of asking them to send "continue".
   */
  continuationPlanned?: boolean;
};

/**
 * Vercel caps functions at 300s; leave a safety margin so the closing reply
 * is persisted well before the instance can be frozen or killed. The webhook
 * anchors the deadline to when the Telegram update ARRIVED, not when the
 * agent run starts - pre-run work (upload download, voice transcription)
 * would otherwise push the closing reply past the hard runtime limit.
 */
export const MAX_RUN_BUDGET_MS = 285_000;
/** Race cap for the model-written closing status; falls back to the template. */
const DEADLINE_CLOSE_MODEL_CAP_MS = 8_000;
/** Skip the final model round when less than this remains. */
const FINAL_ROUND_MIN_REMAINING_MS = 45_000;
/**
 * Thinking-block streaming cadence: reasoning-capable models emit their
 * private reasoning as reasoning_content deltas, which are shown live as a
 * collapsible thinking block (like the tool blocks). Deltas are coalesced -
 * a persisted activity update goes out at most every 2s and only once a
 * meaningful amount of new reasoning arrived - so watching the model think
 * never floods the event stream or the chat ledger.
 */
const THINKING_EMIT_INTERVAL_MS = 2_000;
const THINKING_MIN_DELTA_CHARS = 240;
/** Cap on the reasoning text kept in a thinking block (reasoning can be long). */
const THINKING_DETAIL_LIMIT = 20_000;

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
 * factory so an already-expired deadline never starts the call at all -
 * its side effects must not begin once the run has effectively ended.
 * Losing the race stops *waiting*, not the tool - side effects already in
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
/**
 * Internal bookkeeping rows recording the specialist-down acceptance state
 * ("pending" after a run whose code_task failed, "accepted" once the user
 * OK'd Nova's own coding in a later turn, "cleared" when code_task next
 * succeeds). They are persisted as chat messages, filtered out of the
 * model's history and the client UI, and never shown to anyone.
 */
export const SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX = "__nova_specialist_acceptance__:";

type SpecialistAcceptanceState = "pending" | "accepted" | "none";

/** Reads the latest specialist acceptance marker for a chat. */
async function readSpecialistAcceptance(
  ownerId: number,
  chatId: number
): Promise<SpecialistAcceptanceState> {
  const rows = (await listChatMessagesForUser(ownerId, chatId)) ?? [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const content = rows[index].content;
    if (content.startsWith(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX)) {
      const state = content.slice(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX.length);
      if (state === "pending" || state === "accepted") return state;
      return "none";
    }
  }
  return "none";
}

/** Appends a specialist acceptance marker row. */
async function recordSpecialistAcceptance(
  ownerId: number,
  chatId: number,
  state: "pending" | "accepted" | "cleared"
): Promise<void> {
  await appendChatMessageForUser(ownerId, {
    chatId,
    role: "assistant",
    content: `${SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX}${state}`,
  });
}

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
        !m.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX) &&
        !m.content.startsWith(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX)
    );
    if (!firstUser || !firstAssistant) return;
    const prompt = [
      "Generate a concise 3-6 word title for this conversation. Reply with the title only - no quotes, no trailing punctuation.",
      firstUser.content,
      firstAssistant.content,
    ].join("\n");
    const result = await completeWithWorkspaceModel(
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
/**
 * Prefix of the control message that follows a text-only round. The run does
 * not end until the model explicitly calls end_turn, so a plain reply is
 * followed by this nudge until the model finishes or the budget closes it.
 */
export const END_TURN_NUDGE_PREFIX = "[end-turn control]";

/**
 * Prefix of the control message that follows a round in which the agent
 * wrote substantial code itself without delegating to the coding
 * specialist. Regular users never ask for a sub-agent by name, so the loop
 * itself keeps the specialist in play: one nudge per run, only when the
 * agent's own code write shows it skipped code_task.
 */
export const CODER_NUDGE_PREFIX = "[coder control]";

/** File extensions whose content is real code the specialist should own. */
const CODE_FILE_EXTENSIONS = new Set([
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "rb", "php", "java", "kt",
  "swift", "go", "rs", "c", "h", "cpp", "hpp", "cs", "scala", "sh", "bash",
  "sql", "vue", "svelte", "html", "htm", "css", "scss", "less",
]);

/** True when the file name marks it as code (not notes, docs or data). */
export function isCodeFileName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return CODE_FILE_EXTENSIONS.has(name.slice(dot + 1).trim().toLowerCase());
}

/** A write this large is beyond the tiny tweak the agent may do itself. */
export function isSubstantialCode(content: string): boolean {
  return content.split("\n").length > 15 || content.length > 800;
}

/**
 * Prefix of the control message delivered once per run after a round whose
 * tool calls failed: the final reply must disclose what failed instead of
 * presenting the run as fully successful.
 */
export const FAILURE_NUDGE_PREFIX = "[failure control]";

/**
 * Prefix of the tool result that refuses a third execution of a call whose
 * exact name + arguments already failed twice in the same run.
 */
export const REPEATED_FAILURE_PREFIX = "[repeated-failure control]";

/** Builds the failure-disclosure nudge from the run's failed tool calls. */
export function failureNudgeFor(failedSteps: string[]): string {
  const list = failedSteps
    .slice(-5)
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");
  return `${FAILURE_NUDGE_PREFIX} These tool calls failed during this run:\n${list}\nKeep working only if you can address the actual cause shown in each failure text. Whatever happens next, your final reply MUST state plainly which of these steps failed (with the actual error text), which you recovered or worked around, and what actually got completed - never present the run as fully successful while any step is unresolved.`;
}

/** The coder-delegation nudge for a round that bypassed the specialist. */
export function coderNudgeFor(wroteName: string): string {
  return `${CODER_NUDGE_PREFIX} You just wrote ${wroteName} yourself without the coding specialist. Nova's code_task (Kimi K3) should produce non-trivial code - it returns better code than writing it directly, and the user is never asked which sub-agent to use. If the code you wrote is already complete, correct and verified, continue as you were. Otherwise, delegate the coding work to code_task with the full task description, the relevant existing code and any exact errors in context, and make sure the code ends up in the workspace - verify the files it wrote autonomously, or place its returned code with your file tools. If code_task reports the specialist is not configured (the Nova operator must set NVIDIA_NIM_API_KEY on the server), tell the user exactly that, ask whether to proceed with Nova's own attempt, and only write code yourself in a later turn after the user accepted and the accept_own_coding tool recorded it - never silently continue yourself.`;
}

const WORKSPACE_TOOLS: GatewayToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "end_turn",
      description:
        "End your turn and deliver the final reply. This is the ONLY way your turn ends: writing text without calling a tool does NOT finish the run. When everything the user asked for is complete, call end_turn with your complete final reply to the user in the 'reply' argument - the reply must disclose any step that failed during the run and was not recovered, with its actual error text. Mid-run notes to the user go through send_progress_update instead, and plain text answers keep the run going.",
      parameters: {
        type: "object",
        properties: {
          reply: {
            type: "string",
            description: "Your complete final reply to the user.",
          },
        },
        required: ["reply"],
      },
    },
  },
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
            description: "File name, id, or workspace path (e.g. \"folder-name/index.html\") to read.",
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
            description: "File name, id, or workspace path (e.g. \"folder-name/index.html\") to edit.",
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
          file: { type: "string", description: "File name, id, or workspace path (e.g. \"folder-name/index.html\") to rename." },
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
          file: { type: "string", description: "File name, id, or workspace path (e.g. \"folder-name/index.html\") to move." },
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
          file: { type: "string", description: "File name, id, or workspace path (e.g. \"folder-name/index.html\") to delete." },
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
        "Present a workspace file to the user over Telegram so they can view or download it: images are shown inline for viewing, other files arrive as a downloadable document. Use it when you create or meaningfully update a file the user asked for - over Telegram they cannot browse the workspace themselves. Only available on Telegram requests. Requires Telegram to be connected.",
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
      name: "set_communication_style",
      description:
        "Save the user's preferred communication style so every future reply follows it, across all chats and sessions. Use it whenever the user states or changes how they want you to communicate - e.g. 'keep replies short', 'be structured with headings', 'more conversational', 'always reply in French'. Distill their words into a concise style description (one or two sentences). Also call it with an empty style to clear the preference.",
      parameters: {
        type: "object",
        properties: {
          style: {
            type: "string",
            description: "Concise description of how the user wants you to communicate, e.g. 'Short, direct replies. No filler.' - or an empty string to clear the saved style.",
          },
        },
        required: ["style"],
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
        "Publish a chosen directory of the workspace as a live website on Netlify's free static hosting - always on, with SSL. The directory's contents become the site (its folder structure is kept relative to it) and its index.html is the entry page. You MUST deliberately choose which directory to deploy: the project or build-output folder that holds the site, not unrelated workspace files - pass '/' only when the site genuinely lives at the workspace root. You must also deliberately choose the deployment target: pass an existing deployment ID (e.g. 'd-01') to publish to that deployment - its URL never changes while the content updates - or omit it to create a brand-new deployment with its own ID and URL. Every deploy must also carry a short description of the deployment's purpose. NEVER overwrite one deployment's content by deploying a different project to it: iterate a site by its ID, and give a separate project its own new deployment. Anything static hosting serves publishes as-is: plain HTML/CSS/JS sites, React apps, statically exported Next.js projects, single-page apps, portfolios, and so on. A deploy can take up to a minute.",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description:
              "Workspace-relative directory to publish, e.g. 'my-react-app' or 'my-next-app/out'. Pass '/' for the workspace root. Its index.html becomes the entry page.",
          },
          deployment: {
            type: "string",
            description:
              "The ID of the existing deployment to publish to, e.g. 'd-01' (find the workspace's deployments with their IDs in the system prompt). Its URL stays the same. Omit to create a new deployment - never guess an ID.",
          },
          description: {
            type: "string",
            description:
              "A short description of what this deployment is, e.g. 'portfolio site' or 'bakery landing page'. Required on EVERY deploy_website call - it names the deployment's purpose and is kept in the workspace's deployment registry across chats. On a redeploy, pass the deployment's current description (or a corrected one when the purpose changed).",
          },
        },
        required: ["directory", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_website",
      description:
        "Delete one of the user's website deployments from Netlify - the URL goes offline immediately and this is irreversible (their workspace files are NOT touched). Use this whenever the user asks to delete, remove, unpublish, take down, or tear down their site, deployment, or live website. The deployment is chosen by its ID (e.g. 'd-01' - find the workspace's deployments with their IDs in the system prompt); when several deployments exist or the request is vague, show the user the deployment list and ask which one they mean first. all: true deletes every deployment, but it is gated: the first all: true call only returns the full target list and deletes nothing; execute the sweep by re-calling with confirm_all set to exactly the listed deployment IDs, and only once the user has explicitly confirmed deleting every deployment on it. Never call this unless the user clearly asked for a deletion.",
      parameters: {
        type: "object",
        properties: {
          deployment: {
            type: "string",
            description:
              "The ID of the deployment to delete, e.g. 'd-01'. Never guess an ID - it comes from the deployment list in the system prompt.",
          },
          all: {
            type: "boolean",
            description:
              "true targets every deployment this workspace has ever made, not one specific one. Default false.",
          },
          confirm_all: {
            type: "array",
            items: { type: "string" },
            description:
              "The confirmation for an all-deployments sweep: the deployment IDs exactly as the gated all: true response listed them. Anything else (empty, stale, partial, extra) leaves the sweep unexecuted.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project_template",
      description:
        "Scaffold a clean project in the workspace from a template: 'static' (plain HTML/CSS/JS site), 'react' (React single-page app that runs in the browser - no build step), or 'next' (Next.js App Router configured for static export; needs a VM build before deploying). The template lands in its own folder so deployments stay clean - deploy_website then publishes that folder (for 'next', its out/ build output). Use this when the user wants a new site or app started from scratch, or wants their project organized properly before going live. If the user did not ask for a specific stack, do not ask them - pick the best fit yourself and say which stack you chose.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Project name - becomes the folder name (e.g. 'My Portfolio' -> 'my-portfolio').",
          },
          template: {
            type: "string",
            enum: ["static", "react", "next"],
            description: "The project type to scaffold. If the user did not specify a stack, choose the best fit for their request: 'react' for web apps and interactive sites (the default), 'static' only for a genuinely simple single page or when the user explicitly wants plain HTML, 'next' when they explicitly want Next.js. Omitting it scaffolds 'react'.",
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
        "Search a connector catalog (GitHub or Gmail) and get the exact action slugs with their parameter schemas. Use this whenever you are unsure which action exists or what parameters it takes - never guess a slug or a parameter name, look it up here first. Requires the connector to be connected (Settings).",
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
        "Execute a GitHub or Gmail action on the user's behalf through the connector - e.g. list or star repositories, create issues, open pull requests; search, send or reply to Gmail; draft and manage emails. The action slug must come from list_connector_tools with exactly the parameters it declares. Requires the connector to be connected (Settings).",
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
      name: "solve_equation",
      description:
        "Solve a math equation exactly and return the numeric answer. Use this whenever the user asks to calculate, add, subtract, multiply, divide, convert, total, or any numbers appear in the answer - ALL arithmetic goes through this tool, never mental math. Express the problem as a single mathematical expression (e.g. '20 - (5*2 + 2*(2/3))' or 'sqrt(196) * 3.5'); word problems must be translated into an expression first.",
      parameters: {
        type: "object",
        properties: {
          equation: {
            type: "string",
            description: "A single mathematical expression to evaluate, e.g. '20 - 11.33' or 'sqrt(196) * 3.5'.",
          },
        },
        required: ["equation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_web",
      description:
        "Delegate deep research to Exa AI's deep research models. The chosen model fans out live web searches, reads and cross-checks the sources, and returns a research report with inline citations and a numbered source list. Use it for anything current or factual you do not know for certain. You MUST choose the difficulty yourself on every single call, estimating how deep the research needs to be before calling - never omit it, never default lazily. Say nothing about the choice unless asked.",
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
            description: "The research depth you estimate this question needs - decide deliberately every call. deep-lite (~10 seconds): a single factual lookup with one clear answer - current versions, prices, release dates, simple facts, definitions. deep: questions needing multiple searches or several sources synthesized - comparisons, how things work, market overviews, current events with context, anything with 2-3 facets. deep-reasoning: the deepest level - complex investigations with many facets, conflicting or hard-to-find evidence, technical analysis, forecasts, or multi-hop questions where the answer depends on other answers. Calibrate: most questions land on deep; only unambiguous single-fact lookups justify deep-lite; escalate to deep-reasoning when evidence conflicts or the question has 4+ facets.",
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
      name: "accept_own_coding",
      description:
        "Records that the user explicitly accepted Nova writing the code itself while the coding specialist is down. Call this ONLY when code_task failed in an EARLIER conversation turn AND the user's latest message clearly said yes to Nova's own attempt. It refuses inside the same run as the failure (the user must answer first), and while it has not succeeded, create_file and edit_file are blocked for non-trivial code.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "code_task",
      description:
        "Delegate a coding task to Nova's coding specialist sub-agent - a frontier coding model (Kimi K3) served through NVIDIA NIM. This is the default for ALL real code that needs to be written, refactored, explained, debugged or optimized: whole files, functions, components, scripts, algorithms, tricky bug fixes, sites and apps. Describe the task completely (goal, language, constraints) and include the relevant existing code or the exact error in context. The specialist works autonomously: it reads, writes and verifies the workspace files itself, and the files it writes are synced into the workspace before the result returns - so read the changed files it reports back, verify the work, and fix anything it left broken. Only when the result is bare code (no sandbox available) do you place it into the workspace with your file tools yourself. Never write non-trivial code directly with create_file or edit_file instead of delegating. Only skip it for tiny snippets you can write instantly (a one-line fix, a few lines of markup), shell commands, or math - use your own tools for those.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "The coding task, described completely: what to build or fix, in which language or framework, and any constraints.",
          },
          context: {
            type: "string",
            description: "Optional supporting material: existing code to extend or fix, the exact error output, file or API layouts the code must fit.",
          },
          language: {
            type: "string",
            description: "Optional explicit target language or framework, e.g. 'Python', 'React SPA', 'plain HTML/CSS/JS'.",
          },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_bash",
      description:
        "Run a bash command in the live workspace sandbox and get its exit code, stdout and stderr. The sandbox is awake for the whole run and its working directory is your workspace: the same files and folders the file tools operate on, plus anything bash creates (synced to durable storage automatically). Use it for quick shell work - ls, grep, wc, head, chmod, git, tar - and prefer it over run_vm_task for anything that does not need Python. No sudo; 120-second timeout.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to run, e.g. 'wc -l notes.txt' or 'grep -c TODO *.md'.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browse",
      description:
        "Drive a real headless Chrome browser in the workspace sandbox through the agent-browser CLI - open pages, read rendered text, click, fill forms, scroll, screenshot pages into workspace files, and take the accessibility snapshot with element refs. Give the agent-browser command WITHOUT the binary name, e.g. 'open https://example.com', 'snapshot', 'read', 'click @e2', 'fill @e3 \"test@example.com\"', 'screenshot page.png'. If the browser is not installed yet, the call starts a one-time background install and asks you to retry in about 2-3 minutes; once installed, calls are fast. Prefer research_web for deep open-ended research; use browse when you need to interact with a specific page.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The agent-browser command to run, without the binary, e.g. 'open https://example.com' or 'snapshot'.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_vm_task",
      description:
        "Run a Python 3 script in an isolated E2B sandbox VM with internet access and a 240-second limit. Use this whenever real computation is needed: the user asks to calculate or process data beyond simple arithmetic, run or test code, scrape or fetch from the web, or analyze, count, filter, sort, convert or extract content. This is the tool for real execution: installing and using packages (pip install, e.g. requests), scraping or browsing with HTTP libraries, processing data, or running shell commands via subprocess.run(['cmd','arg'], capture_output=True, text=True). It is NOT for workspace file management - use create_file / edit_file / read_file and the other dedicated tools for that; they are faster, safer, and sync instantly. Only reach for the VM when code actually needs to run. Always write complete Python code in `code` - `task` is just a short label for the run. The script sees the workspace's files under /home/user/workspace/input (each mounted with an id prefix, e.g. input/104-calc.py - the exact mounted paths are returned with every run result, so do not guess them) and should print() anything you want to report; workspace files changed or created during the run are synced back automatically.",
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
      (folderPathOf(folderRows, folder.parentId ?? null)?.toLowerCase() ?? "") === dir
  );
}

/** Normalizes a workspace reference the way a model might write it: a bare
 * name, an id, or a path like "folder-name/index.html" (optionally prefixed
 * with "./" or "/"). Returns lowercase, no leading/trailing slashes. */
function normalizeWorkspaceRef(raw: string): string {
  return raw.trim().replace(/^(?:\.?\/)+/, "").replace(/\/+$/, "").toLowerCase();
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
    workspaceRelativePathOf(folderRows, file.name, file.folderId)?.toLowerCase() ??
    file.name.toLowerCase()
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

import { deleteWorkspaceSite, deployWorkspaceSite, describeDeploymentsForUser } from "./siteDeploy";
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

const WORKSPACE_AGENT_PROMPT = `You are Nova, a fully autonomous operator of a private computer workspace. You do not wait to be told how - you decide how, then act.

You are a hybrid supervisor: a router that also does light work itself. Classification is the one thing a small model does best, so classify every request first. Simple requests - a greeting, a quick clarification, summarizing a short passage, recalling what was just said - you answer directly with your own knowledge: no tools, no delegation, zero added latency. Complex requests - anything involving real code, research, computation, files, outside services, or multi-step work - you route to the right tool or specialist and verify what comes back. Inside routed work you are still a thin reasoner, not an encyclopedia: your internal knowledge is spotty, your arithmetic is unreliable, and your recall over long context degrades, so never trust those faculties when a tool can carry the load. The tools hold the knowledge (research_web, connectors), the computation (solve_equation, run_vm_task, run_bash, code_task), and the memory (workspace files). You are the traffic cop; they are the engine.

Operating principles:
- Classify first. Triage every request before touching a tool: simple (a greeting, a quick clarification, summarizing a short passage, recalling the conversation) you answer directly - no tools, no round-trips, no latency. Complex (code, research, math, data work, files, outside services, multi-step tasks) you route to tools and specialists. Never turn a simple question into a tool parade, and never swallow a complex one with a one-line guess - the classification itself is your highest-value skill.
- Act first. When the user states a goal, complete it end-to-end in this turn: plan internally, call every tool the goal requires, verify the result, then report. Never reply with only a plan, instructions, or a question when tools could get the work done right now.
- Decide one action at a time. Do not plan and execute a long task in one giant leap: look at the latest tool result, choose the single next step, execute it, then look again. The run loop between your tool calls is your state machine - each tool result tells you where you are and what the next move is. End-to-end completion means chaining those single steps, not holding a 5-step plan in your head.
- Chain tools freely. Multi-step work is the norm: create folders before files, read before editing, verify after writing. Do not pause between steps to narrate or ask permission - the user sees your tool activity as it runs.
- Prefer dedicated tools. For workspace operations always use the purpose-built tool: create_file, edit_file, read_file, move_file, rename_file, delete_file, create_folder, and friends. Never fall back to the VM (shell, subprocess, echo, sed, heredocs) for work a dedicated tool can do - dedicated tools are instant, auditable, and sync to the workspace automatically. Reserve run_vm_task for genuine computation: running code, installing packages, network requests, data processing, browser automation. When a VM run does produce files you want to keep, copy them into the workspace with dedicated tools afterwards.
- Never do math or data work in your head. solve_equation evaluates a single math expression and returns the exact answer, so route every calculation through it - sums, percentages, discounts, date/day offsets involving numbers, unit conversions, anything numeric. Any real data work - counting, filtering, aggregating, sorting, converting, extracting or transforming content - goes through run_vm_task: write a short script, run it, read the output. Eyeballing numbers or transformations is the fastest way to give the user a confidently wrong answer; one tool call costs a fraction of a second.
- Your workspace sandbox is live while you work: it wakes automatically with every run and your files and folders are synced into it at /home/user/workspace. Use run_bash to run bash commands directly on it - ls, grep, wc, head, git, tar - its working directory is your workspace and its stdout and stderr come back to you. Anything bash or the VM creates there is synced back to your durable storage automatically. Prefer run_bash for quick shell work and reserve run_vm_task for Python, pip installs, and heavier compute.
- Use browse whenever you need a real browser: pages that render with JavaScript, logging in or filling forms, clicking through a UI, saving a page screenshot as a workspace file. Drive it like a person: 'open <url>' first, then 'snapshot' to get element refs (@e1, @e2...), act with 'click @e2' or 'fill @e3 "text"', then 'snapshot' again to see what changed, and 'read' for the rendered text of the current page. Chrome installs itself once per sandbox in the background (it usually finishes before you need it); if a browse call reports that the one-time install is still running, tell the user, wait about 2-3 minutes, and retry the same command - do not start another install. Screenshots saved into the workspace appear as regular workspace files. Keep research_web for deep multi-source research and browse for interacting with specific pages.
- Research before you guess. Use research_web to delegate anything current or factual you do not know for certain - it returns a full, cited research report from Exa AI's deep research models. Before every call, estimate how deep the research needs to be and pass that difficulty explicitly: deep-lite for single-fact lookups, deep for most questions, deep-reasoning for complex investigations with conflicting or multi-faceted evidence. Be deliberate - under-researching gives wrong answers, over-researching wastes the user's time. Use its findings, and cite the source URLs it provides for facts that came from them. Cited research beats a confident-sounding wrong answer. Treat your internal knowledge as amnesia: if a fact matters and you have not seen it in a tool result, search for it first - never answer a current or factual question from memory alone.
- Keep a notebook for long work. Long context is not reliable storage - do not carry a multi-step task's state in the conversation alone. When a task has more than a few steps, create or update a working note in the workspace (e.g. _notes/<task>.md) recording the goal, the key facts and decisions, and the progress after each meaningful step; read it back before resuming or whenever you lose the thread. Workspace files are your external memory, not just your deliverables.
- Coding goes through code_task - your coding specialist. Whenever the user wants code written, refactored, explained, debugged or optimized - whole files, functions, components, scripts, algorithms, sites, apps, tricky bugs - delegate it to code_task: describe the goal and constraints completely, include the relevant existing code or the exact error in context, and verify what it delivers: with the sandbox awake it works autonomously - its files are already in the workspace, so read the changed files back and check them; when it returns bare code instead, place it into the workspace with your file tools. This is mandatory, not optional: users never ask for a sub-agent by name, and the specialist (Kimi K3 on NVIDIA NIM) writes better code than you writing it directly. Never write non-trivial code yourself with create_file or edit_file - if it is more than a tiny tweak (a one-line fix, a few lines of markup, a small config change), it belongs to code_task. Write code yourself only when code_task reports the specialist is unavailable (then tell the user exactly that - a config problem means the Nova operator must set NVIDIA_NIM_API_KEY - ask whether to proceed with Nova's own attempt, and never silently substitute your own code for the specialist's; if you do proceed after the user accepted, say plainly the code is Nova's own work) or for genuinely trivial snippets of a few lines. Notes, documents and other non-code content are yours to write directly.
- Use connectors for outside services: GitHub for repositories, issues and pull requests; Gmail for reading, sending and replying to email. Connector tools are only available for services that are connected - current connections: {{connectors}}. When a service is not connected, do not attempt its connector tools; tell the user to open Settings and connect it first. When it is connected, search the exact action slug and its parameters with list_connector_tools (never guess them), then execute with use_connector_tool.
- Choose your collaboration level deliberately. Default to fully autonomous for routine, reversible work: pick sensible defaults (names, structure, wording, formatting), act end-to-end, and state each choice in one line. Switch to collaborative - pause and ask one focused question - when guessing has a real cost: irreversible or destructive actions beyond the literal request, personal taste you cannot know (like the wording of a message to someone else or creative direction), missing credentials or permissions only the user can provide, or no reasonable interpretation at all. Never ask permission for steps you can safely undo; never improvise steps you cannot.
- Publish websites with deploy_website - publishing is exclusively your ability (the web UI has no publish button). When the user wants their workspace, site, page, or app online (\"put this online\", \"go live\", \"host my site\", \"publish my portfolio\"), first make it deployable: it must be static (anything Netlify's static hosting serves) with an index.html at the root of the chosen directory. Then call deploy_website and deliberately choose the directory to publish - the project or build-output folder that holds the site, never a blind dump of unrelated workspace files; pass '/' only when the site genuinely lives at the workspace root. Every deployment has a stable ID (d-01, d-02, ...) and a short description kept in the workspace's deployment registry across chats. The description is a MUST on every deploy_website call - never call it without a description that names this deployment's purpose, so you and the user always know what each deployment is for. Targeting is deliberate and explicit: pass an existing deployment ID to publish to that deployment - its URL NEVER changes on update, and you must never deploy a different project to it - or omit the ID to create a new deployment, which gets its own ID, URL and a description you write in the same call. Never guess a deployment ID: the workspace's deployments are listed here with their IDs - {{deployments}}. When the user asks to update \"their site\" and several deployments exist, resolve which one by their description or ask; never silently overwrite one deployment's content with another project. Tell the user which URL is live, along with its deployment ID. Deploys can take up to a minute. If the tool reports that hosting is not configured yet (the operator must set NETLIFY_API_TOKEN on the server), tell the user exactly that.
- Take sites down with delete_website - unpublishing is exclusively your ability too. When the user asks to delete, remove, unpublish, or take down their site or deployment, call delete_website with the deployment's ID (from the deployment list above - never guess one). When several deployments exist or the request is vague, confirm which one they mean first. Deleting every deployment (all: true) is a two-step sweep: the first call only lists the target deployment IDs and deletes nothing - show the user that list and re-call with confirm_all set to exactly it, which you may do in the same turn only when they already explicitly asked to delete every deployment; otherwise wait for their explicit go-ahead first. Deletion is irreversible and the URL goes offline immediately - never improvise it, and tell the user plainly what went offline. Workspace files are never touched by a deletion, and a later deploy_website creates a fresh deployment with a new ID and URL.
- Start clean projects with create_project_template. When the user wants a new site or app, scaffold it instead of improvising loose files. If they did not specify a stack, choose the best fit yourself instead of asking - and mention the stack you chose. The default for web apps and sites is 'react', a React SPA that runs in the browser (React from a CDN, no build step); never improvise a default as loose HTML files. Use 'static' (a plain HTML/CSS/JS site) only when the user explicitly asks for plain HTML or wants a genuinely simple single page, and 'next' for a Next.js App Router project configured for static export. The template lands in its own project folder. For 'static' and 'react', deploy_website publishes the project folder directly; for 'next', run 'npm install && npm run build' in the project folder via run_vm_task first, copy the generated out/ files into the workspace with create_file, then deploy_website with the out folder as the directory. From there, edit and extend the project with your regular file tools and redeploy to the same deployment ID so its URL stays stable.
- Recover on your own. If a tool call fails or a name is missing, adapt: list the workspace, try an alternative, fix the input, and continue - but never repeat the identical failing call unchanged, the same outcome is guaranteed. When something is impossible with the tools available, say exactly what you would need to do it.
- Verify your work. After creating or editing, read back or otherwise confirm the outcome before claiming success.
- Report briefly, including failures. End multi-step work with a short summary of what changed (files created/edited/moved/deleted, messages sent, tasks run) - not a play-by-play - delivered through end_turn. Any step that failed during the run and was not fully recovered MUST be stated in that summary with its actual error text and what you did instead - a summary that hides a failed step is a false report of the work.
- End your turn ONLY with end_turn. Writing a reply without calling a tool does NOT end your turn - the run simply continues. When the work is complete, call end_turn with your complete final reply in its 'reply' argument; that is the only way the user receives your answer and the only way your turn finishes. While working, keep using tools; never write the final answer as plain text.
{{progress_updates}}
- Honor the user's communication style. When the user states or changes how they want you to communicate ("keep it short", "be more structured", "reply in Spanish"), save it immediately with set_communication_style - it persists across every chat and session, and appears above as their saved style. Apply it to every reply from then on.

Formatting: render replies in Markdown when it helps readability - **bold** or *italics* for emphasis, \`inline code\` for identifiers, fenced \`\`\` code blocks with a language tag, and bullet or numbered lists for steps. Keep formatting light in casual replies.

Workspace rules:
- Resolve files and folders by the exact names/ids listed below; if something is missing, list the workspace and act on what exists instead of guessing.
- edit_file replaces the file's entire content - read it first when unsure.
- Keep tool arguments exact and minimal.
- Invoke tools with real tool calls only - never write a tool call out as plain text (like {"name": ..., "parameters": ...}); the runtime only executes real tool calls.
- Never claim anything was created, edited, moved, deleted, or sent unless the tool results confirm it.
- Never expose secrets, tokens, credentials, or private data. Match the user's language when practical.

The user you are helping: {{user}}. Address them by that name or username naturally, and keep personalising your replies to them.
{{style}}
This request arrived via: {{channel}}.

Current folders: {{folders}}
Current files: {{files}}`;

type ToolExecution = {
  ok: boolean;
  result: string;
  action?: AgentAction;
  /** Full raw response surfaced in the research dropdown in the UI. */
  detail?: string;
  /**
   * Set when the coding specialist is confirmed unavailable (a non-config
   * error survived the internal retry, or NIM is not configured). The run
   * loop uses it to stop re-nudging toward code_task: with the specialist
   * down, self-coding is legitimate degraded mode - as long as the model
   * disclosed it to the user as the failure policy requires.
   */
  specialistDown?: boolean;
};

/**
 * Some models spell a tool call out as text instead of invoking it -
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
/** Formats a numeric mathjs result for the agent: clean integers, readable decimals. */
function formatMathAnswer(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // Round long floats to 6 decimal places, trimming trailing zeros.
  return String(Math.round(value * 1e6) / 1e6);
}

/**
 * Unwraps an error chain into one diagnostic line. Drizzle's query errors say
 * only "Failed query: <sql> params: ..." while the actual database error
 * (missing column, timeout, terminated connection) lives on `error.cause` -
 * without the cause, a failed query cannot be diagnosed from the chat.
 */
function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 4; depth += 1) {
    const message = current.message.trim();
    if (message && !parts.includes(message)) parts.push(message);
    current = (current as Error & { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

/**
 * The specialist-down self-coding gate, threaded through a run. `blocked`
 * forbids non-trivial create_file/edit_file writes; the accept tool lifts it
 * only in a LATER conversation turn, never in the run where code_task failed.
 */
type OwnCodingGate = {
  chatId: number;
  /** True while the user has not yet accepted Nova's own coding. */
  blocked: boolean;
  /** True when this run started with a pending acceptance question. */
  awaitingAcceptance: boolean;
  /** True when code_task failed inside this same run. */
  specialistDownThisRun: boolean;
};

const SPECIALIST_DOWN_BLOCK_RESULT =
  "Blocked: the coding specialist is down and the user has not accepted Nova's own coding yet. " +
  "Do NOT write this code yourself. Tell the user exactly that the coding specialist is down for this task, " +
  "ask whether to proceed with Nova's own attempt, and end your turn. Only in a later conversation turn, " +
  "once the user has explicitly accepted, call the accept_own_coding tool to record it - then you may write " +
  "the code yourself, saying plainly it is Nova's own work without the specialist.";

async function executeWorkspaceTool(
  ownerId: number,
  computer: Computer,
  call: GatewayToolCall,
  onProgress?: (detail: string) => void,
  sandbox?: E2BSandboxLike,
  gate?: OwnCodingGate,
  channel?: "telegram" | "web",
  deadlineAtMs?: number
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
  // Sandbox-first execution: the workspace sandbox (woken at run start) is
  // the live execution surface, and the durable Neon/S3 store syncs from it.
  // Every mutating file/folder operation is mirrored onto the sandbox
  // filesystem; a mirror failure is logged but never blocks the durable op.
  const folderRows = computer.folders as Array<{ id: number; name: string; parentId: number | null }>;
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
        args.folder !== undefined ? resolveFolder(computer, args.folder) : undefined;
      if (args.folder !== undefined && !targetFolder)
        return { ok: false, result: `Folder not found: ${str(args.folder)}. Use list_workspace to see every folder.` };
      if (
        computer.files.some(
          file =>
            (file.folderId ?? null) === (targetFolder?.id ?? null) &&
            file.name.toLowerCase() === name.toLowerCase()
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
          action: { kind: "tool", name: `create_file: ${name}`, operation: "failed" },
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
        await mirror({ kind: "write_file", path: createdPath, content: str(args.content) });
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
      if (
        gate?.blocked &&
        isCodeFileName(file.name) &&
        isSubstantialCode(content)
      ) {
        return {
          ok: false,
          result: SPECIALIST_DOWN_BLOCK_RESULT,
          action: { kind: "tool", name: `edit_file: ${file.name}`, operation: "failed" },
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
        computer.files.some(
          other =>
            other.id !== file.id &&
            (other.folderId ?? null) === (file.folderId ?? null) &&
            other.name.toLowerCase() === newName.toLowerCase()
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
      const renameFrom = workspaceRelativePathOf(folderRows, file.name, file.folderId ?? null);
      const renameTo = workspaceRelativePathOf(folderRows, newName, file.folderId ?? null);
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
      if (!folder)
        return { ok: false, result: `Folder not found: ${str(args.folder)}. Use list_workspace to see every folder.` };
      if (
        computer.files.some(
          other =>
            other.id !== file.id &&
            (other.folderId ?? null) === folder.id &&
            other.name.toLowerCase() === file.name.toLowerCase()
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
      const moveFrom = workspaceRelativePathOf(folderRows, file.name, file.folderId ?? null);
      const parentPath = folderPathOf(folderRows, folder.id);
      const moveTo = moveFrom && parentPath ? `${parentPath}/${moveFrom.split("/").pop()}` : null;
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
      const deletedPath = workspaceRelativePathOf(folderRows, file.name, file.folderId ?? null);
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
        return {
          ok: false,
          result: `Parent folder not found: ${str(args.parent)}.`,
        };
      // Same-name siblings created ambiguity the agent cannot see: a later
      // create_file by folder name resolves to whichever folder came first,
      // so a workspace ends up with two same-named folders. Refuse up front.
      if (
        folderRows.some(
          folder =>
            (folder.parentId ?? null) === (parent?.id ?? null) &&
            folder.name.toLowerCase() === name.toLowerCase()
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
      const newFolderPath = parentPath ? `${parentPath}/${created.name}` : created.name;
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
      if (!folder)
        return { ok: false, result: `Folder not found: ${str(args.folder)}. Use list_workspace to see every folder.` };
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
      const folderRenameParent = folderPathOf(folderRows, folder.parentId ?? null);
      const folderRenameTo = folderRenameFrom
        ? folderRenameParent
          ? `${folderRenameParent}/${newName}`
          : newName
        : null;
      if (folderRenameFrom && folderRenameTo)
        await mirror({ kind: "move_path", from: folderRenameFrom, to: folderRenameTo });
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
        return { ok: false, result: `Folder not found: ${str(args.folder)}. Use list_workspace to see every folder.` };
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
      const folderMoveFrom = folderPathOf(folderRows, folder.id);
      const folderMoveParent = folderPathOf(folderRows, parent.id);
      const folderMoveTo =
        folderMoveFrom && folderMoveParent
          ? `${folderMoveParent}/${folderMoveFrom.split("/").pop()}`
          : null;
      if (folderMoveFrom && folderMoveTo)
        await mirror({ kind: "move_path", from: folderMoveFrom, to: folderMoveTo });
      return {
        ok: true,
        result: `Moved ${folder.name} into ${parent.name}.`,
        action: { kind: "folder", name: folder.name, operation: "moved" },
      };
    }
    case "delete_folder": {
      const folder = resolveFolder(computer, args.folder);
      if (!folder)
        return { ok: false, result: `Folder not found: ${str(args.folder)}. Use list_workspace to see every folder.` };
      if (!(await deleteWorkspaceFolderForUser(ownerId, folder.id)))
        return { ok: false, result: `Could not delete ${folder.name}.` };
      const removedFolderPath = folderPathOf(folderRows, folder.id);
      if (removedFolderPath) await mirror({ kind: "delete_folder", path: removedFolderPath });
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
        { deployment: deploymentKey || undefined, description: description || undefined }
      );
      if (!outcome.ok)
        return {
          ok: false,
          result: `The website was not deployed: ${outcome.message}`,
          action: { kind: "deployment", name: "", operation: "failed" },
        };
      const fileCount = outcome.deployment.fileCount;
      const fromLine = directory === "/" ? "the workspace root" : `/${directory}`;
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
      const confirmAll = Array.isArray(args.confirm_all) ? args.confirm_all.map(key => String(key)) : undefined;
      const outcome = await deleteWorkspaceSite(
        ownerId,
        { deployment: deploymentKey || undefined, all: deleteAll, confirmAll }
      );
      if (!outcome.ok && "confirmationRequired" in outcome) {
        // The sweep gate fired: nothing was deleted. Hand the model the exact
        // target list so it can confirm with the user and re-call bound to it.
        return {
          ok: true,
          result: `Nothing was deleted yet - deleting every deployment is irreversible and needs explicit confirmation. ${outcome.message}`,
          action: { kind: "deployment", name: outcome.targets.map(t => t.key).join(", "), operation: "presented" },
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
      const failedNote = outcome.failed > 0 ? ` (${outcome.failed} other deployment${outcome.failed === 1 ? "" : "s"} failed to delete - check the deployment history)` : "";
      return {
        ok: true,
        result: `Deleted ${outcome.deleted.length === 1 ? `deployment ${listed}` : `${outcome.deleted.length} deployments: ${listed}`}. The URL${outcome.deleted.length === 1 ? " is" : "s are"} offline and the deletion is irreversible - but every workspace file is untouched, and a new deploy_website creates a fresh deployment with a new ID and URL. Tell the user plainly what went offline.${failedNote}`,
        action: { kind: "deployment", name: outcome.deleted.map(entry => entry.siteUrl).join(", "), operation: "deleted" },
      };
    }
    case "create_project_template": {
      const rawName = str(args.name);
      if (!rawName) return { ok: false, result: "A project name is required." };
      // No stack specified: the model decides, but if it omitted the template
      // entirely, scaffold the default stack - a real React project, not a
      // loose HTML file.
      const template = str(args.template).trim() === "" ? "react" : args.template;
      if (!isProjectTemplateKey(template))
        return {
          ok: false,
          result: `Unknown template: ${str(args.template)}. Supported templates: ${PROJECT_TEMPLATE_KEYS.join(", ")}.`,
        };
      const projectName = slugifyProjectName(rawName);
      const rendered = renderProjectTemplate(template, rawName);

      // Project folder at the workspace root - reuse it if it already exists.
      const existingProject = computer.folders.find(
        folder => folder.parentId === null && folder.name.toLowerCase() === projectName.toLowerCase()
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
            file => file.folderId != null && staleDescendantIds.has(file.folderId)
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
            result: `Could not create ${file.path} in the ${projectName} folder - a file with that name may already exist.`,
          };
        createdPaths.push(file.path);
      }

      const deployDirectory =
        rendered.deployRoot === "." ? projectName : `${projectName}/${rendered.deployRoot}`;
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
      if (!text) return { ok: false, result: "A progress note text is required." };
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
            return `${tool.slug} - ${tool.description}${params ? ` Parameters: ${params}` : ""}`;
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
    case "solve_equation": {
      const equation = str(args.equation).trim();
      if (!equation)
        return { ok: false, result: "An equation to solve is required." };
      try {
        const answer = evaluate(equation);
        if (answer === undefined || answer === null || (typeof answer === "number" && !Number.isFinite(answer)))
          return {
            ok: false,
            result: `That expression does not evaluate to a number (got: ${String(answer)}). Pass a single numeric expression like '20 - 11.33'.`,
            action: { kind: "tool", name: equation.slice(0, 60), operation: "failed" },
          };
        const formatted = typeof answer === "number" ? formatMathAnswer(answer) : String(answer);
        return {
          ok: true,
          result: `${equation} = ${formatted}`,
          detail: `${equation} = ${formatted}`,
          action: { kind: "tool", name: equation.slice(0, 60), operation: "completed" },
        };
      } catch (error) {
        return {
          ok: false,
          result: `Could not evaluate '${equation}': ${error instanceof Error ? error.message : "invalid expression"}. Pass a single numeric expression like '20 - 11.33' or 'sqrt(196) * 3.5'.`,
          action: { kind: "tool", name: equation.slice(0, 60), operation: "failed" },
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
        const research = await runResearch(topic, difficulty, instructions, note);
        const sourcesBlock = research.sources.length
          ? `\n\nAll sources consulted by the researcher:\n${research.sources
              .map((source, index) => `${index + 1}. ${source.title || source.url} - ${source.url}`)
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
    case "accept_own_coding": {
      if (!gate) {
        return {
          ok: false,
          result: "There is no pending coding-specialist acceptance question - continue normally.",
        };
      }
      if (gate.specialistDownThisRun) {
        return {
          ok: false,
          result:
            "The coding specialist failed in this same run, so the user has not had a turn to answer yet. " +
            "Tell the user the specialist is down, ask whether to proceed with Nova's own attempt, and end your turn. " +
            "Only call accept_own_coding in a later conversation turn, after the user explicitly accepted.",
          action: { kind: "tool", name: "accept_own_coding", operation: "failed" },
        };
      }
      if (!gate.awaitingAcceptance) {
        return {
          ok: false,
          result:
            "There is no pending coding-specialist acceptance question. Only call this tool when the user has just " +
            "explicitly accepted Nova writing the code itself while the specialist is down.",
          action: { kind: "tool", name: "accept_own_coding", operation: "failed" },
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
        action: { kind: "tool", name: "accept_own_coding", operation: "completed" },
      };
    }
    case "code_task": {
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
            onProgress(`The coding specialist is still working - ${elapsed}s elapsed…`);
          }, 10000)
        : undefined;
      note(
        sandbox
          ? "The coding specialist is taking over the task - reading the workspace on its own…"
          : "The coding specialist is reading the task…"
      );
      const specialistError = (error: unknown) =>
        `The coding specialist failed: ${error instanceof Error ? error.message : "unknown error"}.`;
      const runSpecialist = (): Promise<CoderOutcome> =>
        sandbox
          ? runAutonomousCoderTask({ task, context, language, sandbox, onProgress: note, deadlineAtMs })
          : runCoderTask(task, context, language).then(result => ({ kind: "single", ...result }));
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
          // silently hand-writing the code itself.
          note("The coding specialist hit a snag - retrying once…");
          await new Promise(resolve => setTimeout(resolve, 1500));
          outcome = await runSpecialist();
        }
        if (outcome.kind === "single") {
          return {
            ok: true,
            result: outcome.code,
            detail: outcome.code.slice(0, 16000),
            action: { kind: "tool", name: `code_task: ${task.slice(0, 45)}`, operation: "completed" },
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
        const fileList = outcome.writtenPaths.length > 0 ? outcome.writtenPaths.join(", ") : "(none)";
        return {
          ok: true,
          result:
            `The coding specialist worked autonomously in the sandbox. Its summary: ${outcome.summary}\n\n` +
            `Files it wrote: ${fileList}. Read the changed files back from the workspace, verify the work actually meets the task, fix anything it left broken, and present the result to the user. If a changed file is missing from the workspace, say so plainly instead of improvising it.`,
          detail: `${outcome.summary}\n\nFiles written: ${fileList}`.slice(0, 16000),
          action: { kind: "tool", name: `code_task: ${task.slice(0, 45)}`, operation: "completed" },
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
            `If the user wants to wait instead, tell them the Nova operator should check NVIDIA_NIM_API_KEY on the server.`,
          detail: message,
          specialistDown: true,
          action: { kind: "tool", name: `code_task: ${task.slice(0, 45)}`, operation: "failed" },
        };
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    }
    case "run_bash": {
      const command = str(args.command);
      if (!command)
        return { ok: false, result: "A bash command is required." };
      if (!sandbox)
        return {
          ok: false,
          result:
            "The workspace sandbox is not available right now - it either failed to wake or the server's E2B_API_KEY is not configured. Use run_vm_task for shell work instead, and tell the user if the sandbox needs the E2B key.",
          action: { kind: "vm", name: "bash", operation: "disabled" },
        };
      const bash = await runBashOnSandbox(sandbox, command);
      return {
        ok: bash.ok,
        result: bash.result,
        detail: bash.result.slice(0, 16000),
        action: { kind: "vm", name: "bash", operation: bash.ok ? "completed" : "failed" },
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
            "The workspace sandbox is not available right now - it either failed to wake or the server's E2B_API_KEY is not configured, and the browser runs inside that sandbox. Tell the user if the sandbox needs the E2B key.",
          action: { kind: "browser", name: "browser", operation: "disabled" },
        };
      const browse = await runBrowserCommand(sandbox, command);
      return {
        ok: browse.ok,
        result: browse.result,
        detail: browse.result.slice(0, 16000),
        action: {
          kind: "browser",
          name: command.trim().replace(/^agent-browser\s+/, "").split(/\s+/)[0].slice(0, 45) || "browser",
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

function toolSummary(call: GatewayToolCall, execution: ToolExecution) {
  const action = execution.action;
  if (!action) return call.name;
  if (action.kind === "tool")
    return `${action.operation === "failed" ? "Failed solving" : "Solved"}: ${action.name}.`;
  if (action.kind === "vm" && action.name === "bash")
    return `${action.operation === "failed" ? "Failed running" : "Ran"} a bash command in the sandbox.`;
  if (action.kind === "browser")
    return `${action.operation === "failed" ? "Failed running" : "Ran"} a browser command: ${action.name}.`;
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
 * Mistral AI applies per-tier rate limits (requests per second plus token
 * budgets), and a 429 lockout can persist for a while - every request sent
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
    /** Model override for this round (e.g. the vision model on image turns). */
    model?: string;
    onChunk?: (chunk: string) => void;
    /** Streams the model's private reasoning (reasoning_content) if present. */
    onReasoning?: (chunk: string) => void;
    signal?: AbortSignal;
    /** Run deadline (epoch ms) - the patient rate-limit wait must fit. */
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
      return await chatWithWorkspaceModel(ownerId, messages, {
        tools: options.tools,
        ...(options.model ? { model: options.model } : {}),
        ...(options.onReasoning ? { onReasoning: options.onReasoning } : {}),
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
        error instanceof MistralGatewayClientError &&
        GATEWAY_RETRY_KINDS.has(error.kind);
      // Upstream 429: one patient retry, deadline-gated, once per run. The
      // fast loop must never hammer a lockout - that only extends it.
      const isUpstreamRateLimit =
        error instanceof MistralGatewayClientError && error.kind === "rate_limit";
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
 * Runs the workspace agent for a message: a tool-calling loop over the Mistral
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
  // Summaries of the tool calls in the current round - they brief the model
  // on the closing reply when the run runs out of time before the final round.
  let lastRoundSummaries: string[] = [];
  // The run ends ONLY when the model calls end_turn. A text-only round is
  // kept as the running draft reply and nudged, so the final answer is never
  // lost if the model forgets the explicit end. The chars companion records
  // how much of that draft already streamed to the client.
  let draftReply = "";
  let draftStreamedChars = 0;
  let endTurnCalled = false;
  /**
   * Closing reply for a run that hits its time budget: the last round's
   * completed tool summaries brief the model that writes it, so the user still
   * hears where things
   * stand, and naming the step that was cut short - skipped or interrupted -
   * instead of counting it among the completed work.
   */
  /** The closing status when the run budget runs out is written by the model
   * - honest, specific, in Nova's own words. There is deliberately no canned
   * fallback: if the gateway will not answer in time, the run falls through
   * to the ordinary empty-reply handling instead of pretending with template
   * text. The race cap keeps the closing reply inside the request budget. */
  const composeDeadlineClose = async (
    unfinishedTool: string | null = null,
    unfinishedToolStarted = true
  ): Promise<string> => {
    const summaries = lastRoundSummaries.map(summary => `- ${summary}`).join("\n");
    try {
      const completion = await Promise.race([
        completeWithWorkspaceModel(
          ownerId,
          `You are Nova, an AI assistant working inside the user's personal cloud workspace. You just hit the end of the time you may spend on this single message; your work so far stops here but the conversation continues.

Completed steps:
${summaries || "(none recorded yet)"}
${unfinishedTool ? `\nThe \`${unfinishedTool}\` step was ${unfinishedToolStarted ? "still running when time ran out and was interrupted, not finished" : "skipped because time ran out before it could start"}.` : ""}

${options.continuationPlanned
        ? `Write a short progress status (2-4 sentences): what got done so far and what is still left. The work continues automatically in a few seconds without any user action. Do not ask the user to reply or wait, and do not mention time budgets, segments, or limits. Output only that message.`
        : `Write a short, honest status message to the user (2-4 sentences): what got done, what is unfinished, and that they can send "continue" so you pick up exactly where you left off. Output only that message.`}`
        ).catch(() => null),
        waitFor(DEADLINE_CLOSE_MODEL_CAP_MS),
      ]) as { text?: unknown } | null | undefined;
      const text = typeof completion?.text === "string" ? completion.text.trim() : "";
      return text && text.length <= 800 ? text : "";
    } catch {
      return "";
    }
  };
  // Everything streamed to the client during this run - needed by the catch
  // below to keep the partial reply when the gateway fails mid-run.
  let streamedRunText = "";
  // Failure disclosure: every failed tool call of the run, and how many
  // times each exact call (name + arguments) has failed. Declared outside
  // the try so the catch can still disclose them. The list feeds the
  // one-per-run failure nudge and the error-path close-out note; the map
  // intercepts a model stuck repeating an identical failing call.
  const failedSteps: string[] = [];
  const failedAttempts = new Map<string, { count: number; firstFailure: string }>();
  let failureNudgeSent = false;

  await appendChatMessageForUser(ownerId, { chatId, role: "user", content });

  // The workspace sandbox wakes with every run: state is shared with the
  // finally block below, which syncs the live sandbox filesystem back into
  // the durable Neon/S3 store no matter how the run ends.
  let agentSandbox: E2BSandboxLike | undefined;
  let sandboxWorkspaceId: number | undefined;

  try {
    // A workspace with its own provider (BYOK) never depends on the built-in
    // gateway, so its health flags do not gate the run.
    const customModel = await getActiveCustomModel(ownerId);
    if (!customModel) {
    const status = await getMistralGatewayStatus(ownerId);
    if (!status.configured) {
      const reply =
        "Mistral inference is not configured. An administrator must set up the server-only gateway connection before chat is available.";
      await options.onChunk?.(reply);
      const message = await persistAssistant(reply);
      return { message, actions: [], outOfBudget: false };
    }
    if (
      !status.reachable ||
      (status.providerConfigurationKnown && !status.providerConfigured)
    ) {
      const reply =
        "Mistral inference gateway is temporarily unreachable. Please try again shortly.";
      await options.onChunk?.(reply);
      const message = await persistAssistant(reply);
      return { message, actions: [], outOfBudget: false };
    }
    if (status.allowance.exhausted) {
      const reply = `Mistral inference request allowance is exhausted (${status.allowance.usedRequests}/${status.allowance.maxRequests} requests used). Please try again later or contact an administrator to raise the cap.`;
      await options.onChunk?.(reply);
      const message = await persistAssistant(reply);
      return { message, actions: [], outOfBudget: false };
    }
    }

    let computer = await getWorkspaceComputer(ownerId);
    // The sandbox wakes before the first tool runs: the durable store's files
    // and folders sync into it, every file/folder tool mirrors onto it, and
    // bash commands execute on it directly. A failed wake degrades the run to
    // direct database tools instead of breaking it.
    sandboxWorkspaceId = computer.workspace.id;
    agentSandbox = await prepareAgentSandbox(ownerId, computer);
    if (agentSandbox) {
      // Fire-and-forget: start the one-time browser install (if the sandbox
      // has not done it yet) so Chrome is usually ready before browse is
      // first needed. It runs detached in the sandbox and never blocks.
      void warmBrowserInBackground(agentSandbox);
      await emitTool({
        id: "sandbox-wake",
        name: "wake_sandbox",
        state: "completed",
        args: {},
        summary: "Woke the workspace sandbox and synced the files into it.",
      });
    }
    const connectedConnectors = await getConnectedConnectorToolkits(ownerId);
    const identity = await getUserIdentityForUser(ownerId);
    const communicationStyle = await getCommunicationStyleForUser(ownerId);
    // The deployment registry - every site's ID, URL and description - rides
    // along in the system prompt so targeting deployments stays explicit
    // across every chat.
    const deploymentsLine = await describeDeploymentsForUser(ownerId);
    const userLine = identity.username
      ? `@${identity.username}${identity.name ? ` (${identity.name})` : ""}`
      : identity.name || identity.email || "the user";
    // present_file and send_progress_update are Telegram-only: over Telegram
    // the user sees none of the tool activity, so interim notes are needed -
    // in the web app the user watches the tool activity live, and offering
    // the tool there only produces stray Telegram pings.
    const agentTools = workspaceToolsForConnectors(connectedConnectors).filter(
      tool =>
        options.channel === "telegram" ||
        (tool.function.name !== "present_file" && tool.function.name !== "send_progress_update")
    );
    const systemMessage = (): GatewayChatMessage => {
      const { folders, files } = describeWorkspace(computer);
      return {
        role: "system",
        content: WORKSPACE_AGENT_PROMPT.replace("{{folders}}", folders).replace(
          "{{files}}",
          files
        ).replace("{{connectors}}", connectorStatusLine(connectedConnectors))
          .replace("{{deployments}}", deploymentsLine)
          .replace(
            "{{style}}",
            communicationStyle
              ? `The user's saved preferred communication style: "${communicationStyle}" - follow it in every reply.`
              : ""
          )
          .replace("{{user}}", userLine)
          .replace(
            "{{channel}}",
            options.channel === "telegram"
              ? "Telegram - the user only sees the messages you send, not your tool activity. Telegram renders plain text only: never use markdown formatting of any kind (no headings, bold, italics, strikethrough, code blocks, tables, or [label](url) links) - write plain sentences, paste raw URLs, and use plain hyphens or numbers when a list helps"
              : "the Nova web app - the user sees your tool activity live as you work"
          )
          .replace(
            "{{progress_updates}}",
            options.channel === "telegram"
              ? `- Keep the user posted on Telegram, and own the ETA while you work. Over Telegram the user sees only the messages you send - none of your tool activity. No confirmation is sent for you automatically anymore: when the task will take more than a few seconds, your first send_progress_update should be a brief acknowledgment with an honest time estimate, then go straight to work - but for a quick question or greeting, just answer it directly. From then on the estimate is yours to maintain: keep sending short updates at a steady rhythm as you work - after each meaningful step completes, and never let more than a minute or so pass in silence on a long run - and whenever reality diverges from your estimate, say so and send the revised range ("taking longer than expected - about 2 more minutes", "nearly there, ~20 seconds"). Tell the user immediately when you hit a blocker - saying whether you are solving it yourself or need something from them - and whether it changes the ETA. Use send_progress_update for every note, keep each one brief, and never send a "done" summary until the work actually is done. When you create or meaningfully update a file the user asked for, present it with present_file so they can view or download it right in the chat.`
              : "- In the web app the user watches your tool activity live as you work, so skip interim progress notes and just do the work - send_progress_update and present_file are Telegram-only and are not available here. Tell the user about a blocker or a revised expectation in your final reply instead of pinging mid-run, and deliver the finished work with end_turn as usual."
          ),
      };
    };

    const imageParts = (options.imageAttachments ?? []).filter(uri =>
      uri.startsWith("data:image/")
    );
    let visionActive = imageParts.length > 0;
    const currentTurn: GatewayChatMessage = {
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
    };
    /**
     * Give the model the conversation so far. Without this, every incoming
     * message started a brand-new chat from the model's point of view - no
     * memory of anything said a moment earlier, only whatever it could infer
     * by re-reading the workspace. The current turn's user message was
     * already persisted above, so history already ends with it as the last
     * row; that last row is swapped out below for the vision-aware version
     * when images are attached. Tool-activity rows are internal bookkeeping
     * (raw JSON, re-emitted per state change) and are never real turns, so
     * they're filtered out; the count is capped so very long chats don't
     * blow the model's context window.
     */
    const MAX_HISTORY_MESSAGES = 60;
    const priorMessages = (await listChatMessagesForUser(ownerId, chatId)) ?? [];
    const historyTurns: GatewayChatMessage[] = priorMessages
      .filter(
        m =>
          !m.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX) &&
          !m.content.startsWith(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX)
      )
      .slice(-MAX_HISTORY_MESSAGES)
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    if (historyTurns.length) historyTurns[historyTurns.length - 1] = currentTurn;
    else historyTurns.push(currentTurn);
    const messages: GatewayChatMessage[] = [systemMessage(), ...historyTurns];

    // /stop support: a stop request recorded after the run started aborts the
    // run at the next safe point (round boundary or between tool calls).
    const runStartedAt = await getDatabaseTime();
    const stopRun = async () => {
      const stoppedReply = "⏹️ Stopped - this run was cancelled with /stop.";
      await options.onChunk?.(stoppedReply);
      const message = await persistAssistant(stoppedReply);
      return { message, actions: [], outOfBudget: false };
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
    // Coder-delegation guard: one nudge per run when the agent writes
    // substantial code itself without ever calling code_task.
    let codeTaskUsed = false;
    let coderNudgeSent = false;
    let specialistDown = false;
    let coderNudgePending = false;
    let coderNudgeFile = "";
    // Specialist-down self-coding gate: a run that ends with code_task down
    // leaves a pending acceptance marker; until the user accepts in a LATER
    // turn (recorded via accept_own_coding), non-trivial create_file and
    // edit_file calls are blocked by the tool executor itself.
    const ownCodingGate: OwnCodingGate = {
      chatId,
      blocked: false,
      awaitingAcceptance: false,
      specialistDownThisRun: false,
    };
    const priorAcceptance = await readSpecialistAcceptance(ownerId, chatId);
    if (priorAcceptance === "pending") {
      ownCodingGate.blocked = true;
      ownCodingGate.awaitingAcceptance = true;
    }
    // Set when a tool call outlasts the deadline mid-round: the round loop
    // must stop without refreshing state or starting another gateway round.
    let closedByDeadline = false;
    for (let round = 0; ; round += 1) {
      if (round > 0 && (await hasAgentStopAfter(ownerId, runStartedAt))) return stopRun();
      // A deploy or long research can consume nearly the whole request
      // budget. Starting another gateway round this close to the maxDuration
      // limit risks the function being killed before the reply persists -
      // close the run with a model-written status instead.
      if (round > 0 && Date.now() + FINAL_ROUND_MIN_REMAINING_MS > deadlineAtMs) {
        reply = await composeDeadlineClose();
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
      // Chat turns that still carry image parts go to the configured vision
      // model (Z.ai: glm-4.6v-flash) instead of the text default, so the
      // images are actually seen rather than dropped. Once visionActive is
      // cleared by the no-vision recovery path below, rounds run on the
      // default chat model again.
      const visionModel = configuredVisionChatModel();
      // This round's thinking block: reasoning-capable models stream their
      // private reasoning (reasoning_content) before the answer or tool
      // calls. It surfaces live as a collapsible "Thinking" block via the
      // tool-activity pipeline (persisted like any activity, so a page
      // reload replays it), and closes when the round settles.
      let reasoningThisRound = "";
      let reasoningEmittedChars = 0;
      let reasoningLastEmitAt = 0;
      // Serialize the emissions for this round's thinking block: each update
      // chains after the previous one, so a slow "running" persist can never
      // land after the final "completed" state and regress the activity.
      let thinkingEmissions: Promise<unknown> = Promise.resolve();
      const flushThinking = (state: "running" | "completed") => {
        if (!reasoningThisRound) return;
        if (state === "running") {
          const now = Date.now();
          if (
            now - reasoningLastEmitAt < THINKING_EMIT_INTERVAL_MS ||
            reasoningThisRound.length - reasoningEmittedChars <
              THINKING_MIN_DELTA_CHARS
          )
            return;
          reasoningLastEmitAt = now;
        }
        reasoningEmittedChars = reasoningThisRound.length;
        thinkingEmissions = thinkingEmissions.then(() =>
          emitTool({
            id: `thinking-${round}`,
            name: "thinking",
            state,
            args: {},
            detail: reasoningThisRound.slice(0, THINKING_DETAIL_LIMIT),
            ...(state === "completed"
              ? { summary: "The model's thinking for this step." }
              : {}),
          })
        );
      };
      const onReasoning = (chunk: string) => {
        reasoningThisRound += chunk;
        flushThinking("running");
      };
      const runChatRound = () =>
        chatWithGatewayRetry(ownerId, messages, {
          tools: agentTools,
          ...(visionActive && visionModel ? { model: visionModel } : {}),
          ...(emitChunk ? { onChunk: emitChunk } : {}),
          onReasoning,
          signal: stopController.signal,
          deadlineAtMs,
          retryState,
        });
      // Rounds after the first are raced against the deadline: a slow LLM
      // round can take up to the client's own 120s timeout, which used to
      // run past the budget between the round-level checks until Vercel
      // killed the whole task with no reply. Round 0 is bounded by the
      // gateway client's own request timeouts and may still need to run
      // with a nearly-expired budget so its tool calls can be skipped and
      // reported rather than vanishing.
      try {
        // Round 0 with the budget already gone still runs directly so its
        // tool calls can be reported as skipped; otherwise every round is
        // raced, bounding slow or retrying gateway rounds by the deadline.
        result =
          round === 0 && deadlineAtMs - Date.now() <= 0
            ? await runChatRound()
            : await raceToolDeadline(runChatRound, deadlineAtMs);
      } catch (error) {
        if (error instanceof RunDeadlineExceeded) {
          flushThinking("completed");
          await thinkingEmissions;
          reply = await composeDeadlineClose();
          streamedReplyChars = 0;
          closedByDeadline = true;
          break;
        }
        if (
          stopController.signal.aborted &&
          (await hasAgentStopAfter(ownerId, runStartedAt))
        ) {
          flushThinking("completed");
          await thinkingEmissions;
          return stopRun();
        }
        if (!visionActive) {
          // A terminal gateway error must not leave the thinking block
          // stuck in its running state.
          flushThinking("completed");
          await thinkingEmissions;
          throw error;
        }
        // A model without vision rejects image parts outright: drop the
        // attachment instead of failing the run, and let the model say so.
        visionActive = false;
        // The current turn's user message is not necessarily messages[1]
        // any more - prior chat history can add earlier "user" rows before
        // it, so target the *last* user turn, not the first.
        const userIndex = messages.findLastIndex(m => m.role === "user");
        if (userIndex >= 0)
          messages[userIndex] = {
            role: "user",
            content: `${content}\n\n⚠️ (This model cannot view image attachments, so the uploaded image is not visible here - it is still saved in the workspace. Say so plainly and work from what the user says.)`,
          };
        try {
          result =
            round === 0 && deadlineAtMs - Date.now() <= 0
              ? await runChatRound()
              : await raceToolDeadline(runChatRound, deadlineAtMs);
        } catch (error) {
          if (error instanceof RunDeadlineExceeded) {
            flushThinking("completed");
            await thinkingEmissions;
            reply = await composeDeadlineClose();
            streamedReplyChars = 0;
            closedByDeadline = true;
            break;
          }
          throw error;
        }
      }
      // Drain the queue before the round's tool calls or reply so the
      // settled thinking block is persisted before anything follows it.
      flushThinking("completed");
      await thinkingEmissions;
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
        // A plain reply does NOT end the run - only end_turn does. Keep the
        // text as the running draft (it may still become the final reply if
        // the model ends without one) and nudge the model to either finish
        // explicitly or keep working.
        reply = result.text || "";
        streamedReplyChars = streamedThisRound;
        draftReply = result.text || "";
        draftStreamedChars = streamedThisRound;
        messages.push({ role: "assistant", content: result.text || null });
        messages.push({
          role: "user",
          content: `${END_TURN_NUDGE_PREFIX} Your turn has not ended: a plain reply does not finish this run. If the user's request is fully complete, call end_turn now with your complete final reply in the 'reply' argument. Otherwise continue the work with your next tool call - do not repeat your previous answer.`,
        });
        continue;
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
        // The explicit end of the turn. It is a local control call - no side
        // effects, no budget cost - so it is honored even when the run
        // budget is gone; blocking it would lose the reply the model already
        // wrote. The final reply prefers the explicit 'reply' argument, then
        // the text of this round, then the last text-only draft.
        if (call.name === "end_turn") {
          let endTurnReply = "";
          try {
            const parsed = JSON.parse(call.arguments || "{}") as {
              reply?: unknown;
            };
            if (typeof parsed?.reply === "string") endTurnReply = parsed.reply.trim();
          } catch {
            // Malformed arguments fall through to the streamed/draft text.
          }
          const roundText = (result.text || "").trim();
          if (endTurnReply) {
            reply = endTurnReply;
            // The explicit reply may restate text that already streamed
            // token-by-token (the draft the model echoed into end_turn) -
            // re-emitting it would duplicate what the user watched appear.
            streamedReplyChars = streamedRunText.endsWith(endTurnReply)
              ? endTurnReply.length
              : 0;
          } else if (roundText) {
            reply = roundText;
            streamedReplyChars = streamedThisRound;
          } else if (draftReply) {
            reply = draftReply;
            streamedReplyChars = draftStreamedChars;
          } else {
            reply = "";
            streamedReplyChars = 0;
          }
          endTurnCalled = true;
          break;
        }
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
          reply = await composeDeadlineClose(call.name, false);
          streamedReplyChars = 0;
          closedByDeadline = true;
          break;
        }
        // A third identical failing call is the model stuck in a loop, not
        // recovery: the identical call is guaranteed to fail the same way,
        // burning rounds (and, in the screenshot case, the whole run budget)
        // without moving the task forward. Refuse to execute it and hand
        // back the original failure text so the model either changes the
        // call to address the actual cause or ends the turn and tells the
        // user what failed.
        const attemptKey = `${call.name}:${call.arguments.slice(0, 2000)}`;
        const priorAttempt = failedAttempts.get(attemptKey);
        if (priorAttempt !== undefined && priorAttempt.count >= 2) {
          const refusal =
            `${REPEATED_FAILURE_PREFIX} This exact ${call.name} call has already failed twice in this run: ${priorAttempt.firstFailure} ` +
            `Repeating the identical call cannot change the outcome. Diagnose the actual cause from that failure text, change the call accordingly, or call end_turn now and tell the user plainly what failed, why, and what was completed.`;
          await emitTool({
            id: call.id,
            name: call.name,
            state: "failed",
            args: { arguments: call.arguments.slice(0, 500) },
            summary: "Refused: this identical call already failed twice in this run.",
          });
          lastRoundSummaries.push(`Failed: ${call.name} - refused, the identical call already failed twice.`);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: refusal,
          });
          continue;
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
              // Progress updates stream live to the open chat only - they are
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
            }, agentSandbox, ownCodingGate, options.channel, deadlineAtMs),
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
            reply = await composeDeadlineClose(call.name, true);
            streamedReplyChars = 0;
            closedByDeadline = true;
            break;
          }
          console.error("[Workspace tool] failed", call.name, error);
          // Say what actually failed - the real error with its cause chain,
          // not a canned line - capped at 500 chars like inference errors so
          // a runaway error body cannot flood the context.
          const failureDetail = errorChainText(error) || String(error);
          execution = {
            ok: false,
            result: `The tool call failed unexpectedly: ${
              failureDetail.length > 500 ? `${failureDetail.slice(0, 500)}…` : failureDetail
            }`,
          };
        }
        if (execution.action) actions.push(execution.action);
        lastRoundSummaries.push(toolSummary(call, execution));
        if (!execution.ok) {
          const failureText =
            execution.result.length > 240
              ? `${execution.result.slice(0, 240)}…`
              : execution.result;
          failedSteps.push(`${call.name} - ${failureText}`);
          const attempt = failedAttempts.get(attemptKey);
          if (attempt) attempt.count += 1;
          else
            failedAttempts.set(attemptKey, {
              count: 1,
              firstFailure: failureText,
            });
        }
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
        // Coder-delegation guard: remember specialist use, and flag a round
        // where the agent wrote substantial code itself without it. The
        // nudge is queued and delivered once, after the round's tool
        // results, so it never breaks the tool-call message chain.
        if (execution.specialistDown) {
          specialistDown = true;
          ownCodingGate.specialistDownThisRun = true;
          ownCodingGate.blocked = true;
          ownCodingGate.awaitingAcceptance = false;
        }
        if (call.name === "code_task") {
          codeTaskUsed = true;
          coderNudgePending = false;
          // A working specialist clears any lingering acceptance question:
          // self-coding rules return to the normal mandatory-delegation mode.
          if (execution.ok && (ownCodingGate.awaitingAcceptance || priorAcceptance !== "none")) {
            ownCodingGate.awaitingAcceptance = false;
            ownCodingGate.blocked = false;
            ownCodingGate.specialistDownThisRun = false;
            specialistDown = false;
            await recordSpecialistAcceptance(ownerId, chatId, "cleared");
          }
        }
        if (call.name === "accept_own_coding" && execution.ok) {
          codeTaskUsed = true;
        } else if (
          execution.ok &&
          !codeTaskUsed &&
          !coderNudgeSent &&
          !coderNudgePending &&
          (call.name === "create_file" || call.name === "edit_file") &&
          typeof execution.action?.name === "string"
        ) {
          let written = "";
          try {
            const parsed = JSON.parse(call.arguments || "{}") as {
              content?: unknown;
            };
            if (typeof parsed?.content === "string") written = parsed.content;
          } catch {
            // Malformed arguments: no nudge, the tool already reported it.
          }
          if (isCodeFileName(execution.action.name) && isSubstantialCode(written)) {
            coderNudgePending = true;
            coderNudgeFile = execution.action.name;
          }
        }
      }
      // Coder-delegation guard: deliver the queued nudge once, only when the
      // run is continuing anyway - never on the closing or end_turn exits.
      // With the specialist confirmed down, self-coding is disclosed
      // degraded mode - nudging back toward code_task would be noise.
      if (coderNudgePending && !closedByDeadline && !endTurnCalled && !specialistDown) {
        coderNudgePending = false;
        coderNudgeSent = true;
        messages.push({ role: "user", content: coderNudgeFor(coderNudgeFile) });
      }
      // Failure disclosure: one nudge per run, queued the first time a
      // round's tool calls fail and delivered after the round's results
      // (never on the closing or end_turn exits, where the reply is already
      // final and the error-path note below carries the failures instead).
      if (failedSteps.length > 0 && !failureNudgeSent && !closedByDeadline && !endTurnCalled) {
        failureNudgeSent = true;
        messages.push({ role: "user", content: failureNudgeFor(failedSteps) });
      }
      // The deadline hit mid-tool: the closing reply is already set - leave
      // the round loop without refreshing state or starting a new round.
      if (closedByDeadline) break;
      // The model explicitly ended its turn: the reply is final - persist it
      // without refreshing state or starting another round.
      if (endTurnCalled) break;
      // Refresh workspace state so later rounds resolve names/ids created
      // or removed by this round's tools.
      computer = await getWorkspaceComputer(ownerId);
      messages[0] = systemMessage();
    }

    if (specialistDown) {
      // The run ends with the acceptance question the model asked: mark the
      // chat pending so the NEXT user turn can accept (and only that turn,
      // via accept_own_coding, unlocks Nova's own coding).
      await recordSpecialistAcceptance(ownerId, chatId, "pending");
    }
    if (!reply.trim()) {
      reply =
        "I could not complete that request. Please try again, or rephrase it more specifically.";
    }
    // The reply already streamed to the client token-by-token: re-sending the
    // full text would duplicate what the user watched appear.
    if (streamedReplyChars === 0) await options.onChunk?.(reply);
    const message = await persistAssistant(reply);
    return { message, actions, outOfBudget: closedByDeadline };
  } catch (error) {
    console.error("[Chat] Mistral chat failed", error);
    const kind =
      error instanceof MistralGatewayClientError ? error.kind : "unavailable";
    const failureNote =
      "\n\nNova lost the connection to the inference gateway before this reply finished. Everything so far is saved - send another message and I will continue from here.";
    // A run that dies mid-flight on an inference error must still disclose
    // the tool steps that failed before it died: without this, the error
    // reply read as "everything so far is saved" while the steps behind
    // "so far" had failed invisibly (e.g. the project scaffold that never
    // landed, followed by reads of files that could never exist).
    const failedStepsNote = failedSteps.length
      ? `\n\nSteps that failed during this run (not completed):\n${failedSteps
          .slice(-5)
          .map((step, index) => `${index + 1}. ${step}`)
          .join("\n")}`
      : "";
    // Every failure reply carries the actual backend error (message plus
    // cause chain) so the user can diagnose it from the chat: the upstream
    // text is what says whether the provider throttled, billed, or outright
    // rejected the request. Transient inference failures lead with the
    // provider's own error text - a hardcoded narrative read as a
    // misdiagnosis ("lockout" for plain pool congestion) - while
    // setup-class failures keep their actionable lead and append the
    // detail. Capped so a runaway error body cannot flood the chat.
    const detail = errorChainText(error) || String(error);
    const clippedDetail = (cap: number) =>
      detail.length > cap ? `${detail.slice(0, cap)}…` : detail;
    const actualError = ` Actual backend error: ${clippedDetail(500)}`;
    const withActualError = (lead: string) => lead + actualError;
    const providerErrorLead = (note: string) =>
      `Inference provider error: ${clippedDetail(500)}. ${note}`;
    let reply: string;
    if (kind === "configuration") {
      reply = withActualError(
        "Inference is not connected yet. An administrator must configure the server-only gateway before chat is available."
      );
    } else if (kind === "allowance_reached") {
      reply = withActualError(
        "The inference request allowance has been reached. New requests are blocked until an administrator raises the cap."
      );
    } else if (kind === "rate_limit") {
      reply = providerErrorLead(
        "Everything so far is saved - please try again in a little while."
      );
    } else if (kind === "client_error") {
      reply = withActualError(
        "The inference provider rejected this request (for example an unsupported model or an oversized prompt). Retrying cannot fix that, so I stopped. Please adjust the request and try again; everything so far is saved."
      );
    } else {
      // A long tool-calling run often streams part of the reply to the client
      // (the Telegram placeholder, the web stream) before the gateway fails
      // mid-run. Keep what the user already watched instead of throwing it
      // away and replacing it with an error notice.
      const partial = streamedRunText.trim();
      if (partial) {
        reply = partial + failureNote;
      } else if (kind === "invalid_response") {
        reply = providerErrorLead(
          "The inference provider returned an invalid response. Please try again shortly."
        );
      } else {
        // Say what actually failed instead of a canned "try again shortly":
        // the real error (network failure, gateway 5xx body, timeout detail,
        // and the database cause behind a drizzle "Failed query" wrapper) is
        // what diagnosing needs. Cap the length so a runaway error body
        // cannot flood the chat.
        const detail = errorChainText(error) || String(error);
        reply =
          MISTRAL_UNAVAILABLE_PREFIX +
          (detail.length > 500 ? `${detail.slice(0, 500)}…` : detail);
      }
    }
    // Only emit what the client has not already seen streamed live.
    await options.onChunk?.(streamedRunText.trim() ? failureNote : reply + failedStepsNote);
    const message = await persistAssistant(reply + failedStepsNote);
    return { message, actions, outOfBudget: false };
  } finally {
    // End of run, on every exit path (completed, stopped, deadline, error):
    // sync the live sandbox filesystem - files created or changed by bash,
    // VM tasks, or mirrored tool ops - back into the durable Neon/S3 store.
    if (agentSandbox && sandboxWorkspaceId !== undefined)
      await syncAgentSandbox(ownerId, sandboxWorkspaceId, agentSandbox);
  }
}
