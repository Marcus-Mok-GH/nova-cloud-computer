import { beforeEach, describe, expect, it, vi } from "vitest";
import { isExaConfigured, normalizeExaDeepSearchType, runExaDeepResearch } from "./exa";

const state = vi.hoisted(() => ({ exaKey: "test-exa-key" }));
vi.mock("./_core/env", () => ({
  ENV: { get exaApiKey() { return state.exaKey; } },
}));

/** A deep search response with a synthesized report and field-level grounding. */
function jsonResponse(payload: unknown, init?: { status?: number } & Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
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

describe("normalizeExaDeepSearchType", () => {
  it("accepts the three deep research model IDs and defaults anything else to deep", () => {
    expect(normalizeExaDeepSearchType("deep-lite")).toBe("deep-lite");
    expect(normalizeExaDeepSearchType("deep")).toBe("deep");
    expect(normalizeExaDeepSearchType("deep-reasoning")).toBe("deep-reasoning");
    expect(normalizeExaDeepSearchType(undefined)).toBe("deep");
    expect(normalizeExaDeepSearchType("turbo")).toBe("deep");
    expect(normalizeExaDeepSearchType("")).toBe("deep");
  });
});

describe("runExaDeepResearch", () => {
  it("sends the query, chosen model, system prompt and text output schema, and returns the cited report", async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({
        results: [{ title: "Nova docs", url: "https://nova.example/docs" }],
        output: {
          content: "Nova is a workspace agent [1].",
          grounding: [{ field: "text", citations: [{ url: "https://nova.example/docs", title: "Nova docs" }] }],
        },
      })
    );

    const research = await runExaDeepResearch({
      query: "What is Nova?",
      type: "deep-reasoning",
      systemPrompt: "Be thorough.",
    });

    expect(research.report).toBe("Nova is a workspace agent [1].");
    expect(research.sources).toEqual([{ url: "https://nova.example/docs", title: "Nova docs" }]);

    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://api.exa.ai/search");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer test-exa-key");
    const body = JSON.parse(init.body);
    expect(body.query).toBe("What is Nova?");
    expect(body.type).toBe("deep-reasoning");
    expect(body.systemPrompt).toBe("Be thorough.");
    expect(body.outputSchema).toEqual({ type: "text", description: expect.any(String) });
  });

  it("defaults to the deep model when no type is given", async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ output: { content: "Report." } }));
    await runExaDeepResearch({ query: "q" });
    expect(JSON.parse(fetchStub.mock.calls[0][1].body).type).toBe("deep");
  });

  it("deduplicates grounding citations while preserving order", async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({
        output: {
          content: "Report [1] [2].",
          grounding: [
            { field: "text", citations: [{ url: "https://a.example", title: "A" }] },
            {
              field: "text[2]",
              citations: [{ url: "https://a.example", title: "A (dup)" }, { url: "https://b.example", title: "B" }],
            },
          ],
        },
      })
    );
    const { sources } = await runExaDeepResearch({ query: "q" });
    expect(sources).toEqual([
      { url: "https://a.example", title: "A" },
      { url: "https://b.example", title: "B" },
    ]);
  });

  it("falls back to the selected pages when no grounding is emitted", async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({
        results: [
          { title: "A", url: "https://a.example" },
          { title: "B", url: "https://b.example" },
        ],
        output: { content: "Report." },
      })
    );
    const { sources } = await runExaDeepResearch({ query: "q" });
    expect(sources).toEqual([
      { url: "https://a.example", title: "A" },
      { url: "https://b.example", title: "B" },
    ]);
  });

  it("accepts a wrapped report object as output.content", async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ output: { content: { text: "  Wrapped report.  " } } }));
    const { report } = await runExaDeepResearch({ query: "q" });
    expect(report).toBe("Wrapped report.");
  });

  it("throws on a non-OK HTTP status and includes a trimmed error hint", async () => {
    fetchStub.mockResolvedValueOnce(new Response('{"error":"invalid api key"}', { status: 401 }));
    await expect(runExaDeepResearch({ query: "q" })).rejects.toThrow(
      'status 401: {"error":"invalid api key"}'
    );
  });

  it("throws when the response contains no report", async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await expect(runExaDeepResearch({ query: "q" })).rejects.toThrow("without a report");
  });

  it("requires a configured API key", async () => {
    state.exaKey = "";
    await expect(runExaDeepResearch({ query: "q" })).rejects.toThrow("EXA_API_KEY");
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
