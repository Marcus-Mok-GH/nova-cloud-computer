import { getWorkspaceComputer } from "../db";
import type { AgentAction } from "../workspace/workspaceAgentTypes";
import type { ExaCitation } from "../exa";
import type { DesktopCapture } from "../desktopBrowser";
import type { SandboxOp } from "../sandboxWorkspace";

export type Computer = Awaited<ReturnType<typeof getWorkspaceComputer>>;
export type FolderRow = Computer["folders"][number];
export type FileRow = Computer["files"][number];
export type FolderRowLike = { id: number; name: string; parentId: number | null };

export type ToolExecution = {
  ok: boolean;
  result: string;
  action?: AgentAction;
  /** Full raw response surfaced in the research dropdown in the UI. */
  detail?: string;
  /** Unified diff of the change, surfaced in the edit_file dropdown in the UI. */
  diff?: string;
  /**
   * The web sources this call consulted, in structured form so the run can
   * list them at the bottom of the reply it delivers. Only research_web sets
   * it - its report's source list would otherwise have to be re-parsed out of
   * the result text it appends for the model.
   */
  citations?: ExaCitation[];
  /**
   * Set when the coding specialist is confirmed unavailable (a non-config
   * error survived the internal retry, or NIM is not configured). The run
   * loop uses it to stop re-nudging toward the editor: with the specialist
   * down, self-coding is legitimate degraded mode - as long as the model
   * disclosed it to the user as the failure policy requires.
   */
  specialistDown?: boolean;
  /**
   * The desktop screenshot a browse call took, so the run loop can hand it
   * back to the model as vision input: seeing the screen is how the agent
   * decides where to click. Absent when the tool did not capture anything, or
   * when the capture was too large to attach.
   */
  screenshot?: DesktopCapture;
};

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

export const SPECIALIST_DOWN_BLOCK_RESULT =
  "Blocked: the coding specialist is down and the user has not accepted Nova's own coding yet. " +
  "Do NOT write this code yourself. Tell the user exactly that the coding specialist is down for this task, " +
  "ask whether to proceed with Nova's own attempt, and end your turn. Only in a later conversation turn, " +
  "once the user has explicitly accepted, call the accept_own_coding tool to record it - then you may write " +
  "the code yourself, saying plainly it is Nova's own work without the specialist.";

/**
 * Per-call context handed to every tool family: what a tool needs to read
 * and mutate about this workspace request. The executor parses the call's
 * arguments and builds the sandbox mirror once, then routes to the family.
 */
export type ToolCtx = {
  ownerId: number;
  computer: Computer;
  /** Parsed arguments of the model's tool call. */
  args: Record<string, unknown>;
  /** Trims arg values to strings; the model's own helper. */
  str: (value: unknown) => string;
  /** The computer's folder rows, pre-cast for path helpers. */
  folderRows: FolderRowLike[];
  /** Best-effort mirror of a durable workspace op onto the live sandbox. */
  mirror: (op: SandboxOp) => Promise<void>;
  gate?: OwnCodingGate;
  chatId?: string;
  channel?: "telegram" | "web";
};
