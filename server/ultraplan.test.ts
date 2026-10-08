import { describe, expect, it } from "vitest";
import {
  buildUltraplanInstruction,
  isPlanTool,
  parseUltraplanCommand,
  planFileName,
  ultraplanAllowsTool,
  ULTRAPLAN_COMMAND,
  ULTRAPLAN_USAGE,
} from "./ultraplan";

describe("parseUltraplanCommand", () => {
  it("recognizes the bare command with no task", () => {
    expect(parseUltraplanCommand(ULTRAPLAN_COMMAND)).toEqual({ task: "" });
  });

  it("captures everything after the command as the task", () => {
    expect(parseUltraplanCommand("/ultraplan build a login page")).toEqual({
      task: "build a login page",
    });
  });

  it("tolerates leading whitespace and multiple spaces", () => {
    expect(parseUltraplanCommand("  /ultraplan    refactor auth  ")).toEqual({
      task: "refactor auth",
    });
  });

  it("accepts a bot-addressed command (Telegram group chats)", () => {
    expect(parseUltraplanCommand("/ultraplan@NovaBot migrate the schema")).toEqual(
      { task: "migrate the schema" }
    );
  });

  it("keeps multi-line task text intact", () => {
    expect(parseUltraplanCommand("/ultraplan\nstep one\nstep two")).toEqual({
      task: "step one\nstep two",
    });
  });

  it("does not match a lookalike command or a mid-message mention", () => {
    expect(parseUltraplanCommand("/ultraplanning")).toBeNull();
    expect(parseUltraplanCommand("please /ultraplan this")).toBeNull();
    expect(parseUltraplanCommand("/plan do it")).toBeNull();
    expect(parseUltraplanCommand("")).toBeNull();
  });

  it("ignores non-string input", () => {
    expect(parseUltraplanCommand(undefined)).toBeNull();
    expect(parseUltraplanCommand(null)).toBeNull();
    expect(parseUltraplanCommand(42)).toBeNull();
  });
});

describe("buildUltraplanInstruction", () => {
  it("makes the plan the deliverable and blocks execution until approval", () => {
    const instruction = buildUltraplanInstruction("add billing", "web");
    expect(instruction).toContain("[ULTRAPLAN - deep planning mode]");
    expect(instruction).toContain("planning IS the deliverable");
    expect(instruction).toContain("wait for the user to approve it");
    expect(instruction).toContain("do NOT create, edit, move, rename, or delete");
    expect(instruction).toContain("add billing");
    // The structured plan sections.
    for (const section of [
      "EXECUTIVE SUMMARY",
      "APPROACHES",
      "EXECUTION PLAN",
      "RISKS",
      "FILES AFFECTED",
      "VERIFICATION",
    ])
      expect(instruction).toContain(section);
    // Deep exploration, not just a read of one file.
    expect(instruction).toContain("thinker");
    expect(instruction).toContain("list_workspace");
    // The read-only rule names the plan document as the sole write.
    expect(instruction).toContain("read-only except for the plan document");
    expect(instruction).toContain("create_plan");
    expect(instruction).toContain("edit_plan");
    expect(instruction).toContain("Save the finished plan");
  });

  it("asks for usage when the task is empty", () => {
    const instruction = buildUltraplanInstruction("", "web");
    expect(instruction).toContain("No task was given");
    expect(instruction).toContain("Do not explore, plan, or change anything");
  });

  it("formats for the web app as Markdown", () => {
    expect(buildUltraplanInstruction("x", "web")).toContain(
      "render the plan as clean Markdown"
    );
  });

  it("formats for Telegram as plain text", () => {
    const instruction = buildUltraplanInstruction("x", "telegram");
    expect(instruction).toContain("write the plan as plain text");
    expect(instruction).toContain("no markdown of any kind");
    expect(instruction).not.toContain("render the plan as clean Markdown");
  });

  it("exposes a usage line that names the command", () => {
    expect(ULTRAPLAN_USAGE).toContain("/ultraplan");
  });
});

describe("ultraplanAllowsTool", () => {
  it("allows the read-only exploration and reasoning tools", () => {
    for (const name of [
      "end_turn",
      "list_workspace",
      "read_file",
      "search_memories",
      "read_memory",
      "solve_equation",
      "research_web",
      "thinker",
      "create_plan",
      "edit_plan",
    ])
      expect(ultraplanAllowsTool(name)).toBe(true);
  });

  it("withholds every tool that could change state", () => {
    for (const name of [
      "create_file",
      "edit_file",
      "rename_file",
      "move_file",
      "delete_file",
      "create_folder",
      "rename_folder",
      "move_folder",
      "delete_folder",
      "run_bash",
      "run_vm_task",
      "editor",
      "deploy_website",
      "delete_website",
      "create_project_template",
      "send_telegram_message",
      "present_file",
      "send_progress_update",
      "set_communication_style",
      "set_personalisation",
      "save_memory",
      "delete_memory",
      "request_purchase",
      "send_agent_email",
      "accept_own_coding",
      "github",
      "list_connector_tools",
      "use_connector_tool",
      "browse",
    ])
      expect(ultraplanAllowsTool(name)).toBe(false);
  });

  it("excludes unknown tools by default", () => {
    expect(ultraplanAllowsTool("some_future_write_tool")).toBe(false);
  });
});

describe("plan tools", () => {
  it("recognizes exactly the two plan-writing tools", () => {
    expect(isPlanTool("create_plan")).toBe(true);
    expect(isPlanTool("edit_plan")).toBe(true);
    expect(isPlanTool("create_file")).toBe(false);
    expect(isPlanTool("edit_file")).toBe(false);
  });

  it("names the plan file after the chat id at the workspace root", () => {
    expect(planFileName("abc123")).toBe("PLAN_abc123.md");
  });

  it("sanitizes the chat id so the name is always file-safe", () => {
    expect(planFileName("a/b c:d")).toBe("PLAN_a_b_c_d.md");
    expect(planFileName(3)).toBe("PLAN_3.md");
    expect(planFileName(undefined)).toBe("PLAN_unknown.md");
  });
});
