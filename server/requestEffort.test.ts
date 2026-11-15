import { describe, expect, it } from "vitest";
import { classifyRequestEffort, lastUserText } from "./requestEffort";

describe("lastUserText", () => {
  const msg = (role: string, content: unknown) => ({ role, content } as never);

  it("returns the newest user message's string content", () => {
    expect(
      lastUserText([
        msg("user", "first ask"),
        msg("assistant", "reply"),
        msg("user", "second ask"),
      ])
    ).toBe("second ask");
  });

  it("joins text parts of a multimodal turn and skips image-only turns", () => {
    expect(
      lastUserText([
        msg("user", [
          { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
          { type: "text", text: "what is in this image" },
        ]),
      ])
    ).toBe("what is in this image");
    expect(
      lastUserText([
        msg("user", [
          { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
        ]),
        msg("user", "describe the attachment above"),
      ])
    ).toBe("describe the attachment above");
  });

  it("returns empty when there is no user text at all", () => {
    expect(lastUserText([])).toBe("");
    expect(lastUserText([msg("system", "rules"), msg("assistant", "hi")])).toBe("");
    expect(lastUserText([msg("user", null)])).toBe("");
    expect(
      lastUserText([
        msg("user", [{ type: "image_url", image_url: { url: "data:x" } }]),
      ])
    ).toBe("");
  });
});

describe("classifyRequestEffort", () => {
  it("keeps pleasantries and short factual questions shallow", () => {
    expect(classifyRequestEffort("hi")).toBe("low");
    expect(classifyRequestEffort("thanks!")).toBe("low");
    expect(classifyRequestEffort("ok")).toBe("low");
    expect(classifyRequestEffort("What is the capital of France?")).toBe("low");
  });

  it("lands ordinary task imperatives at medium", () => {
    expect(
      classifyRequestEffort("Summarize a topic and write it as a report.")
    ).toBe("medium");
    expect(classifyRequestEffort("Explain how photosynthesis works")).toBe(
      "medium"
    );
    expect(classifyRequestEffort("")).toBe("medium");
    expect(classifyRequestEffort("- one thought\n- another thought")).toBe(
      "medium"
    );
  });

  it("goes deep for reasoning-heavy, code-bearing or long requests", () => {
    expect(
      classifyRequestEffort("Design a system with trade-offs, step by step.")
    ).toBe("high");
    expect(classifyRequestEffort("```ts\nconst x = compute();\n```")).toBe(
      "high"
    );
    expect(classifyRequestEffort("analysis ".repeat(170))).toBe("high");
    // A greeting does not down-rank a real task.
    expect(
      classifyRequestEffort("hello! please write a step-by-step guide")
    ).toBe("high");
  });
});
