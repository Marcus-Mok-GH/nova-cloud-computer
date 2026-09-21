import { beforeEach, describe, expect, it, vi } from "vitest";
import { runResearch } from "./researcher";

const state = vi.hoisted(() => ({ exaKey: "test-exa-key" }));
vi.mock("./_core/env", () => ({
  ENV: { get exaApiKey() { return state.exaKey; } },
}));

const runExaDeepResearch = vi.fn();
vi.mock("./exa", () => ({
  runExaDeepResearch: (...args: unknown[]) => runExaDeepResearch(...args),
  // Real normalization keeps the difficulty tests faithful to production.
  normalizeExaDeepSearchType: (value: unknown) =>
    ["deep-lite", "deep", "deep-reasoning"].includes(value as never) ? (value as never) : "deep",
}));

beforeEach(() => {
  runExaDeepResearch.mockReset();
  state.exaKey = "test-exa-key";
});

describe("runResearch", () => {
  it("delegates to Exa deep research with the report-style system prompt", async () => {
    runExaDeepResearch.mockResolvedValueOnce({
      report: "Nova is a workspace agent [1].\n\nSources:\n1. Nova docs - https://nova.example/docs",
      sources: [
        { url: "https://nova.example/docs", title: "Nova docs" },
        { url: "https://exa.ai/blog", title: "Exa blog" },
      ],
    });

    const research = await runResearch("What is Nova?");

    expect(research.report).toContain("workspace agent [1]");
    expect(research.sources).toEqual([
      { url: "https://nova.example/docs", title: "Nova docs" },
      { url: "https://exa.ai/blog", title: "Exa blog" },
    ]);

    const options = runExaDeepResearch.mock.calls[0][0];
    expect(options.query).toBe("What is Nova?");
    expect(options.systemPrompt).toContain("research brief");
  });

  it("passes the chosen difficulty straight through as the research model", async () => {
    runExaDeepResearch.mockResolvedValueOnce({ report: "Report.", sources: [] });
    runExaDeepResearch.mockResolvedValueOnce({ report: "Report.", sources: [] });
    await runResearch("Quick lookup", "deep-lite");
    expect(runExaDeepResearch.mock.calls[0][0].type).toBe("deep-lite");

    await runResearch("Complex investigation", "deep-reasoning");
    expect(runExaDeepResearch.mock.calls[1][0].type).toBe("deep-reasoning");
  });

  it("defaults to the deep model when no difficulty is chosen", async () => {
    runExaDeepResearch.mockResolvedValueOnce({ report: "Report.", sources: [] });
    await runResearch("Medium question");
    expect(runExaDeepResearch.mock.calls[0][0].type).toBe("deep");
  });

  it("merges optional instructions into the query", async () => {
    runExaDeepResearch.mockResolvedValueOnce({ report: "Report.", sources: [] });
    await runResearch("Pricing of Exa API", undefined, "Focus on the free tier.");
    expect(runExaDeepResearch.mock.calls[0][0].query).toBe(
      "Pricing of Exa API\n\nAdditional instructions: Focus on the free tier."
    );
  });

  it("propagates Exa failures to the caller", async () => {
    runExaDeepResearch.mockRejectedValueOnce(new Error("Exa deep research responded with status 429: rate limited"));
    await expect(runResearch("topic")).rejects.toThrow("rate limited");
  });

  it("fails when the research finishes without a report", async () => {
    runExaDeepResearch.mockResolvedValueOnce({ report: "   ", sources: [] });
    await expect(runResearch("topic")).rejects.toThrow("without a report");
  });

  it("requires a configured API key before calling Exa", async () => {
    state.exaKey = "";
    await expect(runResearch("topic")).rejects.toThrow("EXA_API_KEY");
    expect(runExaDeepResearch).not.toHaveBeenCalled();
  });
});

describe("runResearch progress pass-through", () => {
  it("forwards live progress notes from the deep research stream", async () => {
    runExaDeepResearch.mockImplementationOnce(async (options: { onProgress?: (note: string) => void }) => {
      options.onProgress?.("Searched the live web - found 2 new sources (e.g. \"Nova docs\")");
      options.onProgress?.("Writing the report...");
      return { report: "Report.", sources: [] };
    });
    const notes: string[] = [];
    const research = await runResearch("What is Nova?", "deep", undefined, note => notes.push(note));
    expect(research.report).toBe("Report.");
    expect(notes).toEqual([
      'Searched the live web - found 2 new sources (e.g. "Nova docs")',
      "Writing the report...",
    ]);
  });

  it("omits onProgress entirely when no listener is given", async () => {
    runExaDeepResearch.mockResolvedValueOnce({ report: "Report.", sources: [] });
    await runResearch("What is Nova?");
    const options = runExaDeepResearch.mock.calls[0][0];
    expect(options.onProgress).toBeUndefined();
  });
});
