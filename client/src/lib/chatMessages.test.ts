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
      reconcileChatMessages(before, "what is 2+2", "", []).userCommitted
    ).toBe(false);

    const after: PersistedChatMessage[] = [
      ...before,
      { id: 3, role: "user", content: "what is 2+2" },
    ];
    expect(
      reconcileChatMessages(after, "what is 2+2", "", []).userCommitted
    ).toBe(true);
  });

  it("keeps the streaming bubble until the reply is persisted", () => {
    const persisted: PersistedChatMessage[] = [
      { id: 1, role: "user", content: "hello" },
    ];
    expect(
      reconcileChatMessages(persisted, "hello", "Nova is", []).replyCommitted
    ).toBe(false);

    const after: PersistedChatMessage[] = [
      ...persisted,
      { id: 2, role: "assistant", content: "Nova is here." },
    ];
    expect(
      reconcileChatMessages(after, "hello", "Nova is here.", []).replyCommitted
    ).toBe(true);
  });

  it("never renders a tool activity that is already persisted", () => {
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
      "read it",
      "",
      live
    );
    expect(liveActivities.map(a => a.id)).toEqual(["tool-2"]);
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
});
