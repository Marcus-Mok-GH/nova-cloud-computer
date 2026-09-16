import { beforeEach, describe, expect, it, vi } from "vitest";
import { isExaConfigured, runExaAgentResearch } from "./exa";

const state = vi.hoisted(() => ({ exaKey: "test-exa-key" }));
vi.mock("./_core/env", () => ({
  ENV: { get exaApiKey() { return state.exaKey; } },
}));

const completedRun = {
  id: "agent_run_01jtest",
  status: "completed",
  output: {
    text: "Nova is a workspace agent [1].",
    grounding: [{ field: "text", citations: [{ url: "https://nova.example/docs", title: "Nova docs" }] }],
  },
};

/** Builds a Response whose body streams the given SSE chunks. */
function sseResponse(chunks: string[], init?: { status?: number } & Record<string, unknown>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: init?.status ?? 200, headers: { "content-type": "text/event-stream" } });
}

const fetchStub = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchStub);
  fetchStub.mockReset();
  state.exaKey = "test-exa-key";
});

describe("isExaConfigured", () => {
  it("tracks whether the Exa API key is present", () => {
    expect(isExaConfigured()).toBe(true);
    state.exaKey = " ";
    expect(isExaConfigured()).toBe(false);
  });
});

describe("runExaAgentResearch", () => {
  it("follows the SSE stream to the completed run, ignoring keep-alives and unknown events", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse([
        ": keep-alive\n\n",
        'id: 1\nevent: agent_run.created\ndata: {"id":"agent_run_01jtest","status":"queued","createdAt":"2026-09-16T06:00:00.000Z"}\n\n',
        'id: 2\nevent: agent_run.started\ndata: {"id":"agent_run_01jtest","status":"running"}\n\n',
        'id: 3\nevent: agent_run.source.added\ndata: {"url":"https://nova.example/docs"}\n\n',
        `id: 4\nevent: agent_run.completed\ndata: ${JSON.stringify(completedRun)}\n\n`,
      ])
    );
    const run = await runExaAgentResearch({ query: "What is Nova?" });
    expect(run).toEqual(completedRun);

    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://api.exa.ai/agent/runs");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("test-exa-key");
    expect(init.headers.accept).toBe("text/event-stream");
    const body = JSON.parse(init.body);
    expect(body).toEqual({ query: "What is Nova?", effort: "medium" });
  });

  it("sends the system prompt and a custom effort when provided", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse([`event: agent_run.completed\ndata: ${JSON.stringify(completedRun)}\n\n`])
    );
    await runExaAgentResearch({ query: "q", systemPrompt: "Be thorough.", effort: "high" });
    expect(JSON.parse(fetchStub.mock.calls[0][1].body)).toEqual({
      query: "q",
      effort: "high",
      systemPrompt: "Be thorough.",
    });
  });

  it("reassembles frames that arrive split across stream chunks", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse([
        'id: 1\nevent: agent_run.cr',
        `eated\ndata: {"id":"agent_run_01jtest","status":"queued"}\n\nevent: agent_run.completed\ndata: ${JSON.stringify(completedRun)}\n\n`,
      ])
    );
    const run = await runExaAgentResearch({ query: "q" });
    expect(run.id).toBe("agent_run_01jtest");
  });

  it("reports every event through the onEvent observer", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse([
        'event: agent_run.created\ndata: {"id":"r1","status":"queued"}\n\n',
        `event: agent_run.completed\ndata: ${JSON.stringify(completedRun)}\n\n`,
      ])
    );
    const events: Array<[string, unknown]> = [];
    await runExaAgentResearch({ query: "q", onEvent: (event, data) => events.push([event, data]) });
    expect(events.map(([event]) => event)).toEqual(["agent_run.created", "agent_run.completed"]);
  });

  it("surfaces the failure message from agent_run.failed", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse(['event: agent_run.failed\ndata: {"id":"r1","status":"failed","error":{"code":"rate_limited","message":"too many runs"}}\n\n'])
    );
    await expect(runExaAgentResearch({ query: "q" })).rejects.toThrow("too many runs");
  });

  it("throws when the run is cancelled", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse(['event: agent_run.cancelled\ndata: {"id":"r1","status":"cancelled"}\n\n'])
    );
    await expect(runExaAgentResearch({ query: "q" })).rejects.toThrow("cancelled");
  });

  it("throws on a non-OK HTTP status", async () => {
    fetchStub.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    await expect(runExaAgentResearch({ query: "q" })).rejects.toThrow("status 401");
  });

  it("throws when the stream closes before a terminal event", async () => {
    fetchStub.mockResolvedValueOnce(sseResponse(['event: agent_run.created\ndata: {"id":"r1","status":"queued"}\n\n']));
    await expect(runExaAgentResearch({ query: "q" })).rejects.toThrow("stream ended");
  });

  it("requires a configured API key", async () => {
    state.exaKey = "";
    await expect(runExaAgentResearch({ query: "q" })).rejects.toThrow("EXA_API_KEY");
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
