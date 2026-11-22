import { beforeEach, describe, expect, it, vi } from "vitest";
import { runThinkerTask } from "./thinker";

const state = vi.hoisted(() => ({
  model: "community/morriszdweck/glm-5.3-flash-free",
  apiUrl: "https://gen.pollinations.ai/v1",
  apiKey: "sk-poll",
  configured: true,
}));
vi.mock("./_core/env", () => ({
  ENV: {
    get thinkerModel() {
      return state.model;
    },
    get thinkerApiUrl() {
      return state.apiUrl;
    },
    get thinkerApiKey() {
      return state.apiKey;
    },
  },
}));

const runNimChatMock = vi.hoisted(() => vi.fn());
vi.mock("./nim", () => {
  class NimConfigError extends Error {}
  return {
    runNimChat: runNimChatMock,
    isNimConfigured: () => state.configured,
    NimConfigError,
  };
});

beforeEach(() => {
  runNimChatMock.mockReset();
  state.model = "community/morriszdweck/glm-5.3-flash-free";
  state.apiUrl = "https://gen.pollinations.ai/v1";
  state.apiKey = "sk-poll";
  state.configured = true;
});

describe("runThinkerTask", () => {
  it("assembles the question and context into one reasoning prompt on the smart model", async () => {
    runNimChatMock.mockResolvedValueOnce(
      "Restated: should we cache?\n\n## Findings\n\nYes, with a short TTL."
    );

    const result = await runThinkerTask(
      "Should we add a cache?",
      "The service does 500 rps and the data changes hourly."
    );

    expect(result.analysis).toBe(
      "Restated: should we cache?\n\n## Findings\n\nYes, with a short TTL."
    );
    expect(result.model).toBe("community/morriszdweck/glm-5.3-flash-free");
    const [options] = runNimChatMock.mock.calls[0];
    expect(options.systemPrompt).toContain("Nova's thinking specialist");
    expect(options.prompt).toBe(
      [
        "Question to think through:\n\nShould we add a cache?",
        "Context and material:\n\nThe service does 500 rps and the data changes hourly.",
      ].join("\n\n")
    );
    // It runs on the configured thinker endpoint and model.
    expect(options.model).toBe("community/morriszdweck/glm-5.3-flash-free");
    expect(options.apiUrl).toBe("https://gen.pollinations.ai/v1");
    expect(options.apiKey).toBe("sk-poll");
  });

  it("omits the context block when only the question is provided", async () => {
    runNimChatMock.mockResolvedValueOnce("Analysis.");
    await runThinkerTask("Is this plan sound?");
    expect(runNimChatMock.mock.calls[0][0].prompt).toBe(
      "Question to think through:\n\nIs this plan sound?"
    );
  });

  it("rejects an empty task before calling the model", async () => {
    await expect(runThinkerTask("   ")).rejects.toThrow(
      "A thinking task is required."
    );
    expect(runNimChatMock).not.toHaveBeenCalled();
  });

  it("requires a configured model endpoint before calling NIM", async () => {
    state.configured = false;
    await expect(runThinkerTask("a hard question")).rejects.toThrow(
      "The thinker sub-agent is not configured on this workspace"
    );
    expect(runNimChatMock).not.toHaveBeenCalled();
  });

  it("propagates model failures to the caller", async () => {
    runNimChatMock.mockRejectedValueOnce(
      new Error("NVIDIA NIM responded with status 429: rate limited")
    );
    await expect(runThinkerTask("a hard question")).rejects.toThrow(
      "rate limited"
    );
  });
});
