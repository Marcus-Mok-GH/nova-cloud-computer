import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { PersonalitySelector } from "./PersonalitySelector";
import PersonalitiesCard from "./PersonalitiesCard";
import { DEFAULT_PERSONALITY, personalityChips } from "@shared/personalities";

const mutation = { mutate: vi.fn(), isPending: false };

const state = vi.hoisted(() => ({
  personalities: [
    {
      id: "default",
      name: "Default",
      description: "Nova's own voice — balanced length, asks when unsure.",
      instructions: null as string | null,
      detail: null as string | null,
      collaboration: null as string | null,
      expertise: null as string | null,
      builtIn: true,
    },
  ] as Array<{
    id: string;
    name: string;
    description: string;
    instructions: string | null;
    detail: string | null;
    collaboration: string | null;
    expertise: string | null;
    builtIn: boolean;
  }>,
  activePersonalityId: "default",
  isLoading: false,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: {
      personalities: {
        useQuery: () => ({
          data: {
            personalities: state.personalities,
            activePersonalityId: state.activePersonalityId,
          },
          isLoading: state.isLoading,
          refetch: vi.fn(),
        }),
      },
      setActivePersonality: { useMutation: () => mutation },
      createPersonality: { useMutation: () => mutation },
      updatePersonality: { useMutation: () => mutation },
      deletePersonality: { useMutation: () => mutation },
    },
    useUtils: () => ({
      workspace: {
        personalities: { invalidate: vi.fn() },
        modelSettings: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("wouter", () => ({ useLocation: () => ["/app", vi.fn()] }));

function reset() {
  state.personalities = [
    {
      id: "default",
      name: "Default",
      description: "Nova's own voice — balanced length, asks when unsure.",
      instructions: null,
      detail: null,
      collaboration: null,
      expertise: null,
      builtIn: true,
    },
  ];
  state.activePersonalityId = "default";
  state.isLoading = false;
}

describe("PersonalitySelector (composer)", () => {
  it("shows the active personality and a manage link, with no inline editor", () => {
    reset();
    const markup = renderToStaticMarkup(<PersonalitySelector />);
    expect(markup).toContain('aria-label="Choose personality"');
    expect(markup).toContain("Default");
    // Selecting only: creation lives in Settings, so no create form leaks here.
    expect(markup).not.toContain("Create personality");
  });

  it("summarises a personality as menu-sized chips", () => {
    const chips = personalityChips({
      id: "p_1",
      name: "Concise",
      description: "",
      instructions: "Straight answers, no preamble.",
      detail: "brief",
      collaboration: "act_and_tell",
      expertise: null,
      builtIn: false,
    });
    expect(chips).toEqual(["Brief", "Act & tell"]);
    // Default changes nothing, so it has no chips.
    expect(personalityChips(DEFAULT_PERSONALITY)).toEqual([]);
  });
});

describe("PersonalitiesCard (settings)", () => {
  it("lists Default read-only and offers the create form", () => {
    reset();
    const markup = renderToStaticMarkup(<PersonalitiesCard />);
    expect(markup).toContain("Personalities");
    expect(markup).toContain("Default");
    expect(markup).toContain("Create personality");
    expect(markup).toContain("How it should behave");
    expect(markup).toContain("Reply length");
    // Default is built in: no edit/delete controls for it.
    expect(markup).not.toContain(">Edit<");
  });

  it("offers use/edit/delete for a user-defined personality", () => {
    reset();
    state.personalities.push({
      id: "p_2",
      name: "Analyst",
      description: "",
      instructions: "Detailed, states assumptions.",
      detail: "detailed",
      collaboration: "act_and_tell",
      expertise: "expert",
      builtIn: false,
    });
    const markup = renderToStaticMarkup(<PersonalitiesCard />);
    expect(markup).toContain("Analyst");
    expect(markup).toContain("Use");
    expect(markup).toContain("Edit");
    expect(markup).toContain("Delete");
    expect(markup).toContain("Detailed · Act &amp; tell · Expert");
  });
});
