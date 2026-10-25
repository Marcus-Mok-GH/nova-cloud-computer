import { describe, expect, it } from "vitest";
import {
  formatGoalMarker,
  latestGoalState,
  parseGoalMarker,
  type GoalState,
} from "@shared/goal";
import { GOAL_MESSAGE_PREFIX } from "@shared/const";
import { SLASH_COMMANDS } from "@shared/commands";
import { isInternalChatMessage } from "./chatMessages";

// `shared/**` is outside the vitest include globs, so the shared goal-row
// module is covered from here - the client is one of its two readers, and the
// behaviour that matters is that both readers resolve the same rows the same
// way.

const row = (state: GoalState) => ({
  role: "assistant",
  content: formatGoalMarker(state),
});

describe("goal rows", () => {
  it("round-trips a goal's state", () => {
    const state: GoalState = {
      objective: "get the landing page to Lighthouse 95",
      status: "active",
      segments: 2,
    };
    expect(parseGoalMarker(formatGoalMarker(state))).toEqual(state);
  });

  it("carries the shared marker prefix", () => {
    expect(
      formatGoalMarker({ objective: "x", status: "met", segments: 1 })
    ).toMatch(new RegExp(`^${GOAL_MESSAGE_PREFIX}`));
  });

  it("accepts every status, including a cleared row with no objective", () => {
    for (const status of ["active", "met", "unfinished"] as const)
      expect(
        parseGoalMarker(formatGoalMarker({ objective: "x", status, segments: 1 }))
          ?.status
      ).toBe(status);
    expect(
      parseGoalMarker(
        formatGoalMarker({ objective: "", status: "cleared", segments: 0 })
      )
    ).toEqual({ objective: "", status: "cleared", segments: 0 });
  });

  it("treats a damaged row as no goal rather than chasing it", () => {
    expect(parseGoalMarker(`${GOAL_MESSAGE_PREFIX}{`)).toBeNull();
    expect(parseGoalMarker(`${GOAL_MESSAGE_PREFIX}{"status":"active"}`)).toBeNull();
    expect(
      parseGoalMarker(
        `${GOAL_MESSAGE_PREFIX}{"objective":"x","status":"sideways"}`
      )
    ).toBeNull();
    expect(
      parseGoalMarker(`${GOAL_MESSAGE_PREFIX}{"objective":"","status":"met"}`)
    ).toBeNull();
    expect(parseGoalMarker("just a message")).toBeNull();
  });

  it("falls back to zero segments when the count is unusable", () => {
    expect(
      parseGoalMarker(
        `${GOAL_MESSAGE_PREFIX}{"objective":"x","status":"active","segments":"many"}`
      )
    ).toEqual({ objective: "x", status: "active", segments: 0 });
    expect(
      parseGoalMarker(
        `${GOAL_MESSAGE_PREFIX}{"objective":"x","status":"active","segments":-4}`
      )
    ).toEqual({ objective: "x", status: "active", segments: 0 });
  });

  it("resolves the conversation's goal from its latest row", () => {
    const messages = [
      row({ objective: "first", status: "active", segments: 1 }),
      { role: "user", content: "how is it going?" },
      row({ objective: "second", status: "active", segments: 2 }),
    ];
    expect(latestGoalState(messages)).toEqual({
      objective: "second",
      status: "active",
      segments: 2,
    });
  });

  it("stops chasing once the goal is cleared or reported", () => {
    expect(
      latestGoalState([
        row({ objective: "ship it", status: "active", segments: 1 }),
        row({ objective: "", status: "cleared", segments: 0 }),
      ])?.status
    ).toBe("cleared");
    expect(
      latestGoalState([
        row({ objective: "ship it", status: "active", segments: 1 }),
        row({ objective: "ship it", status: "met", segments: 1 }),
      ])?.status
    ).toBe("met");
  });

  it("has no goal for a conversation that never set one", () => {
    expect(latestGoalState([])).toBeNull();
    expect(
      latestGoalState([{ role: "user", content: "hello" }])
    ).toBeNull();
  });
});

describe("goal rows in the chat UI", () => {
  it("are filtered out of the visible transcript", () => {
    expect(
      isInternalChatMessage(
        formatGoalMarker({ objective: "x", status: "active", segments: 1 })
      )
    ).toBe(true);
    expect(isInternalChatMessage("a real reply")).toBe(false);
  });
});

describe("the slash menu", () => {
  it("offers the goal command", () => {
    const goal = SLASH_COMMANDS.find(command => command.name === "/goal");
    expect(goal?.args).toBe("<objective>");
    expect(goal?.description).toBeTruthy();
  });
});
