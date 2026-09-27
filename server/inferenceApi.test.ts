import { describe, expect, it } from "vitest";
import {
  buildOpenAiChatCompletion,
  buildOpenAiSseChunk,
  InferenceApiError,
  mapGatewayClientError,
  MAX_INFERENCE_MESSAGES,
  parseInferenceApiMessages,
  readApiKeyFromRequest,
} from "./inferenceApi";
import { MistralGatewayClientError } from "./mistralGateway";

describe("readApiKeyFromRequest", () => {
  it("accepts bearer keys and x-api-key headers", () => {
    expect(readApiKeyFromRequest({ authorization: "Bearer nova_sk_abc" })).toBe("nova_sk_abc");
    expect(readApiKeyFromRequest({ "x-api-key": "nova_sk_def" })).toBe("nova_sk_def");
  });

  it("rejects missing or foreign tokens", () => {
    expect(readApiKeyFromRequest({})).toBeNull();
    expect(readApiKeyFromRequest({ authorization: "Bearer sk-other" })).toBeNull();
    expect(readApiKeyFromRequest({ authorization: "nova_sk_abc" })).toBeNull();
  });
});

describe("parseInferenceApiMessages", () => {
  it("normalizes a standard OpenAI request", () => {
    const parsed = parseInferenceApiMessages({
      messages: [
        { role: "system", content: "You are terse." },
        { role: "user", content: "Hi" },
      ],
      model: "mistral-small-latest",
    });
    expect(parsed.messages).toEqual([
      { role: "system", content: "You are terse." },
      { role: "user", content: "Hi" },
    ]);
    expect(parsed.model).toBe("mistral-small-latest");
    expect(parsed.stream).toBe(false);
  });

  it("flattens text content parts and honors stream", () => {
    const parsed = parseInferenceApiMessages({
      messages: [{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }],
      stream: true,
    });
    expect(parsed.messages[0].content).toBe("a\nb");
    expect(parsed.stream).toBe(true);
  });

  it("rejects tools, bad roles, and malformed messages", () => {
    expect(() => parseInferenceApiMessages({ messages: [{ role: "user", content: "hi" }], tools: [{}] })).toThrow(InferenceApiError);
    expect(() => parseInferenceApiMessages({ messages: [] })).toThrow(InferenceApiError);
    expect(() => parseInferenceApiMessages({ messages: [{ role: "wizard", content: "hi" }] })).toThrow(InferenceApiError);
    expect(() => parseInferenceApiMessages({ messages: [{ role: "user", content: 5 }] })).toThrow(InferenceApiError);
    expect(() => parseInferenceApiMessages({ messages: "hello" })).toThrow(InferenceApiError);
  });

  it("caps the message count and prompt size", () => {
    const many = Array.from({ length: MAX_INFERENCE_MESSAGES + 1 }, () => ({ role: "user" as const, content: "x" }));
    expect(() => parseInferenceApiMessages({ messages: many })).toThrow(InferenceApiError);
    expect(() => parseInferenceApiMessages({ messages: [{ role: "user", content: "a".repeat(100_001) }] })).toThrow(InferenceApiError);
  });
});

describe("mapGatewayClientError", () => {
  it("maps exhausted credits and allowances to 429s", () => {
    expect(mapGatewayClientError(new MistralGatewayClientError("out", "credits_exhausted"))).toEqual({ status: 429, type: "rate_limit_error", code: "insufficient_credits" });
    expect(mapGatewayClientError(new MistralGatewayClientError("capped", "allowance_reached"))).toEqual({ status: 429, type: "rate_limit_error", code: "allowance_reached" });
  });

  it("maps configuration and client errors", () => {
    expect(mapGatewayClientError(new MistralGatewayClientError("no gateway", "configuration"))).toMatchObject({ status: 503 });
    expect(mapGatewayClientError(new MistralGatewayClientError("bad", "client_error"))).toMatchObject({ status: 400 });
    expect(mapGatewayClientError(new MistralGatewayClientError("boom", "invalid_response"))).toMatchObject({ status: 500 });
  });
});

describe("OpenAI response shapes", () => {
  it("builds a chat.completion payload", () => {
    const payload = buildOpenAiChatCompletion({
      text: "Hello!",
      toolCalls: [],
      model: "mistral-small-latest",
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
      allowance: { usedRequests: 1, maxRequests: 500, remainingRequests: 499, exhausted: false },
    });
    expect(payload.object).toBe("chat.completion");
    expect(payload.model).toBe("mistral-small-latest");
    expect(payload.choices[0].message).toEqual({ role: "assistant", content: "Hello!" });
    expect(payload.choices[0].finish_reason).toBe("stop");
    expect(payload.usage).toEqual({ prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 });
    expect(payload["x-nova-allowance"].remainingRequests).toBe(499);
  });

  it("builds SSE chunks in the chat.completion.chunk format", () => {
    const chunk = buildOpenAiSseChunk("chatcmpl-1", "mistral-small-latest", { content: "Hi" }, null);
    expect(chunk.startsWith("data: {")).toBe(true);
    expect(chunk.endsWith("\n\n")).toBe(true);
    const payload = JSON.parse(chunk.slice("data: ".length).trim());
    expect(payload.object).toBe("chat.completion.chunk");
    expect(payload.choices[0].delta).toEqual({ content: "Hi" });
    const finalChunk = buildOpenAiSseChunk("chatcmpl-1", "mistral-small-latest", {}, "stop");
    expect(JSON.parse(finalChunk.slice("data: ".length).trim()).choices[0].finish_reason).toBe("stop");
  });
});
