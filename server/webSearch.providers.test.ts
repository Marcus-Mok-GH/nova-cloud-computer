import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchWithBrave, searchWithTavily } from "./webSearch";

const fetchStub = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchStub);
  fetchStub.mockReset();
});

describe("Tavily provider", () => {
  it("maps Tavily results into clean titles, URLs and snippets", async () => {
    fetchStub.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [{ title: "Nova docs", url: "https://nova.example/docs", content: "How to use Nova." }] }), { status: 200 })
    );
    const results = await searchWithTavily("nova docs", 5);
    expect(fetchStub.mock.calls[0][0]).toBe("https://api.tavily.com/search");
    expect(results).toEqual([{ title: "Nova docs", url: "https://nova.example/docs", snippet: "How to use Nova." }]);
  });

  it("surfaces provider errors", async () => {
    fetchStub.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await expect(searchWithTavily("nova docs", 5)).rejects.toThrow("Tavily responded with status 401");
  });
});

describe("Brave provider", () => {
  it("maps Brave web results into clean titles, URLs and snippets", async () => {
    fetchStub.mockResolvedValueOnce(
      new Response(JSON.stringify({ web: { results: [{ title: "Brave result", url: "https://brave.example/x", description: "A Brave snippet." }] } }), { status: 200 })
    );
    const results = await searchWithBrave("nova docs", 5);
    expect(fetchStub.mock.calls[0][0]).toContain("api.search.brave.com/res/v1/web/search?q=nova%20docs");
    expect(results).toEqual([{ title: "Brave result", url: "https://brave.example/x", snippet: "A Brave snippet." }]);
  });

  it("surfaces provider errors", async () => {
    fetchStub.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    await expect(searchWithBrave("nova docs", 5)).rejects.toThrow("Brave responded with status 429");
  });
});
