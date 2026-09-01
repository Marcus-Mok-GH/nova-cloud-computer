import { describe, expect, it, vi } from "vitest";
import { invokeLLM } from "./llm";

describe("invokeLLM streaming [DONE] handling", () => {
  it("exits stream reading when [DONE] is received and cancels the reader even if stream remains open", async () => {
    let cancelCalled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n"));
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"world!\"}}]}\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        // Stream intentionally stays open without calling controller.close() to simulate open connection
      },
      cancel() {
        cancelCalled = true;
      },
    });

    const mockResponse = new Response(stream, { status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse));

    const chunks: string[] = [];
    const result = await invokeLLM({
      apiUrl: "https://example.com/v1",
      apiKey: "test-key",
      messages: [{ role: "user", content: "Hi" }],
      onChunk: chunk => { chunks.push(chunk); },
    });

    expect(chunks).toEqual(["Hello ", "world!"]);
    expect(result.choices[0].message.content).toBe("Hello world!");
    expect(cancelCalled).toBe(true);

    vi.unstubAllGlobals();
  });
});
