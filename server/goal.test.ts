import { describe, expect, it, vi } from "vitest";
import {
  buildGoalContinuationPrompt,
  buildGoalInstruction,
  GOAL_COMMAND,
  GOAL_USAGE,
  parseGoalCommand,
  REPORT_GOAL_TOOL,
  recordGoalState,
} from "./goal";
import { parseGoalMarker } from "@shared/goal";

const appendChatMessageForUser = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ appendChatMessageForUser }));

describe("parseGoalCommand", () => {
  it("reads the objective after the command", () => {
    expect(parseGoalCommand("/goal get Lighthouse to 95")).toEqual({
      kind: "set",
      objective: "get Lighthouse to 95",
    });
  });

  it("tolerates the bot suffix Telegram adds in group chats", () => {
    expect(parseGoalCommand("/goal@NovaBot ship the beta")).toEqual({
      kind: "set",
      objective: "ship the beta",
    });
    expect(parseGoalCommand("  /GOAL ship the beta")).toEqual({
      kind: "set",
      objective: "ship the beta",
    });
  });

  it("answers a bare command with usage rather than chasing nothing", () => {
    expect(parseGoalCommand("/goal")).toEqual({ kind: "usage" });
    expect(parseGoalCommand("/goal   ")).toEqual({ kind: "usage" });
  });

  it("recognizes the words that drop a goal", () => {
    expect(parseGoalCommand("/goal clear")).toEqual({ kind: "clear" });
    expect(parseGoalCommand("/goal Clear")).toEqual({ kind: "clear" });
    expect(parseGoalCommand("/goal reset")).toEqual({ kind: "clear" });
    expect(parseGoalCommand("/goal cancel")).toEqual({ kind: "clear" });
    // An objective that merely starts with one of those words is an objective.
    expect(parseGoalCommand("/goal clear the stale builds")).toEqual({
      kind: "set",
      objective: "clear the stale builds",
    });
  });

  it("ignores messages that are not the command", () => {
    expect(parseGoalCommand("hello")).toBeNull();
    expect(parseGoalCommand("")).toBeNull();
    expect(parseGoalCommand(undefined)).toBeNull();
    expect(parseGoalCommand("/goals are useful")).toBeNull();
    expect(parseGoalCommand("my /goal is to ship")).toBeNull();
    expect(parseGoalCommand("/ultraplan do this")).toBeNull();
  });

  it("caps a runaway objective", () => {
    const command = parseGoalCommand(`/goal ${"x".repeat(5000)}`);
    expect(command?.kind).toBe("set");
    expect(command?.kind === "set" && command.objective.length).toBe(600);
  });

  it("names a command the slash menu also offers", () => {
    expect(GOAL_COMMAND).toBe("/goal");
  });
});

describe("buildGoalInstruction", () => {
  const instruction = buildGoalInstruction("ship the beta", "web");

  it("states the objective and forbids handing back a plan", () => {
    expect(instruction).toContain("ship the beta");
    expect(instruction).toContain("Planning IS NOT the deliverable");
    expect(instruction).toContain(REPORT_GOAL_TOOL);
  });

  it("explains that end_turn alone does not end the chase", () => {
    expect(instruction).toContain("end_turn does not end the pursuit");
  });

  it("describes both ways the chase can end", () => {
    expect(instruction).toContain('outcome "met"');
    expect(instruction).toContain('outcome "blocked"');
  });

  it("tells a Telegram chase to post its own updates", () => {
    expect(buildGoalInstruction("ship it", "telegram")).toContain(
      "send_progress_update"
    );
    expect(buildGoalInstruction("ship it", "web")).not.toContain(
      "send_progress_update"
    );
  });

  it("mentions the allowance only once a chase has more than one run", () => {
    expect(instruction).not.toContain("runs it is allowed");
    expect(
      buildGoalInstruction("ship it", "web", { segments: 3, maxSegments: 6 })
    ).toContain("2 of the 6 runs it is allowed");
  });
});

describe("buildGoalContinuationPrompt", () => {
  it("sends the model back to work on the same objective", () => {
    const prompt = buildGoalContinuationPrompt("ship the beta");
    expect(prompt).toContain("ship the beta");
    expect(prompt).toContain(REPORT_GOAL_TOOL);
    expect(prompt).toContain("do not hand back a plan");
  });
});

describe("recordGoalState", () => {
  it("writes one ledger row the client can read back", async () => {
    appendChatMessageForUser.mockResolvedValue(undefined);
    await recordGoalState(7, "chat-1", {
      objective: "ship the beta",
      status: "active",
      segments: 2,
    });
    const row = appendChatMessageForUser.mock.calls[0][1];
    expect(row.chatId).toBe("chat-1");
    expect(row.role).toBe("assistant");
    expect(parseGoalMarker(row.content)).toEqual({
      objective: "ship the beta",
      status: "active",
      segments: 2,
    });
  });

  it("never throws when the ledger write fails", async () => {
    appendChatMessageForUser.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordGoalState(7, "chat-1", {
        objective: "x",
        status: "unfinished",
        segments: 1,
      })
    ).resolves.toBeUndefined();
  });
});

describe("GOAL_USAGE", () => {
  it("explains how to set, and drop, a goal", () => {
    expect(GOAL_USAGE).toContain("/goal");
    expect(GOAL_USAGE).toContain("/goal clear");
  });
});
