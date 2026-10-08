import { describe, expect, it, vi } from "vitest";

const appendChatMessageForUser = vi.fn(async () => ({ id: 1 }));

vi.mock("./db", () => ({
  appendChatMessageForUser,
}));

const {
  AGENT_MODE_MESSAGE_PREFIX,
  START_PLANNING_TOOL,
  buildBuildModeInstruction,
  buildChatModePromptBlock,
  chatModeAllowsTool,
  readAgentModeMarker,
  recordAgentMode,
  resolveAgentMode,
} = await import("./agentMode");

describe("readAgentModeMarker", () => {
  it("returns null when the chat has no marker", () => {
    expect(
      readAgentModeMarker([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ])
    ).toBeNull();
  });

  it("reads the latest marker, ignoring non-mode rows", () => {
    expect(
      readAgentModeMarker([
        { role: "assistant", content: `${AGENT_MODE_MESSAGE_PREFIX}chat` },
        { role: "user", content: "do something" },
        { role: "assistant", content: `${AGENT_MODE_MESSAGE_PREFIX}build` },
      ])
    ).toBe("build");
  });

  it("falls back to chat for an unrecognised marker value", () => {
    expect(
      readAgentModeMarker([
        { role: "assistant", content: `${AGENT_MODE_MESSAGE_PREFIX}wat` },
      ])
    ).toBe("chat");
  });
});

describe("resolveAgentMode", () => {
  it("starts a chat with no assistant turn in chat mode", () => {
    expect(
      resolveAgentMode([{ role: "user", content: "build me a site" }])
    ).toEqual({ mode: "chat", isNewChat: true, fromPlan: false });
  });

  it("keeps an existing conversation without a marker in build mode", () => {
    expect(
      resolveAgentMode([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "and now?" },
      ])
    ).toEqual({ mode: "build", isNewChat: false, fromPlan: false });
  });

  it("honours chat and build markers", () => {
    expect(
      resolveAgentMode([
        { role: "assistant", content: `${AGENT_MODE_MESSAGE_PREFIX}chat` },
      ]).mode
    ).toBe("chat");
    expect(
      resolveAgentMode([
        { role: "assistant", content: `${AGENT_MODE_MESSAGE_PREFIX}build` },
      ]).mode
    ).toBe("build");
  });

  it("enters build when the user replies after a plan", () => {
    expect(
      resolveAgentMode([
        { role: "assistant", content: `${AGENT_MODE_MESSAGE_PREFIX}plan` },
      ])
    ).toEqual({ mode: "build", isNewChat: false, fromPlan: true });
  });
});

describe("chatModeAllowsTool", () => {
  it("allows research and the transition tool only", () => {
    for (const name of [
      "end_turn",
      "list_workspace",
      "read_file",
      "search_memories",
      "read_memory",
      "solve_equation",
      "research_web",
      "thinker",
      START_PLANNING_TOOL,
    ])
      expect(chatModeAllowsTool(name)).toBe(true);
    for (const name of [
      "create_file",
      "edit_file",
      "delete_file",
      "create_folder",
      "editor",
      "run_bash",
      "run_vm_task",
      "deploy_website",
      "create_plan",
      "edit_plan",
      "save_memory",
      "github",
      "some_future_write_tool",
    ])
      expect(chatModeAllowsTool(name)).toBe(false);
  });
});

describe("mode instructions", () => {
  it("frames chat mode around researching and handing actions to planning", () => {
    const block = buildChatModePromptBlock();
    expect(block).toContain("[CHAT MODE]");
    expect(block).toContain("do NOT perform any action");
    expect(block).toContain(START_PLANNING_TOOL);
  });

  it("names the conversation's plan document in the build instruction", () => {
    const instruction = buildBuildModeInstruction(3);
    expect(instruction).toContain("[BUILD mode]");
    expect(instruction).toContain("PLAN_3.md");
  });

  it("sanitizes the chat id in the build instruction", () => {
    expect(buildBuildModeInstruction("a/b")).toContain("PLAN_a_b.md");
  });
});

describe("recordAgentMode", () => {
  it("appends an internal marker row", async () => {
    await recordAgentMode(1, "3", "plan");
    expect(appendChatMessageForUser).toHaveBeenCalledWith(1, {
      chatId: "3",
      role: "assistant",
      content: `${AGENT_MODE_MESSAGE_PREFIX}plan`,
    });
  });
});
