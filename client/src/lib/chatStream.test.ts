import { describe, expect, it } from "vitest";
import { readChatStreamEvents } from "./chatStream";

const encoder = new TextEncoder();

function responseFromChunks(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    })
  );
}

async function collectEvents(response: Response): Promise<string[]> {
  const events: string[] = [];
  for await (const event of readChatStreamEvents(response)) events.push(event);
  return events;
}

describe("readChatStreamEvents", () => {
  it("reassembles split event frames and recognises completion", async () => {
    const response = responseFromChunks([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\r\n\r\ndata: [DO',
      "NE]\n\n",
    ]);

    await expect(collectEvents(response)).resolves.toEqual([
      '{"choices":[{"delta":{"content":"Hi"}}]}',
      "[DONE]",
    ]);
  });

  it("rejects a stream that closes before its completion marker", async () => {
    const response = responseFromChunks(['data: {"type":"queued"}\n\n']);

    await expect(collectEvents(response)).rejects.toThrow(
      "Connection ended before Nova confirmed completion"
    );
  });

  it("accepts a final completion marker without a trailing newline", async () => {
    const response = responseFromChunks(["data: [DONE]"]);

    await expect(collectEvents(response)).resolves.toEqual(["[DONE]"]);
  });
});
