import { beforeEach, describe, expect, it } from "vitest";
import { hasLocalAgentStopAfter, noteAgentStop, resetAgentStopSignals } from "./agentStopSignals";

beforeEach(() => {
  resetAgentStopSignals();
});

describe("in-process agent stop signals", () => {
  it("is empty until a stop is served", () => {
    expect(hasLocalAgentStopAfter(7, "chat-1", new Date(Date.now() - 1_000))).toBe(false);
  });

  it("matches a stop recorded after the run started", () => {
    const start = new Date(Date.now() - 1_000);
    noteAgentStop(7, "chat-1");
    expect(hasLocalAgentStopAfter(7, "chat-1", start)).toBe(true);
  });

  it("ignores a stop recorded before the run started", () => {
    const start = new Date(Date.now() + 1_000);
    noteAgentStop(7, "chat-1", Date.now() - 5_000);
    expect(hasLocalAgentStopAfter(7, "chat-1", start)).toBe(false);
  });

  it("scopes a chat stop to that chat but applies a workspace-wide stop to every chat", () => {
    const start = new Date(Date.now() - 1_000);
    noteAgentStop(7, "chat-1");
    expect(hasLocalAgentStopAfter(7, "chat-1", start)).toBe(true);
    expect(hasLocalAgentStopAfter(7, "chat-2", start)).toBe(false);
    // A run with no chat id is workspace-wide, like the database check.
    expect(hasLocalAgentStopAfter(7, undefined, start)).toBe(true);

    resetAgentStopSignals();
    noteAgentStop(7, null);
    expect(hasLocalAgentStopAfter(7, "chat-2", start)).toBe(true);
  });

  it("keeps other owners isolated", () => {
    const start = new Date(Date.now() - 1_000);
    noteAgentStop(7, "chat-1");
    expect(hasLocalAgentStopAfter(8, "chat-1", start)).toBe(false);
  });
});
