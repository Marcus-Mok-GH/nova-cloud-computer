import { describe, expect, it } from "vitest";
import {
  buildOpenAiChatCompletion,
  buildOpenAiSseChunk,
  InferenceApiError,
  inferenceApiModels,
  mapGatewayClientError,
  MAX_INFERENCE_MESSAGES,
  NOVA_PRO_MODEL_ID,
  parseInferenceApiMessages,
  readApiKeyFromRequest,
  resolveInferenceModel,
} from "./inferenceApi";
import { MistralGatewayClientError } from "./mistralGateway";
import type { CustomModel } from "../drizzle/schema";

function customModelFixture(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    id: 1,
    workspaceId: 1,
    name: "My provider",
    modelId: "gpt-4o",
    baseUrl: "https://api.example.com/v1",
    compatibility: "openai",
    encryptedApiKey: "encrypted",
    supportsImageInput: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as CustomModel;
}

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

describe("inferenceApiModels", () => {
  it("offers only nova-pro without a BYOK model", () => {
    expect(inferenceApiModels(null)).toEqual([{ id: NOVA_PRO_MODEL_ID, ownedBy: "nova", customModel: null }]);
  });

  it("adds the BYOK model id as a second choice", () => {
    const byok = customModelFixture();
    const models = inferenceApiModels(byok);
    expect(models.map(model => model.id)).toEqual([NOVA_PRO_MODEL_ID, "gpt-4o"]);
    expect(models[1]).toMatchObject({ ownedBy: "byok", customModel: byok });
  });

  it("keeps a single entry when the BYOK model id collides with nova-pro", () => {
    expect(inferenceApiModels(customModelFixture({ modelId: NOVA_PRO_MODEL_ID })).map(model => model.id)).toEqual([NOVA_PRO_MODEL_ID]);
  });
});

describe("resolveInferenceModel", () => {
  it("defaults an omitted model to nova-pro", () => {
    expect(resolveInferenceModel(null, undefined).id).toBe(NOVA_PRO_MODEL_ID);
    expect(resolveInferenceModel(customModelFixture(), "  ").id).toBe(NOVA_PRO_MODEL_ID);
  });

  it("selects the BYOK model by its model id", () => {
    const byok = customModelFixture({ modelId: "deepseek-chat" });
    const resolved = resolveInferenceModel(byok, "deepseek-chat");
    expect(resolved.ownedBy).toBe("byok");
    expect(resolved.customModel).toBe(byok);
  });

  it("rejects a model outside the workspace's choices", () => {
    expect(() => resolveInferenceModel(null, "mistral-large-latest")).toThrow(InferenceApiError);
    expect(() => resolveInferenceModel(customModelFixture(), "some-other-model")).toThrow(InferenceApiError);
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

  it("reports the public model id when one is supplied", () => {
    const payload = buildOpenAiChatCompletion(
      {
        text: "Hello!",
        toolCalls: [],
        model: "ministral-14b-latest",
        usage: null,
        allowance: { usedRequests: 1, maxRequests: 500, remainingRequests: 499, exhausted: false },
      },
      NOVA_PRO_MODEL_ID
    );
    expect(payload.model).toBe("nova-pro");
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
