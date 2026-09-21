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

describe("runExaDeepResearch streaming", () => {
  /** An SSE response built from data payloads; the caller appends [DONE]. */
  function sseResponse(dataPayloads: string[]) {
    const body = dataPayloads.map(payload => `data: ${payload}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  it("requests the stream and assembles the report from text-delta events", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse([`{"type":"text-delta","delta":"Nova is "}`, `{"type":"text-delta","delta":"a workspace agent."}`])
    );
    const { report, sources } = await runExaDeepResearch({ query: "What is Nova?" });
    expect(report).toBe("Nova is a workspace agent.");
    expect(sources).toEqual([]);
    expect(JSON.parse(fetchStub.mock.calls[0][1].body).stream).toBe(true);
  });

  it("emits one progress note per sub-search results event and one when synthesis starts", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse([
        `{"type":"results","results":[{"title":"Nova docs","url":"https://nova.example/docs"},{"title":"Nova blog","url":"https://nova.example/blog"}]}`,
        `{"type":"results","results":[{"title":"Deep agents","url":"https://deep.example"}]}`,
        `{"type":"text-delta","delta":"Answer"}`,
      ])
    );
    const notes: string[] = [];
    const { sources } = await runExaDeepResearch({ query: "q", onProgress: note => notes.push(note) });
    expect(notes).toEqual([
      'Searched the live web - found 2 new sources (e.g. "Nova docs")',
      "Searched the live web - found 1 new source (e.g. \"Deep agents\")",
      "Evidence gathered from 3 sources - writing the report...",
    ]);
    // The grounding event never arrived, so the results are the fallback sources.
    expect(sources).toEqual([
      { title: "Nova docs", url: "https://nova.example/docs" },
      { title: "Nova blog", url: "https://nova.example/blog" },
      { title: "Deep agents", url: "https://deep.example" },
    ]);
  });

  it("collects grounding citations from grounding events", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse([
        `{"type":"results","results":[{"title":"Unused","url":"https://unused.example"}]}`,
        `{"type":"grounding","grounding":[{"field":"text","citations":[{"url":"https://a.example","title":"A"},{"url":"https://a.example","title":"A dup"},{"url":"https://b.example","title":"B"}]}]}`,
        `{"type":"text-delta","delta":"Report."}`,
      ])
    );
    const { report, sources } = await runExaDeepResearch({ query: "q" });
    expect(report).toBe("Report.");
    expect(sources).toEqual([
      { url: "https://a.example", title: "A" },
      { url: "https://b.example", title: "B" },
    ]);
  });

  it("resets the partial report when the stream restarts synthesis", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse([
        `{"type":"text-delta","delta":"partial tha"}`,
        `{"type":"stream-reset","streamReset":true}`,
        `{"type":"text-delta","delta":"Full report."}`,
      ])
    );
    const { report } = await runExaDeepResearch({ query: "q" });
    expect(report).toBe("Full report.");
  });

  it("skips malformed SSE fragments without killing the research", async () => {
    fetchStub.mockResolvedValueOnce(
      sseResponse([`{"broken json`, `{"type":"text-delta","delta":"Report."}`])
    );
    const { report } = await runExaDeepResearch({ query: "q" });
    expect(report).toBe("Report.");
  });

  it("still parses a buffered JSON answer when the gateway ignores stream:true", async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({
        output: { content: "Buffered report.", grounding: [{ field: "text", citations: [{ url: "https://c.example", title: "C" }] }] },
      })
    );
    const { report, sources } = await runExaDeepResearch({ query: "q" });
    expect(report).toBe("Buffered report.");
    expect(sources).toEqual([{ url: "https://c.example", title: "C" }]);
  });

  it("throws when the stream ends without any report text", async () => {
    fetchStub.mockResolvedValueOnce(sseResponse([`{"type":"results","results":[]}`]));
    await expect(runExaDeepResearch({ query: "q" })).rejects.toThrow("without a report");
  });
});
