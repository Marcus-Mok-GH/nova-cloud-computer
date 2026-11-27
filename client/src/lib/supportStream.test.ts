import { describe, expect, it } from "vitest";
import {
  createSupportStreamFramer,
  parseSupportStreamLine,
} from "./supportStream";

describe("support stream framing", () => {
  it("reassembles chunks that split a JSON event across boundaries", () => {
    const lines: string[] = [];
    const framer = createSupportStreamFramer(line => lines.push(line));
    const event = 'data: {"delta":"Hello, Nova"}';

    framer.push(event.slice(0, 8));
    expect(lines).toEqual([]); // no complete line yet
    framer.push(event.slice(8) + "\n\ndata: [DONE]\n");
    framer.flush();

    expect(lines).toEqual([event, "data: [DONE]"]);
  });

  it("delivers several events in one chunk, in order", () => {
    const lines: string[] = [];
    const framer = createSupportStreamFramer(line => lines.push(line));
    framer.push('data: {"delta":"a"}\r\ndata: {"delta":"b"}\r\n');
    expect(lines).toEqual(['data: {"delta":"a"}', 'data: {"delta":"b"}']);
  });
});

describe("support stream event parsing", () => {
  it("reads deltas and ignores the DONE sentinel, keep-alives and bad JSON", () => {
    expect(parseSupportStreamLine('data: {"delta":"Hi"}')).toEqual({ delta: "Hi" });
    expect(parseSupportStreamLine("data: [DONE]")).toBeNull();
    expect(parseSupportStreamLine(": keepalive")).toBeNull();
    expect(parseSupportStreamLine("data: {broken")).toBeNull();
  });

  it("surfaces an error event so the widget can show it beside a partial answer", () => {
    expect(parseSupportStreamLine('data: {"error":"busy"}')).toEqual({
      error: "busy",
    });
  });
});
