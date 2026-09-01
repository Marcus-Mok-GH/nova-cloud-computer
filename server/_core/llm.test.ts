import { afterEach, describe, expect, it, vi } from "vitest";

import { invokeLLM } from "./llm";

describe("invokeLLM streaming", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("resolves and cancels an upstream stream that stays open after [DONE]", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"id":"chatcmpl-test","choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
          )
        );
      },
      cancel,
    });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 200 }));
    const onChunk = vi.fn();

    await expect(
      invokeLLM({
        apiUrl: "https://example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        messages: [{ role: "user", content: "Hello" }],
        onChunk,
      })
    ).resolves.toMatchObject({
      id: "chatcmpl-test",
      model: "test-model",
      choices: [
        {
          message: { content: "Hello" },
          finish_reason: "stop",
        },
      ],
    });
    expect(onChunk).toHaveBeenCalledWith("Hello");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
