import { describe, expect, it } from "vitest";
import {
  appendLiveTextDelta,
  dedupeToolActivityMessages,
  parsePersistedToolActivity,
  upsertLiveToolEvent,
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

describe("dedupeToolActivityMessages", () => {
  const tool = (id: number, state: string) => ({
    id,
    role: "assistant" as const,
    content: `__nova_tool_activity__:${JSON.stringify({ id: `call-${id}`, name: "create_file", state, args: { arguments: "{}" } })}`,
  });
  const plain = (id: number, role: "user" | "assistant" = "user") => ({
    id,
    role,
    content: "hello",
  });

  it("keeps only the latest row per tool activity id", () => {
    const result = dedupeToolActivityMessages([
      plain(1),
      tool(2, "running"),
      tool(3, "running"),
      tool(4, "completed"),
    ]);
    expect(result).toHaveLength(4);
    const collapsed = dedupeToolActivityMessages([
      plain(1),
      tool(2, "running"),
      tool(3, "running"),
      tool(4, "completed"),
      tool(3, "completed"),
    ]);
    expect(collapsed).toHaveLength(4);
    expect(parsePersistedToolActivity(collapsed[1]!.content)!.state).toBe(
      "running"
    );
    expect(parsePersistedToolActivity(collapsed[3]!.content)!.state).toBe(
      "completed"
    );
  });

  it("leaves non-tool messages and single-state tools untouched", () => {
    const input = [plain(1), tool(2, "completed"), plain(3, "assistant")];
    expect(dedupeToolActivityMessages(input)).toEqual(input);
  });

  it("collapses a running row once its final state is persisted", () => {
    const result = dedupeToolActivityMessages([
      tool(2, "running"),
      tool(2, "failed"),
    ]);
    expect(result).toHaveLength(1);
    expect(parsePersistedToolActivity(result[0]!.content)!.state).toBe("failed");
  });
});

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

  it("carries the optional detail payload through persistence", () => {
    const withDetail = parsePersistedToolActivity(
      `${TOOL_ACTIVITY_MESSAGE_PREFIX}${JSON.stringify({
        id: "r1",
        name: "research_web",
        state: "completed",
        args: { arguments: "{}" },
        summary: "Researched: topic.",
        detail: "Full report body…\n\nAll sources consulted by the researcher:\n1. src - https://src",
      })}`
    );
    expect(withDetail?.detail).toContain("Full report body");
    expect(parsePersistedToolActivity(persistedToolMessage)?.detail).toBeUndefined();
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

describe("mergeToolActivity", () => {
  const base: ToolActivity = { id: "t1", name: "code_task", state: "running", args: {} };

  it("appends each fresh running progress note to the log", async () => {
    const { mergeToolActivity } = await import("./chatMessages");
    const step1 = mergeToolActivity(base, { ...base, detail: "The specialist is listing the workspace files..." });
    expect(step1.progressLog).toEqual(["The specialist is listing the workspace files..."]);
    const step2 = mergeToolActivity(step1, { ...step1, detail: "The specialist wrote app.py..." });
    expect(step2.progressLog).toEqual([
      "The specialist is listing the workspace files...",
      "The specialist wrote app.py...",
    ]);
    expect(step2.detail).toBe("The specialist wrote app.py...");
  });

  it("does not log a repeated or missing detail", async () => {
    const { mergeToolActivity } = await import("./chatMessages");
    const step1 = mergeToolActivity(base, { ...base, detail: "Working..." });
    const step2 = mergeToolActivity(step1, { ...step1, detail: "Working..." });
    expect(step2.progressLog).toEqual(["Working..."]);
    const bare = mergeToolActivity(step2, { ...step2 });
    expect(bare.progressLog).toEqual(["Working..."]);
  });

  it("drops the log when the tool finishes", async () => {
    const { mergeToolActivity } = await import("./chatMessages");
    const running = mergeToolActivity(base, { ...base, detail: "Working..." });
    const done = mergeToolActivity(running, { ...running, state: "completed", detail: "Final result." });
    expect(done.state).toBe("completed");
    expect(done.progressLog).toBeUndefined();
  });
});

describe("appendLiveTextDelta", () => {
  it("extends the trailing text segment with consecutive deltas", () => {
    const events = appendLiveTextDelta([], "Let me check ");
    const grown = appendLiveTextDelta(events, "that for you.");
    expect(grown).toEqual([{ kind: "text", content: "Let me check that for you." }]);
  });

  it("starts a new segment when a tool call separates the text bursts", () => {
    let events = appendLiveTextDelta([], "Checking that now.");
    events = upsertLiveToolEvent(events, { id: "t-1", name: "read_file", state: "running", args: {} });
    events = appendLiveTextDelta(events, "Here is what I found.");
    expect(events.map(event => event.kind)).toEqual(["text", "tool", "text"]);
    expect(events[2]).toEqual({ kind: "text", content: "Here is what I found." });
  });

  it("ignores empty deltas", () => {
    const events = [{ kind: "text" as const, content: "hello" }];
    expect(appendLiveTextDelta(events, "")).toBe(events);
  });
});

describe("upsertLiveToolEvent", () => {
  const firstSighting = { id: "t-1", name: "read_file", state: "running" as const, args: {} };

  it("appends a new tool after the text that announced it, keeping arrival order", () => {
    let events = appendLiveTextDelta([], "One moment.");
    events = upsertLiveToolEvent(events, firstSighting);
    expect(events).toEqual([
      { kind: "text", content: "One moment." },
      { kind: "tool", activity: expect.objectContaining({ id: "t-1", state: "running" }) },
    ]);
  });

  it("merges a state update in place instead of moving the tool", () => {
    let events = appendLiveTextDelta([], "Looking.");
    events = upsertLiveToolEvent(events, firstSighting);
    events = upsertLiveToolEvent(events, { id: "t-2", name: "run_bash", state: "running", args: {} });
    events = appendLiveTextDelta(events, "Almost done.");
    events = upsertLiveToolEvent(events, { ...firstSighting, state: "completed", detail: "done" });
    expect(events.map(event => event.kind)).toEqual(["text", "tool", "tool", "text"]);
    expect(events[1]).toMatchObject({ kind: "tool", activity: { id: "t-1", state: "completed" } });
    expect(events[3]).toEqual({ kind: "text", content: "Almost done." });
  });

  it("accumulates progress notes on a running tool like the previous accumulator did", () => {
    let events = upsertLiveToolEvent([], firstSighting);
    events = upsertLiveToolEvent(events, { ...firstSighting, detail: "step one" });
    events = upsertLiveToolEvent(events, { ...firstSighting, detail: "step two" });
    const tool = events[0] as { kind: "tool"; activity: { progressLog?: string[] } };
    expect(tool.activity.progressLog).toEqual(["step one", "step two"]);
  });
});
