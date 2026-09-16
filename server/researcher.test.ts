import { beforeEach, describe, expect, it, vi } from "vitest";
import { runResearch } from "./researcher";

const state = vi.hoisted(() => ({ exaKey: "test-exa-key" }));
vi.mock("./_core/env", () => ({
  ENV: { get exaApiKey() { return state.exaKey; } },
}));

const runExaAgentResearch = vi.fn();
vi.mock("./exa", () => ({ runExaAgentResearch: (...args: unknown[]) => runExaAgentResearch(...args) }));

beforeEach(() => {
  runExaAgentResearch.mockReset();
  state.exaKey = "test-exa-key";
});

describe("runResearch", () => {
  it("delegates to Exa's deep research agent and returns the cited report", async () => {
    runExaAgentResearch.mockResolvedValueOnce({
      id: "agent_run_01jtest",
      status: "completed",
      output: {
        text: "Nova is a workspace agent [1].\n\nSources:\n1. Nova docs — https://nova.example/docs",
        grounding: [
          { field: "text", citations: [{ url: "https://nova.example/docs", title: "Nova docs" }] },
          { field: "text[2]", citations: [{ url: "https://nova.example/docs", title: "Nova docs (dup)" }, { url: "https://exa.ai/blog", title: "Exa blog" }] },
        ],
      },
    });

    const research = await runResearch("What is Nova?", "Focus on the agent features.");

    expect(research.report).toContain("workspace agent [1]");
    // duplicate URLs collapse; order is preserved
    expect(research.sources).toEqual([
      { url: "https://nova.example/docs", title: "Nova docs" },
      { url: "https://exa.ai/blog", title: "Exa blog" },
    ]);

    const options = runExaAgentResearch.mock.calls[0][0];
    expect(options.query).toContain("What is Nova?");
    expect(options.query).toContain("Focus on the agent features.");
    expect(options.effort).toBe("medium");
    expect(options.systemPrompt).toContain("research brief");
  });

  it("passes the bare topic when no instructions are given", async () => {
    runExaAgentResearch.mockResolvedValueOnce({
      status: "completed",
      output: { text: "Report.", grounding: [] },
    });
    await runResearch("Pricing of Exa API");
    const options = runExaAgentResearch.mock.calls[0][0];
    expect(options.query).toBe("Pricing of Exa API");
    expect(options.query).not.toContain("Additional instructions");
  });

  it("fails when the agent completes without a report", async () => {
    runExaAgentResearch.mockResolvedValueOnce({ status: "completed", output: { text: "  ", grounding: [] } });
    await expect(runResearch("topic")).rejects.toThrow("without a report");
  });

  it("propagates Exa agent failures to the caller", async () => {
    runExaAgentResearch.mockRejectedValueOnce(new Error("Exa Agent research failed: rate limited"));
    await expect(runResearch("topic")).rejects.toThrow("rate limited");
  });

  it("requires a configured API key before calling Exa", async () => {
    state.exaKey = "";
    await expect(runResearch("topic")).rejects.toThrow("EXA_API_KEY");
    expect(runExaAgentResearch).not.toHaveBeenCalled();
  });
});
