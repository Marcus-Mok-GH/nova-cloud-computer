import { describe, expect, it } from "vitest";
import { createSseLineFramer, sseDataPayload } from "./sse";

/**
 * The framer cuts each line out of the retained buffer while scanning it with
 * a cursor instead of re-slicing the remainder per line. These tests pin the
 * framing rules that the cursor scan must keep identical: order, CR trimming,
 * carrying a partial line to the next chunk, and the partial-line cap.
 */
describe("createSseLineFramer", () => {
  it("delivers every complete line in order and carries the partial one", () => {
    const lines: string[] = [];
    const framer = createSseLineFramer(line => lines.push(line));
    framer.push("a: 1\ndata: two\npar");
    expect(lines).toEqual(["a: 1", "data: two"]);
    expect(framer.pending()).toBe("par");
    framer.push("tial\ndata: three\n");
    expect(lines).toEqual(["a: 1", "data: two", "partial", "data: three"]);
    expect(framer.pending()).toBe("");
  });

  it("trims one trailing CR from a CRLF line and keeps the rest", () => {
    const lines: string[] = [];
    const framer = createSseLineFramer(line => lines.push(line));
    framer.push("data: one\r\ndata: two\r\r\n\n");
    expect(lines).toEqual(["data: one", "data: two\r", ""]);
  });

  it("keeps a lone newline-less chunk as the pending line", () => {
    const framer = createSseLineFramer(() => {
      throw new Error("no line should complete");
    });
    framer.push('data: {"id":"chat-1"');
    expect(framer.pending()).toBe('data: {"id":"chat-1"');
  });

  it("delivers complete lines before failing on an over-long partial line", () => {
    const lines: string[] = [];
    const framer = createSseLineFramer(line => lines.push(line), {
      maxLineLength: 8,
      lineLengthError: () => new Error("too long"),
    });
    expect(() => framer.push("ok: 1\nfar-too-long-partial")).toThrow(
      "too long"
    );
    expect(lines).toEqual(["ok: 1"]);
  });

  it("reads the payload of a data line only", () => {
    expect(sseDataPayload("data:  {} ")).toBe("{}");
    expect(sseDataPayload("event: ping")).toBeNull();
    expect(sseDataPayload("")).toBeNull();
  });
});
