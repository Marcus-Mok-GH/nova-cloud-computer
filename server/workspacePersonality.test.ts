import { describe, expect, it } from "vitest";
import { formatPersonalityForPrompt } from "./workspace/workspacePrompt";
import {
  DEFAULT_PERSONALITY,
  DEFAULT_PERSONALITY_ID,
  asPersonalityCollaboration,
  asPersonalityDetail,
  asPersonalityExpertise,
  personalityChips,
  type Personality,
} from "@shared/personalities";

function personality(overrides: Partial<Personality>): Personality {
  return {
    id: "p_test",
    name: "Concise",
    description: "",
    instructions: null,
    detail: null,
    collaboration: null,
    expertise: null,
    builtIn: false,
    ...overrides,
  };
}

describe("formatPersonalityForPrompt", () => {
  it("contributes nothing for the built-in Default personality", () => {
    // The prompt must stay byte-identical for a workspace that never picked one.
    expect(formatPersonalityForPrompt(DEFAULT_PERSONALITY)).toBe("");
    expect(DEFAULT_PERSONALITY.id).toBe(DEFAULT_PERSONALITY_ID);
  });

  it("renders the name, instructions, and each set knob", () => {
    const block = formatPersonalityForPrompt(
      personality({
        name: "Analyst",
        instructions: "State assumptions and show your reasoning.",
        detail: "detailed",
        collaboration: "act_and_tell",
        expertise: "expert",
      })
    );
    expect(block).toContain('"Analyst" personality');
    expect(block).toContain("How to behave: State assumptions and show your reasoning.");
    expect(block).toContain("Preferred reply length: Detailed.");
    expect(block).toContain("Collaboration style: Act & tell.");
    expect(block).toContain("The user's expertise: Expert.");
  });

  it("renders nothing for a custom personality with no content", () => {
    expect(formatPersonalityForPrompt(personality({ name: "Empty" }))).toBe("");
  });
});

describe("personality helpers", () => {
  it("narrows stored strings, rejecting unknown values", () => {
    expect(asPersonalityDetail("brief")).toBe("brief");
    expect(asPersonalityDetail("nonsense")).toBeNull();
    expect(asPersonalityDetail(null)).toBeNull();
    expect(asPersonalityCollaboration("autonomous")).toBe("autonomous");
    expect(asPersonalityCollaboration("nope")).toBeNull();
    expect(asPersonalityExpertise("expert")).toBe("expert");
    expect(asPersonalityExpertise("guru")).toBeNull();
  });

  it("summarises the set knobs as chips", () => {
    expect(personalityChips(personality({ detail: "brief", collaboration: "ask_first" }))).toEqual([
      "Brief",
      "Ask first",
    ]);
    expect(personalityChips(DEFAULT_PERSONALITY)).toEqual([]);
  });
});
