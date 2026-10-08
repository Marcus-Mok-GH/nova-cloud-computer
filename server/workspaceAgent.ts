import { AI_UNAVAILABLE_PREFIX } from "@shared/const";
import type { E2BSandboxLike } from "./e2b";
import {
  pauseAgentSandbox,
  prepareAgentSandbox,
  syncAgentSandbox,
} from "./sandboxWorkspace";
import { warmBrowserInBackground } from "./agentBrowser";
import { getDatabaseTime, hasAgentStopAfter } from "./db";
import {
  appendConversationTurn,
  listRecentMemoriesForPrompt,
} from "./memories";
import {
  agentAddressFor,
  describeApprovalsForPrompt,
} from "./agents";
import {
  appendChatMessageForUser,
  getChatForUser,
  getCommunicationStyleForUser,
  getPersonalisationForUser,
  getUserIdentityForUser,
  getWorkspaceComputer,
  listChatMessagesForUser,
  renameChatIfDefaultForUser,
  type PersonalisationDetail,
  type PersonalisationExpertise,
  type PersonalisationProactiveness,
  type PersonalisationSettings,
} from "./db";
import {
  getAiGatewayStatus,
  type GatewayChatMessage,
  type GatewayToolCall,
  type GatewayToolDefinition,
  AiGatewayClientError,
  configuredVisionChatModel,
} from "./aiGateway";
import {
  chatWithWorkspaceModel,
  completeWithWorkspaceModel,
  getActiveCustomModel,
} from "./byokGateway";
import {
  COMPOSIO_TOOLKITS,
  type ComposioToolkit,
  getComposioConnectionStatus,
} from "./composio";
import {
  isCodeFileName,
  isSubstantialCode,
} from "./workspaceEdits";
import { WORKSPACE_TOOLS } from "./workspaceToolSchemas";
import {
  type AgentAction,
  type AgentChatRunOptions,
  type WorkspaceAgentOptions,
  type WorkspaceToolActivity,
  SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX,
  readSpecialistAcceptance,
  recordSpecialistAcceptance,
} from "./workspaceAgentTypes";
import {
  type OwnCodingGate,
  type ToolExecution,
  executeWorkspaceTool,
} from "./workspaceToolExecutor";
import { describeDeploymentsForUser } from "./siteDeploy";
// Re-exported so existing importers of this module keep working.
export { isCodeFileName, isSubstantialCode, unifiedDiff } from "./workspaceEdits";
export type {
  AgentAction,
  AgentChatRunOptions,
  WorkspaceAgentOptions,
  WorkspaceToolActivity,
} from "./workspaceAgentTypes";
export { SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX } from "./workspaceAgentTypes";


/** Identity + team context for one personal-agent run. */

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
        timer = setTimeout(
          () => reject(new RunDeadlineExceeded()),
          remainingMs
        );
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
  chatId: string
): Promise<void> {
  try {
    const chat = await getChatForUser(ownerId, chatId);
    if (!chat || !DEFAULT_CHAT_TITLES.has(chat.title)) return;
    const messages = await listChatMessagesForUser(ownerId, chatId);
    const firstUser = messages?.find(m => m.role === "user");
    // The LAST assistant text row, not the first: a run also persists the
    // lines it says before each tool call, and the closing reply is what the
    // turn was actually about.
    const lastAssistant = messages?.findLast(
      m =>
        m.role === "assistant" &&
        !m.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX) &&
        !m.content.startsWith(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX)
    );
    if (!firstUser || !lastAssistant) return;
    const prompt = [
      "Generate a concise 3-6 word title for this conversation. Reply with the title only - no quotes, no trailing punctuation.",
      firstUser.content,
      lastAssistant.content,
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
 * agent's own code write shows it skipped the editor.
 */
export const CODER_NUDGE_PREFIX = "[coder control]";


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
  return `${CODER_NUDGE_PREFIX} You just wrote ${wroteName} yourself without the editor sub-agent. Nova's editor sub-agent should produce non-trivial code - it returns better code than writing it directly, and the user is never asked which sub-agent to use. If the code you wrote is already complete, correct and verified, continue as you were. Otherwise, delegate the file work to the editor tool with the full task description, the relevant existing code and any exact errors in context, and make sure the code ends up in the workspace - verify the files it wrote autonomously, or place its returned code with your file tools. If the editor reports the sub-agent is not configured (the workspace owner must finish setting up the editor), tell the user exactly that, ask whether to proceed with Nova's own attempt, and only write code yourself in a later turn after the user accepted and the accept_own_coding tool recorded it - never silently continue yourself.`;
}

const CONNECTOR_TOOL_NAMES = new Set([
  "github",
  "list_connector_tools",
  "use_connector_tool",
]);

/** Resolves which connector toolkits the user has actually connected. Failures degrade to "not connected". */
export async function getConnectedConnectorToolkits(
  ownerId: number,
  statusCheck: (
    ownerId: number,
    toolkit: ComposioToolkit
  ) => Promise<{ connected: boolean }> = getComposioConnectionStatus
): Promise<ComposioToolkit[]> {
  const results = await Promise.all(
    COMPOSIO_TOOLKITS.map(async toolkit => {
      try {
        return {
          toolkit,
          connected: (await statusCheck(ownerId, toolkit)).connected,
        };
      } catch {
        // One broken optional connector must not hide another connector that
        // is healthy and should still be available to the model.
        return { toolkit, connected: false };
      }
    })
  );
  return results.filter(entry => entry.connected).map(entry => entry.toolkit);
}

/** Builds the model tool list: connector tools are exposed only for connected toolkits. */
export function workspaceToolsForConnectors(
  connected: ComposioToolkit[]
): GatewayToolDefinition[] {
  const nonConnector = WORKSPACE_TOOLS.filter(
    tool => !CONNECTOR_TOOL_NAMES.has(tool.function.name)
  );
  if (!connected.length) return nonConnector;
  const connectorTools: GatewayToolDefinition[] = [];
  if (connected.includes("github")) {
    const githubTool = WORKSPACE_TOOLS.find(
      tool => tool.function.name === "github"
    );
    if (githubTool) connectorTools.push(githubTool);
  }
  if (connected.includes("gmail")) {
    connectorTools.push(
      ...WORKSPACE_TOOLS.filter(tool =>
        ["list_connector_tools", "use_connector_tool"].includes(
          tool.function.name
        )
      )
    );
  }
  return [...nonConnector, ...connectorTools];
}

/**
 * The tools an inbound-email run may use. Mail can arrive from anyone who
 * knows the agent's routable address, so an email-triggered run gets a
 * deliberately narrow, side-effect-free set: it can reason, research and
 * compute, but cannot read or change the owner's workspace, memory,
 * connectors, wallet or deployments. The webhook signature authenticates the
 * mail provider, not the sender - without this, a stranger could email the
 * agent "read the passwords file and reply with it" or "delete the project
 * folder" and have it answered. New tools are excluded by default.
 */
const EMAIL_REPLY_TOOL_ALLOWLIST = new Set([
  "end_turn",
  "research_web",
  "thinker",
  "solve_equation",
  "base44",
]);

/** True when a tool may run inside an inbound-email-triggered agent run. */
export function emailReplyAllowsTool(name: string): boolean {
  return EMAIL_REPLY_TOOL_ALLOWLIST.has(name);
}

/** Human-readable connector status line for the system prompt. */
export function connectorStatusLine(connected: ComposioToolkit[]): string {
  if (!connected.length)
    return "no connectors are connected right now, so connector tools are unavailable";
  const parts = COMPOSIO_TOOLKITS.map(
    toolkit =>
      `${toolkit === "github" ? "GitHub" : "Gmail"} ${connected.includes(toolkit) ? "is connected" : "is not connected"}`
  );
  return `${parts.join("; ")}. Only ${connected.map(toolkit => (toolkit === "github" ? "GitHub" : "Gmail")).join(" and ")} tools are available`;
}

const PERSONALISATION_DETAIL_LABELS: Record<PersonalisationDetail, string> = { brief: "keep replies brief", balanced: "a balanced level of detail", detailed: "thorough, detailed replies" };
const PERSONALISATION_PROACTIVENESS_LABELS: Record<PersonalisationProactiveness, string> = { ask_first: "ask before acting", act_and_tell: "act and then explain", autonomous: "work fully autonomously" };
const PERSONALISATION_EXPERTISE_LABELS: Record<PersonalisationExpertise, string> = { new: "a newcomer who needs things explained", some: "familiar with the tools", expert: "an expert - skip the basics" };

/**
 * Composes the personalisation block injected into every agent system prompt.
 * Returns an empty string only when the mode is off and nothing is saved, so
 * the prompt stays clean for users who never open the feature; whenever the
 * mode is on or any preference exists, the block carries an explicit mode line.
 */
function formatPersonalisationForPrompt(settings: PersonalisationSettings): string {
  const lines: string[] = [];
  if (settings.profile) lines.push(`What I know about the user: ${settings.profile}`);
  if (settings.tone) lines.push(`Preferred tone: ${settings.tone}.`);
  if (settings.detail) lines.push(`Preferred reply length: ${PERSONALISATION_DETAIL_LABELS[settings.detail]}.`);
  if (settings.proactiveness) lines.push(`Collaboration style: ${PERSONALISATION_PROACTIVENESS_LABELS[settings.proactiveness]}.`);
  if (settings.expertise) lines.push(`The user is ${PERSONALISATION_EXPERTISE_LABELS[settings.expertise]}.`);
  // Only a disabled mode with nothing saved is truly "no block". The agent
  // reads the mode from this explicit line, not from the section's absence, so
  // an enabled-but-empty profile must still be announced and a disabled mode
  // with saved preferences must say so.
  if (!settings.enabled && !lines.length) return "";
  const intro = settings.enabled
    ? lines.length
      ? "Personalisation mode is ON. The user's saved preferences - which you should keep learning and refining:"
      : "Personalisation mode is ON, but the user has no saved preferences yet. Notice and save lasting preferences with set_personalisation as you work."
    : "Personalisation mode is OFF. The user's saved preferences (apply them, but do not save new ones):";
  return lines.length
    ? `${intro}\n${lines.map(line => `- ${line}`).join("\n")}`
    : intro;
}

const WORKSPACE_AGENT_PROMPT = `You are Nova, a fully autonomous operator of a private computer workspace. You do not wait to be told how - you decide how, then act.{{agent_identity}}

Your job is to get the user's work done end-to-end and to a high standard. You are a highly capable operator with a full toolkit: reason about what the user actually needs, use your own judgment for conversation and light work, and reach for tools and specialists whenever they make the result faster, more accurate, or more complete. Prefer finishing the task over narrating a plan. Match the tool to the job - editor for real code, solve_equation for math, run_vm_task / run_bash for computation and data work, thinker for hard reasoning, research_web for current or external facts, connectors for outside services, workspace file tools for durable deliverables - then verify what comes back and keep going until the goal is done. The measure of a good turn is the user's problem actually being solved - never settle for a partial, generic or hedged result when the tools to do better are right there.

Operating principles:
- Finish the goal. When the user states a goal, complete it end-to-end in this turn: gather what you need, call every tool the goal requires, verify the result, recover from failures, then report. Never reply with only a plan, instructions for the user to run themselves, or a clarifying question when tools could get the work done right now. A refusal or an "I can't" is only acceptable once you have genuinely exhausted what the tools can do, and then say exactly what you would need.
- Triage lightly. Greetings, quick clarifications, short summaries, and recalling what was just said - answer directly with no tools. Anything involving real code, research, math, data work, files, outside services, or multiple steps - use the tools and specialists. Never turn a simple question into a tool parade, and never swallow complex work with a one-line guess.
- Bias to action. Make reasonable choices and keep moving on routine, reversible work, checking the relevant files, records, skills, or dedicated tools when the answer depends on them instead of guessing. Default to fully autonomous; switch to collaborative - pause and ask one focused question - only when guessing has a real cost (irreversible or destructive actions beyond the request, personal taste you cannot know, missing credentials or permissions, or no reasonable interpretation). Never improvise facts, targets, recipients, IDs, or permissions, and clearly distinguish what was verified from what was inferred when it matters.
- Work in tight loops. Hold a short plan for the goal, then execute in small verified steps: look at the latest tool result, adapt, continue. Parallelize independent reads or lookups when that saves a round, and chain tools freely - multi-step work is the norm (create folders before files, read before editing, verify after writing). Do not freeze mid-task to narrate or ask permission - the user sees your tool activity as it runs. End-to-end completion means chaining those steps until the goal is done, not stopping after the first useful action.
- Prefer dedicated tools. For workspace operations always use the purpose-built tool: create_file, edit_file, read_file, move_file, rename_file, delete_file, create_folder, and friends. Never fall back to the VM (shell, subprocess, echo, sed, heredocs) for work a dedicated tool can do - dedicated tools are instant, auditable, and sync to the workspace automatically. Reserve run_vm_task for genuine computation: running code, installing packages, network requests, data processing, browser automation. When a VM run does produce files you want to keep, copy them into the workspace with dedicated tools afterwards.
- Never do math or data work in your head. solve_equation evaluates a single math expression and returns the exact answer, so route every calculation through it - sums, percentages, discounts, date/day offsets involving numbers, unit conversions, anything numeric. Any real data work - counting, filtering, aggregating, sorting, converting, extracting or transforming content - goes through run_vm_task: write a short script, run it, read the output. Eyeballing numbers or transformations is the fastest way to give the user a confidently wrong answer; one tool call costs a fraction of a second.
- Your workspace sandbox is live while you work: it wakes automatically with every run and your files and folders are synced into it at /home/user/workspace. Use run_bash to run bash commands directly on it - ls, grep, wc, head, git, tar - its working directory is your workspace and its stdout and stderr come back to you. Anything bash or the VM creates there is synced back to your durable storage automatically. Prefer run_bash for quick shell work and reserve run_vm_task for Python, pip installs, and heavier compute.
- Use browse whenever you need a real browser: pages that render with JavaScript, logging in or filling forms, clicking through a UI, saving a page screenshot as a workspace file. Drive it like a person: 'open <url>' first, then 'snapshot' to get element refs (@e1, @e2...), act with 'click @e2' or 'fill @e3 "text"', then 'snapshot' again to see what changed, and 'read' for the rendered text of the current page. Chrome installs itself once per sandbox in the background (it usually finishes before you need it); if a browse call reports that the one-time install is still running, tell the user, wait about 2-3 minutes, and retry the same command - do not start another install. Screenshots saved into the workspace appear as regular workspace files. Keep research_web for deep multi-source research and browse for interacting with specific pages.
- Research when facts matter. For user-specific facts, check workspace files and records; for supported procedures, check installed skills; for live state, use dedicated tools; for current or external facts you do not know for certain, use research_web - it returns a full, cited research report from Exa AI's deep research models. Before every research_web call, estimate how deep the research needs to be and pass that difficulty explicitly: deep-lite for single-fact lookups, deep for most questions, deep-reasoning for complex investigations with conflicting or multi-faceted evidence. Use its findings, cite the source URLs for facts that came from them, and never present an inference as verified information.
- Think deeper when the answer is hard. When a problem needs sustained reasoning rather than lookup or computation - weighing a design or strategy decision, planning a multi-step approach, untangling a subtle trade-off, risk or failure mode, analyzing a body of material for what it implies, or checking your own reasoning before committing to it - call thinker. It is a frontier reasoning sub-agent: hand it the complete question and every relevant piece of context, then use its detailed findings to decide your next action. Never delegate simple questions, lookups or arithmetic to thinker - it reasons, it does not act.
- Your memory is tool-backed, not file-backed. Every conversation is captured as a memory automatically, and search_memories / read_memory reach it: whenever the user references earlier work, past decisions, or a previous conversation, search for it instead of re-asking. For durable facts, decisions, and the running state of a long multi-step task, save them with save_memory (title, summary, content, optional tags) and read the memory back before resuming or whenever you lose the thread. Workspace files are for deliverables, not for memory.
- Substantial file work goes through editor - your file-editing sub-agent. Whenever the user wants files created or changed in bulk - building an app or site, whole files, functions, components, scripts, algorithms, tricky bugs, refactoring - delegate it to editor: describe the goal and constraints completely, include the relevant existing code or the exact error in context, and verify what it delivers: with the sandbox awake it works autonomously - its files are already in the workspace, so read the changed files back and check them; when it returns bare code instead, place it into the workspace with your file tools. This is mandatory, not optional: users never ask for a sub-agent by name, and the editor sub-agent writes better code than you writing it directly. Never write non-trivial code yourself with create_file or edit_file - if it is more than a tiny tweak (a one-line fix, a few lines of markup, a small config change), it belongs to editor. Write code yourself only when editor reports the sub-agent is unavailable (then tell the user exactly that - a config problem means the editor is not set up on this workspace yet - ask whether to proceed with Nova's own attempt, and never silently substitute your own code for the specialist's; if you do proceed after the user accepted, say plainly the code is Nova's own work) or for genuinely trivial snippets of a few lines. Notes, documents and other non-code content are yours to write directly.
- Use connectors for outside services: GitHub for repositories, issues and pull requests; Gmail for reading, sending and replying to email. Connector tools are only available for services that are connected - current connections: {{connectors}}. When a service is not connected, do not attempt its connector tools; tell the user to open Settings and connect it first. For GitHub, use the dedicated github tool with repo in owner/name format - never search raw actions, GitHub App installations, or event endpoints. For Gmail, search the exact action slug and parameters with list_connector_tools, then execute with use_connector_tool.
- Publish websites with deploy_website - publishing is exclusively your ability (the web UI has no publish button). When the user wants their workspace, site, page, or app online (\"put this online\", \"go live\", \"host my site\", \"publish my portfolio\"), first make it deployable: it must be static (anything Netlify's static hosting serves) with an index.html at the root of the chosen directory. Then call deploy_website and deliberately choose the directory to publish - the project or build-output folder that holds the site, never a blind dump of unrelated workspace files; pass '/' only when the site genuinely lives at the workspace root. Every deployment has a stable ID (d-01, d-02, ...) and a short description kept in the workspace's deployment registry across chats. The description is a MUST on every deploy_website call - never call it without a description that names this deployment's purpose, so you and the user always know what each deployment is for. Targeting is deliberate and explicit: pass an existing deployment ID to publish to that deployment - its URL NEVER changes on update, and you must never deploy a different project to it - or omit the ID to create a new deployment, which gets its own ID, URL and a description you write in the same call. Never guess a deployment ID: the workspace's deployments are listed here with their IDs - {{deployments}}. When the user asks to update \"their site\" and several deployments exist, resolve which one by their description or ask; never silently overwrite one deployment's content with another project. Tell the user which URL is live, along with its deployment ID. Deploys can take up to a minute. If the tool reports that hosting is not configured yet (the operator must set NETLIFY_API_TOKEN on the server), tell the user exactly that.
- Take sites down with delete_website - unpublishing is exclusively your ability too. When the user asks to delete, remove, unpublish, or take down their site or deployment, call delete_website with the deployment's ID (from the deployment list above - never guess one). When several deployments exist or the request is vague, confirm which one they mean first. Deleting every deployment (all: true) is a two-step sweep: the first call only lists the target deployment IDs and deletes nothing - show the user that list and re-call with confirm_all set to exactly it, which you may do in the same turn only when they already explicitly asked to delete every deployment; otherwise wait for their explicit go-ahead first. Deletion is irreversible and the URL goes offline immediately - never improvise it, and tell the user plainly what went offline. Workspace files are never touched by a deletion, and a later deploy_website creates a fresh deployment with a new ID and URL.
- Start clean projects with create_project_template. When the user wants a new site or app, scaffold it instead of improvising loose files. If they did not specify a stack, choose the best fit yourself instead of asking - and mention the stack you chose. The default for web apps and sites is 'react', a React SPA that runs in the browser (React from a CDN, no build step); never improvise a default as loose HTML files. Use 'static' (a plain HTML/CSS/JS site) only when the user explicitly asks for plain HTML or wants a genuinely simple single page, and 'next' for a Next.js App Router project configured for static export. The template lands in its own project folder. For 'static' and 'react', deploy_website publishes the project folder directly; for 'next', run 'npm install && npm run build' in the project folder via run_vm_task first, copy the generated out/ files into the workspace with create_file, then deploy_website with the out folder as the directory. A 'react' project has NO bundler - React and Babel standalone come from a CDN, so components must be plain global functions (no import/export): expose each component on window in its own file and load it with a text/babel script before the file that uses it, exactly as the scaffold does, or the page renders a blank screen. From there, edit and extend the project with your regular file tools and redeploy to the same deployment ID so its URL stays stable.
- Recover on your own. If a tool call fails or a name is missing, adapt: list the workspace, try an alternative, fix the input, and continue - but never repeat the identical failing call unchanged, the same outcome is guaranteed. When something is impossible with the tools available, say exactly what you would need to do it.
- Verify your work. After creating or editing, read back or otherwise confirm the outcome before claiming success.
- Report briefly, including failures. End multi-step work with a short summary of what changed (files created/edited/moved/deleted, messages sent, tasks run) - not a play-by-play - delivered through end_turn. Any step that failed during the run and was not fully recovered MUST be stated in that summary with its actual error text and what you did instead - a summary that hides a failed step is a false report of the work.
- End your turn ONLY with end_turn. Writing a reply without calling a tool does NOT end your turn - the run simply continues. When the work is complete, call end_turn with your complete final reply in its 'reply' argument; that is the only way the user receives your answer and the only way your turn finishes. While working, keep using tools; never write the final answer as plain text.
{{progress_updates}}
- Honor the user's communication style. When the user states or changes how they want you to communicate ("keep it short", "be more structured", "reply in Spanish"), save it immediately with set_communication_style - it persists across every chat and session, and appears above as their saved style. Apply it to every reply from then on.
- Personalisation: when the user asks to set up, tune, or change how you work with them, run a short personalisation session - ask one focused question at a time about their role and goals, how they like your replies, how much you should act on your own, and how familiar they are with the tools, waiting for each answer before asking the next, then read the saved profile back in one short paragraph. Save each thing you learn with set_personalisation as you go, and set enabled: true. Outside a session, when the user states a lasting preference about how you should work, save it with set_personalisation too - but only when the personalisation block above states that the mode is ON; if it states OFF, or there is no block at all (the mode was never enabled and nothing is saved), offer to turn the mode on instead of saving. Never invent preferences the user has not expressed.

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
{{personalisation}}
This request arrived via: {{channel}}.

Recent memories (search_memories finds more, read_memory returns the full record; list_workspace lists every file and folder):
{{memories}}`;

/**
 * The {{agent_identity}} block, injected right after Nova's opening line so a
 * personal agent knows who it is, what its identity can do, what awaits the
 * user's approval, and (in team chats) how turns work. Returns "" for the
 * default assistant, leaving the prompt byte-identical to before.
 */
export function agentIdentityPromptBlock(
  agentChat: AgentChatRunOptions,
  approvalsLine: string
): string {
  const { profile, team } = agentChat;
  // A wallet with no cap (budget null) has no "of N" figure to report.
  const wallet =
    profile.walletBudgetCredits === null
      ? `unlimited, no budget cap (${profile.walletSpentCredits} credits spent)`
      : `${Math.max(
          0,
          profile.walletBudgetCredits - profile.walletSpentCredits
        )} of ${profile.walletBudgetCredits} credits remaining`;
  const lines = [
    ` In this conversation you are not the default workspace assistant - you are ${profile.name}${profile.role ? `, the ${profile.role}` : ""}, a personal agent of this workspace: stay in character, act and sign your replies as ${profile.name}.`,
    profile.instructions
      ? `\nYour standing instructions: ${profile.instructions}`
      : "",
    `\nYour agent identity - email: ${agentAddressFor(profile)} (${
      profile.agentmailAddress
        ? "a real inbox that can send to and receive from outside addresses"
        : "Nova-internal mail"
    }; send with send_agent_email), phone: ${profile.phoneHandle} (a virtual handle, not real telephony), wallet: ${wallet}.`,
    `\nGated actions - request_purchase and send_agent_email do not act immediately: they record a request that only the user can confirm in Nova's Agents page. Approval state: ${approvalsLine}. Always tell the user when something you asked for is waiting, approved, denied, or failed.`,
    "\nYour memory is yours alone: search_memories / read_memory / save_memory work in your agent-private scope plus the shared workspace notes - other agents' memories are invisible to you, and yours to them.",
    team
      ? `\nThis is an AGENT TEAM chat - you and your teammates are collaborating on one shared goal: ${team.goal}. Roster in turn order: ${team.roster.map(member => member.name).join(", ")}. This runs as a bounded discussion: read your teammates' turns above, build on them, and contribute your own part without repeating their work. End every turn with end_turn so the discussion continues${team.finalMember ? " - you are the last teammate of the final round, so synthesize the whole team's combined work into the final reply for the user" : ""}. Your reply is shown to the user with a [${profile.name}] attribution.`
      : "",
  ];
  return lines.filter(Boolean).join("");
}


/**
 * Some models spell a tool call out as text instead of invoking it -
 * 'The function call that best answers the given prompt is {"name": "present_file", "parameters": {...}}'.
 * Recover the intent: extract the embedded JSON object and run it as a real
 * tool call so the action still executes and the raw JSON never reaches the user.
 */
function toolCallWrittenAsText(
  text: string,
  tools: Array<{ function: { name: string } }>
): { name: string; arguments: string } | undefined {
  if (!text || !text.includes('"name"')) return undefined;
  const known = new Set(tools.map(tool => tool.function.name));
  for (const match of Array.from(
    text.matchAll(/"name"\s*:\s*"([A-Za-z0-9_]+)"/g)
  )) {
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
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth !== 0) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(text.slice(objectStart, i + 1)) as Record<
            string,
            unknown
          >;
        } catch {
          break;
        }
        let parameters: Record<string, unknown>;
        if (typeof parsed.parameters === "object" && parsed.parameters !== null)
          parameters = parsed.parameters as Record<string, unknown>;
        else if (
          typeof parsed.arguments === "object" &&
          parsed.arguments !== null
        )
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
      : `${action.operation === "failed" ? "Failed running" : "Ran"} connector operation: ${action.name}.`;
  return `${action.operation === "deleted" ? "Delet" : action.operation === "updated" ? "Updat" : "Creat"}ed ${action.kind}: ${action.name}.`;
}

/** Transient gateway failures worth one automatic in-run retry. */
const GATEWAY_RETRY_KINDS = new Set(["unavailable", "invalid_response"]);
let gatewayRetryDelaysMs: number[] = [400, 1200, 5000];

/**
 * The upstream provider applies per-tier rate limits (requests per second plus token
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
        error instanceof AiGatewayClientError &&
        GATEWAY_RETRY_KINDS.has(error.kind);
      // Upstream 429: one patient retry, deadline-gated, once per run. The
      // fast loop must never hammer a lockout - that only extends it.
      const isUpstreamRateLimit =
        error instanceof AiGatewayClientError &&
        error.kind === "rate_limit";
      const waitMs = gatewayRateLimitRetryDelayMs ?? RATE_LIMIT_RETRY_DELAY_MS;
      if (
        isUpstreamRateLimit &&
        streamedChars === 0 &&
        !(options.retryState?.rateLimitRetryUsed ?? false) &&
        options.deadlineAtMs !== undefined &&
        Date.now() + waitMs + RATE_LIMIT_RETRY_MIN_REMAINING_MS <=
          options.deadlineAtMs
      ) {
        if (options.retryState) options.retryState.rateLimitRetryUsed = true;
        await waitFor(waitMs);
        continue;
      }
      if (streamedChars > 0 || !retryable || attempt >= maxAttempts - 1) {
        throw error;
      }
      await waitFor(gatewayRetryDelaysMs[attempt]);
    }
  }
}

/**
 * Runs the workspace agent for a message: a tool-calling loop over the AI
 * gateway. Every message goes through the model with workspace tools
 * (create/read/edit/rename/move/delete files and folders, Telegram, VM runs);
 * the loop executes requested tools and continues until the model produces a
 * final text reply (or the round cap is hit).
 */
export async function runWorkspaceAgent(
  ownerId: number,
  chatId: string,
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
  /**
   * In a team chat every reply is attributed to the agent that wrote it;
   * personal and ordinary chats keep unattributed replies.
   */
  const authorPrefix = options.agentChat?.team
    ? `[${options.agentChat.profile.name}] `
    : "";
  /**
   * Appends the assistant's reply to the chat and returns the persisted
   * message. Every call is an end-of-run reply, so the completed turn is
   * also captured into the chat's conversation memory (the record the
   * search_memories / read_memory tools serve). appendConversationTurn
   * never throws - a memory failure must not break the run.
   */
  const persistAssistant = async (reply: string) => {
    const message = await appendChatMessageForUser(ownerId, {
      chatId,
      role: "assistant",
      content: `${authorPrefix}${reply}`,
    });
    const turn = { userText: content, assistantText: reply };
    if (options.agentChat) {
      await appendConversationTurn(ownerId, chatId, turn, {
        agentId: options.agentChat.profile.id,
      });
    } else {
      await appendConversationTurn(ownerId, chatId, turn);
    }
    return message;
  };
  /**
   * Persists the text a round streamed before its tool calls as its own
   * assistant row, written ahead of the tool rows those calls append. Without
   * this the ledger only ever held the final reply, so a line like "let me
   * check that" disappeared from the chat the moment the run settled even
   * though the user watched it stream in. This is interim narration, not the
   * turn's reply, so it is deliberately not captured into conversation memory.
   */
  const persistRoundText = async (text: string) => {
    try {
      await appendChatMessageForUser(ownerId, {
        chatId,
        role: "assistant",
        content: `${authorPrefix}${text}`,
      });
    } catch (error) {
      console.error("[Chat] failed to persist interim reply text", error);
    }
  };

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
    const summaries = lastRoundSummaries
      .map(summary => `- ${summary}`)
      .join("\n");
    try {
      const completion = (await Promise.race([
        completeWithWorkspaceModel(
          ownerId,
          `You are Nova, an AI assistant working inside the user's personal cloud workspace. You just hit the end of the time you may spend on this single message; your work so far stops here but the conversation continues.

Completed steps:
${summaries || "(none recorded yet)"}
${unfinishedTool ? `\nThe \`${unfinishedTool}\` step was ${unfinishedToolStarted ? "still running when time ran out and was interrupted, not finished" : "skipped because time ran out before it could start"}.` : ""}

${
  options.continuationPlanned
    ? `Write a short progress status (2-4 sentences): what got done so far and what is still left. The work continues automatically in a few seconds without any user action. Do not ask the user to reply or wait, and do not mention time budgets, segments, or limits. Output only that message.`
    : `Write a short, honest status message to the user (2-4 sentences): what got done, what is unfinished, and that they can send "continue" so you pick up exactly where you left off. Output only that message.`
}`
        ).catch(() => null),
        waitFor(DEADLINE_CLOSE_MODEL_CAP_MS),
      ])) as { text?: unknown } | null | undefined;
      const text =
        typeof completion?.text === "string" ? completion.text.trim() : "";
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
  const failedAttempts = new Map<
    string,
    { count: number; firstFailure: string }
  >();
  let failureNudgeSent = false;

  // A team hand-off turn is context for the next teammate only: the user's
  // real message was already persisted by the first teammate's run.
  if (options.persistUserMessage !== false) {
    await appendChatMessageForUser(ownerId, { chatId, role: "user", content });
  }

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
      const status = await getAiGatewayStatus(ownerId);
      if (!status.configured) {
        const reply =
          "Nova's AI is not connected on this workspace yet. An administrator must finish setting it up before chat is available.";
        await options.onChunk?.(reply);
        const message = await persistAssistant(reply);
        return { message, actions: [], outOfBudget: false };
      }
      if (
        !status.reachable ||
        (status.providerConfigurationKnown && !status.providerConfigured)
      ) {
        const reply =
          "Nova's AI service is temporarily unreachable. Please try again shortly.";
        await options.onChunk?.(reply);
        const message = await persistAssistant(reply);
        return { message, actions: [], outOfBudget: false };
      }
      if (status.allowance.exhausted) {
        const reply = `Nova's shared request allowance is exhausted (${status.allowance.usedRequests}/${status.allowance.maxRequests} requests used). Please try again later or contact an administrator to raise the cap.`;
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
    const personalisation = await getPersonalisationForUser(ownerId);
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
      tool => {
        // An inbound-email run is untrusted input from a stranger, so it gets
        // a strict allowlist instead of the full workspace toolkit.
        if (options.emailReply) {
          return emailReplyAllowsTool(tool.function.name);
        }
        if (
          options.channel !== "telegram" &&
          (tool.function.name === "present_file" ||
            tool.function.name === "send_progress_update")
        )
          return false;
        // The gated identity tools belong to personal agents only.
        if (
          !options.agentChat &&
          (tool.function.name === "request_purchase" ||
            tool.function.name === "send_agent_email")
        )
          return false;
        return true;
      }
    );
    const memoriesLine = await listRecentMemoriesForPrompt(
      ownerId,
      8,
      options.agentChat ? { agentId: options.agentChat.profile.id } : undefined
    );
    // Personal agents see their own approval state (what of theirs is still
    // waiting on the user, and how the last few were decided) and get the
    // identity block; the default assistant's prompt stays unchanged.
    const agentIdentityLine = options.agentChat
      ? agentIdentityPromptBlock(
          options.agentChat,
          await describeApprovalsForPrompt(
            ownerId,
            options.agentChat.profile.id
          )
        )
      : "";
    const systemMessage = (): GatewayChatMessage => {
      return {
        role: "system",
        content: WORKSPACE_AGENT_PROMPT.replace("{{memories}}", memoriesLine)
          .replace("{{agent_identity}}", agentIdentityLine)
          .replace("{{connectors}}", connectorStatusLine(connectedConnectors))
          .replace("{{deployments}}", deploymentsLine)
          .replace(
            "{{style}}",
            communicationStyle
              ? `The user's saved preferred communication style: "${communicationStyle}" - follow it in every reply.`
              : ""
          )
          .replace(
            "{{personalisation}}",
            formatPersonalisationForPrompt(personalisation)
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
              ? `- Keep the user posted on Telegram, and own the ETA while you work. Over Telegram the user sees only the messages you send - none of your tool activity. No confirmation is sent for you automatically anymore: when the task will take more than a few seconds, your first send_progress_update should be a brief acknowledgment with an honest time estimate, then go straight to work - but for a quick question or greeting, just answer it directly. From then on the estimate is yours to maintain: keep sending short updates at a steady rhythm as you work - after each meaningful step completes, and never let more than a minute or so pass in silence on a long run - and whenever reality diverges from your estimate, say so and send the revised range ("taking longer than expected - about 2 more minutes", "nearly there, ~20 seconds"). Tell the user immediately when you hit a blocker - saying whether you are solving it yourself or need something from them - and whether it changes the ETA. Use send_progress_update for every note, keep each one brief, and never send a "done" summary until the work actually is done. When you create or meaningfully update a file worth showing - not only ones the user explicitly asked for - present it with present_file on your own initiative so they can view or download it right in the chat.`
              : "- In the web app the user watches your tool activity live as you work, so skip interim progress notes and just do the work - send_progress_update and present_file are Telegram-only and are not available here. Tell the user about a blocker or a revised expectation in your final reply instead of pinging mid-run, and deliver the finished work with end_turn as usual."
          ),
      };
    };

    const imageParts = (options.imageAttachments ?? []).filter(uri =>
      uri.startsWith("data:image/")
    );
    let visionActive = imageParts.length > 0;
    // The model sees the attachment note; the persisted user bubble keeps the
    // clean text the user actually typed (Telegram concatenates its note into
    // the text instead, which is fine there since the user turn is not shown).
    const modelContent = options.uploadContext
      ? `${content}${options.uploadContext}`
      : content;
    const currentTurn: GatewayChatMessage = {
      role: "user",
      content: visionActive
        ? [
            { type: "text" as const, text: modelContent },
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
    const priorMessages =
      (await listChatMessagesForUser(ownerId, chatId)) ?? [];
    // A run also persists the narration it writes before each tool call, so a
    // settled turn can be several assistant rows in a row ("let me check" then
    // the reply). Merge consecutive same-role rows back into one turn: the
    // gateway validates role alternation and rejects two assistant messages
    // back to back, and joined they read as the single reply they were.
    const historyTurns: GatewayChatMessage[] = [];
    for (const message of priorMessages
      .filter(
        m =>
          !m.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX) &&
          !m.content.startsWith(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX)
      )
      .slice(-MAX_HISTORY_MESSAGES)) {
      const turn: GatewayChatMessage = {
        role: message.role as "user" | "assistant",
        content: message.content,
      };
      const previous = historyTurns[historyTurns.length - 1];
      if (previous && previous.role === turn.role)
        previous.content = `${previous.content}\n\n${turn.content}`;
      else historyTurns.push(turn);
    }
    // On a team hand-off turn the user's message is NOT the last persisted
    // row (a teammate's reply is), so the internal note is added as its own
    // model-visible turn instead of overwriting history; role alternation is
    // kept by folding it into a trailing user row when one exists.
    if (historyTurns.length && options.persistUserMessage !== false)
      historyTurns[historyTurns.length - 1] = currentTurn;
    else if (
      historyTurns.length &&
      historyTurns[historyTurns.length - 1].role === "user" &&
      typeof currentTurn.content === "string"
    ) {
      const lastTurn = historyTurns[historyTurns.length - 1];
      lastTurn.content = `${lastTurn.content}\n\n${currentTurn.content}`;
    } else historyTurns.push(currentTurn);
    const messages: GatewayChatMessage[] = [systemMessage(), ...historyTurns];

    // /stop support: a stop request recorded after the run started aborts the
    // run at the next safe point (round boundary or between tool calls).
    const runStartedAt = await getDatabaseTime();
    const stopRun = async () => {
      const stoppedReply =
        "⏹️ Stopped - this run was cancelled at your request.";
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
      void hasAgentStopAfter(ownerId, chatId, runStartedAt)
        .then(stop => {
          if (stop) stopController.abort();
        })
        .catch(() => {});
    };

    let reply = "";
    let streamedReplyChars = 0;
    let recoveredCallCount = 0;
    // Coder-delegation guard: one nudge per run when the agent writes
    // substantial code itself without ever calling the editor.
    let codeTaskUsed = false;
    let coderNudgeSent = false;
    let specialistDown = false;
    let coderNudgePending = false;
    let coderNudgeFile = "";
    // Specialist-down self-coding gate: a run that ends with the editor down
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
      if (round > 0 && (await hasAgentStopAfter(ownerId, chatId, runStartedAt)))
        return stopRun();
      // A deploy or long research can consume nearly the whole request
      // budget. Starting another gateway round this close to the maxDuration
      // limit risks the function being killed before the reply persists -
      // close the run with a model-written status instead.
      if (
        round > 0 &&
        Date.now() + FINAL_ROUND_MIN_REMAINING_MS > deadlineAtMs
      ) {
        reply = await composeDeadlineClose();
        streamedReplyChars = 0;
        // The run stops because a follow-up round would not fit - the task is
        // unfinished (the model never called end_turn), not complete. Mark it
        // out of budget so the runner chains the continuation the closing
        // status promises; without this the run closed as "completed" and the
        // work silently stopped here instead of resuming in a fresh segment.
        closedByDeadline = true;
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
          (await hasAgentStopAfter(ownerId, chatId, runStartedAt))
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
            content: `${modelContent}\n\n⚠️ (This model cannot view image attachments, so the uploaded image is not visible here - it is still saved in the workspace. Say so plainly and work from what the user says.)`,
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
      const calls =
        result.toolCalls.length > 0
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
      // Keep the ledger in the order the user watched: the line that announced
      // the tools, then the tools themselves. A round that ends the turn
      // (end_turn) persists its text as the turn's reply further down, and a
      // recovered call is the model's malformed JSON rather than chat text -
      // neither of those is narration.
      if (
        !calls.some(call => call.name === "end_turn") &&
        !recoveredCall &&
        result.text.trim()
      )
        await persistRoundText(result.text);
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
            if (typeof parsed?.reply === "string")
              endTurnReply = parsed.reply.trim();
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
        if (await hasAgentStopAfter(ownerId, chatId, runStartedAt))
          return stopRun();
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
            summary:
              "Refused: this identical call already failed twice in this run.",
          });
          lastRoundSummaries.push(
            `Failed: ${call.name} - refused, the identical call already failed twice.`
          );
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
              executeWorkspaceTool(
                ownerId,
                computer,
                call,
                detail => {
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
                },
                agentSandbox,
                ownCodingGate,
                options.channel,
                deadlineAtMs,
                chatId,
                // The editor specialist's own tool calls stream as real
                // activity rows: emitted live to the open chat AND persisted
                // through emitTool, so they read back from the ledger exactly
                // like the agent's own tool calls.
                subTool => emitTool(subTool),
                options.agentChat
              ),
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
              failureDetail.length > 500
                ? `${failureDetail.slice(0, 500)}…`
                : failureDetail
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
          ...(execution.diff ? { diff: execution.diff } : {}),
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
        if (call.name === "editor") {
          codeTaskUsed = true;
          coderNudgePending = false;
          // A working specialist clears any lingering acceptance question:
          // self-coding rules return to the normal mandatory-delegation mode.
          if (
            execution.ok &&
            (ownCodingGate.awaitingAcceptance || priorAcceptance !== "none")
          ) {
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
          if (
            isCodeFileName(execution.action.name) &&
            isSubstantialCode(written)
          ) {
            coderNudgePending = true;
            coderNudgeFile = execution.action.name;
          }
        }
      }
      // Coder-delegation guard: deliver the queued nudge once, only when the
      // run is continuing anyway - never on the closing or end_turn exits.
      // With the specialist confirmed down, self-coding is disclosed
      // degraded mode - nudging back toward the editor would be noise.
      if (
        coderNudgePending &&
        !closedByDeadline &&
        !endTurnCalled &&
        !specialistDown
      ) {
        coderNudgePending = false;
        coderNudgeSent = true;
        messages.push({ role: "user", content: coderNudgeFor(coderNudgeFile) });
      }
      // Failure disclosure: one nudge per run, queued the first time a
      // round's tool calls fail and delivered after the round's results
      // (never on the closing or end_turn exits, where the reply is already
      // final and the error-path note below carries the failures instead).
      if (
        failedSteps.length > 0 &&
        !failureNudgeSent &&
        !closedByDeadline &&
        !endTurnCalled
      ) {
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
    console.error("[Chat] AI gateway chat failed", error);
    const kind =
      error instanceof AiGatewayClientError ? error.kind : "unavailable";
    const failureNote =
      "\n\nNova lost the connection to its AI service before this reply finished. Everything so far is saved - send another message and I will continue from here.";
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
    // Failure replies never quote the backend error: raw detail (provider
    // endpoints, database causes, config names) is for the server logs only
    // - the catch above already console.error'd it. Each kind keeps an
    // actionable, user-facing lead instead, so no internal service or
    // environment detail reaches the chat.
    let reply: string;
    if (kind === "configuration") {
      reply =
        "Nova's AI is not connected on this workspace yet. An administrator must finish setting it up before chat is available.";
    } else if (kind === "allowance_reached") {
      reply =
        "Nova's shared request allowance has been reached. New requests are blocked until an administrator raises the cap.";
    } else if (kind === "credits_exhausted") {
      reply =
        "Your daily Nova credits are used up (1 credit = 1¢). They reset tomorrow; everything so far is saved.";
    } else if (kind === "rate_limit") {
      reply =
        "Too many requests right now. Everything so far is saved - please try again in a little while.";
    } else if (kind === "client_error") {
      reply =
        "Nova's AI service rejected this request (for example an unsupported model or an oversized prompt). Retrying cannot fix that, so I stopped. Please adjust the request and try again; everything so far is saved.";
    } else {
      // A long tool-calling run often streams part of the reply to the client
      // (the Telegram placeholder, the web stream) before the gateway fails
      // mid-run. Keep what the user already watched instead of throwing it
      // away and replacing it with an error notice.
      const partial = streamedRunText.trim();
      if (partial) {
        reply = partial + failureNote;
      } else if (kind === "invalid_response") {
        reply =
          "Nova's AI service returned an invalid response. Please try again shortly.";
      } else {
        // The real error (network failure, upstream 5xx body, database cause)
        // stays in the server log above; the chat gets a fixed generic notice
        // instead of an internal service or endpoint name.
        reply =
          AI_UNAVAILABLE_PREFIX +
          "Nova hit an unexpected error and could not finish this reply. Everything so far is saved - please try again shortly.";
      }
    }
    // Only emit what the client has not already seen streamed live.
    await options.onChunk?.(
      streamedRunText.trim() ? failureNote : reply + failedStepsNote
    );
    const message = await persistAssistant(reply + failedStepsNote);
    return { message, actions, outOfBudget: false };
  } finally {
    // End of run, on every exit path (completed, stopped, deadline, error):
    // sync the live sandbox filesystem - files created or changed by bash,
    // VM tasks, or mirrored tool ops - back into the durable Neon/S3 store,
    // then pause the persistent machine so it is not billed while idle.
    if (agentSandbox && sandboxWorkspaceId !== undefined) {
      await syncAgentSandbox(ownerId, sandboxWorkspaceId, agentSandbox);
      // A run chaining straight into its next segment resumes within seconds:
      // pausing it would add a cold resume to every continuation, so it is
      // left warm. Every other exit path pauses. The next run reconnects and
      // E2B auto-resumes the paused machine.
      if (!options.continuationPlanned)
        await pauseAgentSandbox(ownerId, sandboxWorkspaceId, agentSandbox);
    }
  }
}
