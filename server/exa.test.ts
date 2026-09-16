import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchExa, toExaResult } from "./exa";

const state = vi.hoisted(() => ({ exaKey: "test-exa-key" }));
vi.mock("./_core/env", () => ({
  ENV: { get exaApiKey() { return state.exaKey; } },
}));

const fetchStub = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchStub);
  fetchStub.mockReset();
  state.exaKey = "test-exa-key";
});

describe("toExaResult", () => {
  it("normalizes a raw Exa row", () => {
    expect(toExaResult({ title: " Nova docs ", url: "https://nova.example", publishedDate: "2026-09-01", text: " Guide. " })).toEqual({
      title: "Nova docs",
      url: "https://nova.example",
      publishedDate: "2026-09-01",
      text: "Guide.",
    });
  });
});

describe("searchExa", () => {
  it("sends a key-authenticated search request and maps the results", async () => {
    fetchStub.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [{ title: "Exa docs", url: "https://exa.example/docs", publishedDate: "", text: "How Exa works." }] }), { status: 200 })
    );
    const results = await searchExa("how exa works", 3);
    const [request, init] = fetchStub.mock.calls[0];
    expect(request).toBe("https://api.exa.ai/search");
    expect(init.headers).toMatchObject({ "x-api-key": "test-exa-key" });
    expect(JSON.parse(init.body)).toMatchObject({ query: "how exa works", numResults: 3 });
    expect(results).toEqual([{ title: "Exa docs", url: "https://exa.example/docs", publishedDate: "", text: "How Exa works." }]);
  });

  it("surfaces provider errors", async () => {
    fetchStub.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await expect(searchExa("x", 5)).rejects.toThrow("Exa responded with status 401");
  });

  it("requires a configured API key", async () => {
    state.exaKey = "";
    await expect(searchExa("x", 5)).rejects.toThrow("EXA_API_KEY");
  });
});
