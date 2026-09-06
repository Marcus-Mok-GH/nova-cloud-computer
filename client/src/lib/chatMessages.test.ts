import { describe, expect, it } from "vitest";
import {
  parsePersistedToolActivity,
  reconcileChatMessages,
  TOOL_ACTIVITY_MESSAGE_PREFIX,
  type PersistedChatMessage,
  type ToolActivity,
} from "./chatMessages";

const toolActivity: ToolActivity = {
  id: "tool-1",
  name: "read_file",
  state: "completed",
  args: { path: "/tmp/a.txt" },
};

const persistedToolMessage = `${TOOL_ACTIVITY_MESSAGE_PREFIX}${JSON.stringify(toolActivity)}`;

describe("reconcileChatMessages", () => {
  it("keeps the optimistic user bubble until the message is persisted", () => {
    const before: PersistedChatMessage[] = [
      { id: 1, role: "user", content: "older" },
      { id: 2, role: "assistant", content: "answer" },
    ];
    expect(
      reconcileChatMessages(before, 2, "what is 2+2", "", []).userCommitted
    ).toBe(false);

    const after: PersistedChatMessage[] = [
      ...before,
      { id: 3, role: "user", content: "what is 2+2" },
    ];
    expect(
      reconcileChatMessages(after, 2, "what is 2+2", "", []).userCommitted
    ).toBe(true);
  });

  it("keeps the streaming bubble until the reply is persisted", () => {
    const persisted: PersistedChatMessage[] = [
      { id: 1, role: "user", content: "hello" },
    ];
    expect(
      reconcileChatMessages(persisted, 1, "hello", "Nova is", []).replyCommitted
    ).toBe(false);

    const after: PersistedChatMessage[] = [
      ...persisted,
      { id: 2, role: "assistant", content: "Nova is here." },
    ];
    expect(
      reconcileChatMessages(after, 1, "hello", "Nova is here.", []).replyCommitted
    ).toBe(true);
  });

  it("does not treat a repeated prompt as committed by an earlier message", () => {
    const persisted: PersistedChatMessage[] = [
      { id: 1, role: "user", content: "hello" },
      { id: 2, role: "assistant", content: "hi" },
    ];
    // Baseline is the last persisted id; sending "hello" again must not match
    // the earlier id-1 message.
    expect(
      reconcileChatMessages(persisted, 2, "hello", "", []).userCommitted
    ).toBe(false);

    const after: PersistedChatMessage[] = [
      ...persisted,
      { id: 3, role: "user", content: "hello" },
    ];
    expect(
      reconcileChatMessages(after, 2, "hello", "", []).userCommitted
    ).toBe(true);
  });

  it("hides a live tool activity once it is persisted in this submission", () => {
    const before: PersistedChatMessage[] = [
      { id: 1, role: "user", content: "read it" },
    ];
    const after: PersistedChatMessage[] = [
      ...before,
      { id: 2, role: "assistant", content: persistedToolMessage },
    ];
    const live: ToolActivity[] = [
      toolActivity,
      { ...toolActivity, id: "tool-2", state: "running" },
    ];
    const { liveActivities } = reconcileChatMessages(
      after,
      1,
      "read it",
      "",
      live
    );
    expect(liveActivities.map(a => a.id)).toEqual(["tool-2"]);
  });

  it("keeps a fresh tool activity that reuses a prior turn's id", () => {
    const persisted: PersistedChatMessage[] = [
      { id: 1, role: "assistant", content: persistedToolMessage },
      { id: 2, role: "user", content: "read it" },
    ];
    const live: ToolActivity[] = [
      toolActivity,
      { ...toolActivity, id: "tool-2", state: "running" },
    ];
    const { liveActivities } = reconcileChatMessages(
      persisted,
      2,
      "read it",
      "",
      live
    );
    expect(liveActivities.map(a => a.id)).toEqual(["tool-1", "tool-2"]);
  });

  it("parses only well-formed persisted tool activity rows", () => {
    expect(parsePersistedToolActivity(persistedToolMessage)).toEqual(
      toolActivity
    );
    expect(parsePersistedToolActivity("plain message")).toBeNull();
    expect(
      parsePersistedToolActivity(`${TOOL_ACTIVITY_MESSAGE_PREFIX}not-json`)
    ).toBeNull();
    expect(
      parsePersistedToolActivity(`${TOOL_ACTIVITY_MESSAGE_PREFIX}{"name":1}`)
    ).toBeNull();
  });

  it("rejects non-string or nested args", () => {
    const nested = parsePersistedToolActivity(
      `${TOOL_ACTIVITY_MESSAGE_PREFIX}${JSON.stringify({
        id: "t",
        name: "n",
        state: "completed",
        args: { a: { nested: true } },
      })}`
    );
    expect(nested?.args).toEqual({});

    const arrayArgs = parsePersistedToolActivity(
      `${TOOL_ACTIVITY_MESSAGE_PREFIX}${JSON.stringify({
        id: "t",
        name: "n",
        state: "completed",
        args: ["a", "b"],
      })}`
    );
    expect(arrayArgs?.args).toEqual({});
  });
});
