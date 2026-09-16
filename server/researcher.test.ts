import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RESEARCH_ROUNDS, runResearch } from "./researcher";
import type { GatewayChatResult, GatewayToolCall } from "./nvidiaGateway";

const state = vi.hoisted(() => ({ exaKey: "test-exa-key" }));
vi.mock("./_core/env", () => ({
  ENV: { get exaApiKey() { return state.exaKey; } },
}));

const searchExa = vi.fn();
vi.mock("./exa", () => ({ searchExa: (...args: unknown[]) => searchExa(...args) }));

const chatWithNvidiaGateway = vi.fn();
vi.mock("./nvidiaGateway", () => ({ chatWithNvidiaGateway: (...args: unknown[]) => chatWithNvidiaGateway(...args) }));

function chatResult(text: string, toolCalls: GatewayToolCall[] = []): GatewayChatResult {
  return { text, toolCalls, model: "test-model", usage: null, allowance: { usedRequests: 1, maxRequests: 50, remainingRequests: 49, exhausted: false } };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  searchExa.mockReset();
  chatWithNvidiaGateway.mockReset();
  state.exaKey = "test-exa-key";
});

describe("runResearch", () => {
  it("runs search rounds and returns the researcher's final cited report", async () => {
    searchExa.mockResolvedValueOnce([{ title: "Nova docs", url: "https://nova.example/docs", publishedDate: "2026-09-01", text: "Nova is a workspace agent." }]);
    chatWithNvidiaGateway
      .mockResolvedValueOnce(chatResult("", [{ id: "call-1", name: "search_web", arguments: JSON.stringify({ query: "nova workspace agent" }) }]))
      .mockResolvedValueOnce(chatResult("Nova is a workspace agent [1].\n\nSources:\n1. Nova docs — https://nova.example/docs"));

    const research = await runResearch(7, "What is Nova?");

    expect(research.report).toContain("workspace agent [1]");
    expect(research.sources).toEqual([{ title: "Nova docs", url: "https://nova.example/docs", publishedDate: "2026-09-01", text: "Nova is a workspace agent." }]);

    // round 1: tools exposed, topic passed through
    const firstCall = chatWithNvidiaGateway.mock.calls[0];
    expect(firstCall[0]).toBe(7);
    expect(firstCall[1][1].content).toContain("What is Nova?");
    expect(firstCall[2].tools[0].function.name).toBe("search_web");

    // round 2: assistant tool call + tool result appended before the final call
    const secondMessages = chatWithNvidiaGateway.mock.calls[1][1];
    expect(secondMessages[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "call-1", function: { name: "search_web" } }] });
    expect(secondMessages[3]).toMatchObject({ role: "tool", tool_call_id: "call-1" });
    expect(secondMessages[3].content).toContain("[1] Nova docs (2026-09-01)");
    expect(secondMessages[3].content).toContain("https://nova.example/docs");
  });

  it("feeds search failures back to the researcher instead of crashing", async () => {
    searchExa.mockRejectedValueOnce(new Error("Exa responded with status 500."));
    chatWithNvidiaGateway
      .mockResolvedValueOnce(chatResult("", [{ id: "call-1", name: "search_web", arguments: JSON.stringify({ query: "x" }) }]))
      .mockResolvedValueOnce(chatResult("No reliable sources found."));

    const research = await runResearch(7, "topic");
    expect(research.report).toBe("No reliable sources found.");
    expect(research.sources).toEqual([]);
    const secondMessages = chatWithNvidiaGateway.mock.calls[1][1];
    expect(secondMessages[3].content).toContain("Search failed: Exa responded with status 500.");
  });

  it("rejects unknown tools and missing queries", async () => {
    chatWithNvidiaGateway
      .mockResolvedValueOnce(chatResult("", [
        { id: "call-1", name: "other_tool", arguments: "{}" },
        { id: "call-2", name: "search_web", arguments: JSON.stringify({ query: "" }) },
      ]))
      .mockResolvedValueOnce(chatResult("Report."));
    await runResearch(7, "topic");
    const secondMessages = chatWithNvidiaGateway.mock.calls[1][1];
    expect(secondMessages[3].content).toBe("Unknown tool. Only search_web is available.");
    expect(secondMessages[4].content).toBe("A search query is required.");
  });

  it("caps the search rounds and forces a final report from what was gathered", async () => {
    searchExa.mockResolvedValue([]);
    chatWithNvidiaGateway.mockImplementation((_ownerId, messages) => {
      // keep returning tool calls until the budget forces the final round
      const last = messages[messages.length - 1];
      if (last.role === "user" && last.content?.includes("search budget")) {
        return Promise.resolve(chatResult("Final forced report."));
      }
      return Promise.resolve(chatResult("", [{ id: `call-${messages.length}`, name: "search_web", arguments: JSON.stringify({ query: `q${messages.length}` }) }]));
    });

    const research = await runResearch(7, "big topic");
    expect(research.report).toBe("Final forced report.");
    // MAX_RESEARCH_ROUNDS - 1 search rounds + 1 forced final call
    expect(chatWithNvidiaGateway).toHaveBeenCalledTimes(MAX_RESEARCH_ROUNDS);
    const finalMessages = chatWithNvidiaGateway.mock.calls[MAX_RESEARCH_ROUNDS - 1][1];
    expect(finalMessages.at(-1).content).toContain("reached your search budget");
  });

  it("requires a configured Exa key", async () => {
    state.exaKey = "";
    await expect(runResearch(7, "topic")).rejects.toThrow("EXA_API_KEY");
  });
});
