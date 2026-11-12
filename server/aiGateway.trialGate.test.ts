/**
 * The 14-day free trial gate on the gateway's entry points. The free plan
 * is a trial, not a forever tier: once the 14-day window from account
 * creation closes, a standard account must upgrade to Nova Pro before it
 * can run any more AI. The gate is the entitlement check, not a funding
 * one - a paid plan or a console-operator role keeps access regardless of
 * the trial clock (hasActiveAccessForUser).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { hasActiveAccessForUser } = vi.hoisted(() => ({
  hasActiveAccessForUser: vi.fn(async () => true),
}));
vi.mock("./db", () => ({
  claimDailyCreditForUser: vi.fn(async () => ({ usedCredits: 1, allocatedCredits: 500 })),
  settleDailyCreditUsageForUser: vi.fn(async () => undefined),
  getActiveCustomModelForUser: vi.fn(async () => null),
  getInferenceAllowanceForUser: vi.fn(async () => ({ usedRequests: 0 })),
  claimInferenceRequestForUser: vi.fn(async () => ({ usedRequests: 1 })),
  hasProAccessForUser: vi.fn(async () => false),
  hasActiveAccessForUser,
}));

import {
  AiGatewayClientError,
  chatWithAiGateway,
  completeWithAiGateway,
  resetAiGatewayHealthCache,
} from "./aiGateway";

const ORIGINAL_FETCH = global.fetch;

function sseResponse(chunks: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function modelsResponse() {
  return new Response(
    JSON.stringify({ data: [{ id: "testco/test-model" }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function chatCompletionResponse() {
  return new Response(
    JSON.stringify({
      model: "testco/test-model",
      choices: [{ message: { role: "assistant", content: "Trial still active." } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

beforeEach(() => {
  // Credentials shorter than 32 chars are ignored by pollinationsToken().
  process.env.POLLINATIONS_API_KEY = "sk-pollinations_test-gateway-key-0123456789abcdef012345";
  process.env.POLLINATIONS_GATEWAY_URL = "https://gateway.example.com/v1";
  delete process.env.POLLINATIONS_REASONING_EFFORT;
  resetAiGatewayHealthCache();
  vi.useFakeTimers();
  hasActiveAccessForUser.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = ORIGINAL_FETCH;
  delete process.env.POLLINATIONS_API_KEY;
  delete process.env.POLLINATIONS_GATEWAY_URL;
  delete process.env.POLLINATIONS_REASONING_EFFORT;
});

function gatewayFetchStub(call: (path: string) => Promise<Response> | Response) {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url.replace(/^https:\/\/gateway\.example\.com\/v1/, "");
    if (path === "/models") return modelsResponse();
    return call(path);
  });
  global.fetch = fetchSpy as unknown as typeof fetch;
  return fetchSpy;
}

describe("the 14-day free trial gate on the gateway entry points", () => {
  it("blocks the streaming path once the trial has ended", async () => {
    hasActiveAccessForUser.mockResolvedValue(false);
    const fetchSpy = gatewayFetchStub(() => sseResponse(["data: [DONE]\n\n"]));
    const error = await chatWithAiGateway(1, [{ role: "user", content: "hi" }], { onChunk: () => {} }).catch((e) => e);
    expect(error).toBeInstanceOf(AiGatewayClientError);
    expect(error.kind).toBe("upgrade_required");
    expect(error.message).toContain("free trial of Nova has ended");
    expect(hasActiveAccessForUser).toHaveBeenCalledWith(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("blocks the one-shot path once the trial has ended", async () => {
    hasActiveAccessForUser.mockResolvedValue(false);
    const fetchSpy = gatewayFetchStub(() => chatCompletionResponse());
    const error = await completeWithAiGateway(1, "hi").catch((e) => e);
    expect(error).toBeInstanceOf(AiGatewayClientError);
    expect(error.kind).toBe("upgrade_required");
    expect(error.message).toContain("free trial of Nova has ended");
    expect(hasActiveAccessForUser).toHaveBeenCalledWith(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("lets a fresh trial run through the streaming path", async () => {
    const sse = "data: " + JSON.stringify({ choices: [{ delta: { content: "Trial still active." } }] }) + "\n\n";
    gatewayFetchStub((path) => (path.includes("/chat/completions") ? sseResponse([sse, "data: [DONE]\n\n"]) : sseResponse(["data: [DONE]\n\n"])));
    const result = await chatWithAiGateway(1, [{ role: "user", content: "hi" }], { onChunk: () => {} });
    expect(result.text).toBe("Trial still active.");
    expect(hasActiveAccessForUser).toHaveBeenCalledWith(1);
  });
  it("lets a fresh trial run through the one-shot path", async () => {
    gatewayFetchStub((path) => (path.includes("/chat/completions") ? chatCompletionResponse() : chatCompletionResponse()));
    const result = await completeWithAiGateway(1, "hi");
    expect(result.text).toBe("Trial still active.");
    expect(hasActiveAccessForUser).toHaveBeenCalledWith(1);
  });
});
