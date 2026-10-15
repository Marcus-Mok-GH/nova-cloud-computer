import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Skills, { skillFormError } from "./Skills";

type SkillRow = {
  id: number;
  name: string;
  description: string;
  body: string;
  updatedAt: Date;
};

const state = vi.hoisted(() => ({
  skills: [] as SkillRow[],
  isLoading: false,
  isError: false,
  errorMessage: null as string | null,
}));

const mutation = { mutate: vi.fn(), isPending: false };

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main data-testid="skills-shell">{children}</main>
  ),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    skills: {
      list: {
        useQuery: () => ({
          data: state.skills,
          isLoading: state.isLoading,
          isError: state.isError,
          error: state.errorMessage ? { message: state.errorMessage } : null,
          refetch: vi.fn(),
        }),
      },
      create: { useMutation: () => mutation },
      update: { useMutation: () => mutation },
      delete: { useMutation: () => mutation },
    },
    useUtils: () => ({ skills: { list: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const renderSkills = () => renderToStaticMarkup(<Skills />);

/** The opening tag of the save button, matched by its label so Tailwind's
 *  always-present `disabled:` utility classes cannot fake a disabled state. */
function saveButtonTag(markup: string): string {
  const labelAt = markup.indexOf("Create skill</button>");
  if (labelAt < 0) return "";
  const start = markup.lastIndexOf("<button", labelAt);
  return start < 0 ? "" : markup.slice(start, labelAt);
}

describe("Skills page rendered states", () => {
  beforeEach(() => {
    state.skills = [];
    state.isLoading = false;
    state.isError = false;
    state.errorMessage = null;
    mutation.mutate.mockClear();
  });

  it("explains progressive disclosure and prompts for the first skill", () => {
    const markup = renderSkills();
    expect(markup).toContain("Reusable instructions");
    expect(markup).toContain("loads the instructions only when it needs them");
    expect(markup).toContain("No skills yet");
    expect(markup).toContain("Create your first skill");
  });

  it("lists each skill with its name, trigger description, and last update", () => {
    state.skills = [
      {
        id: 11,
        name: "weekly-report",
        description:
          "Writes the weekly status report. Use when the user asks for the weekly update.",
        body: "1. Read the shipped changes.",
        updatedAt: new Date("2026-10-02T09:00:00Z"),
      },
    ];
    const markup = renderSkills();
    expect(markup).toContain('data-testid="skill-11"');
    expect(markup).toContain("weekly-report");
    expect(markup).toContain("Writes the weekly status report.");
    expect(markup).toContain("Edit");
    expect(markup).toContain("Delete");
    expect(markup).toContain("1 skill");
    expect(markup).not.toContain("No skills yet");
  });

  it("shows a spinner while the library loads instead of an empty prompt", () => {
    state.isLoading = true;
    const markup = renderSkills();
    expect(markup).not.toContain("No skills yet");
    expect(markup).toContain("animate-spin");
  });

  it("offers a retry when the library cannot be reached", () => {
    state.isError = true;
    // Apostrophe-free copy: renderToStaticMarkup HTML-escapes straight quotes.
    state.errorMessage = "The skills service is unavailable.";
    const markup = renderSkills();
    expect(markup).toContain("Your skills could not be loaded.");
    expect(markup).toContain("The skills service is unavailable.");
    expect(markup).toContain("Try again");
    expect(markup).not.toContain("No skills yet");
  });
});

describe("skill form validation", () => {
  const valid = {
    name: "weekly-report",
    description:
      "Writes the weekly status report. Use when the user asks for the weekly update.",
    body: "1. Read the shipped changes.",
  };

  it("accepts a spec-compliant skill", () => {
    expect(skillFormError(valid)).toBeNull();
    expect(skillFormError({ ...valid, name: "  weekly-report  " })).toBeNull();
  });

  it("requires a name in the Agent Skills shape", () => {
    expect(skillFormError({ ...valid, name: "" })).toMatch(/name/i);
    expect(skillFormError({ ...valid, name: "Weekly Report" })).toMatch(
      /lowercase/
    );
    expect(skillFormError({ ...valid, name: "weekly--report" })).toMatch(
      /lowercase/
    );
    expect(skillFormError({ ...valid, name: "weekly-report-" })).toMatch(
      /lowercase/
    );
  });

  it("requires a description that says when to use the skill", () => {
    expect(skillFormError({ ...valid, description: "   " })).toMatch(
      /Describe/
    );
    expect(skillFormError({ ...valid, description: "uses <b> tags" })).toMatch(
      /markup/
    );
  });

  it("requires instructions for Nova to follow", () => {
    expect(skillFormError({ ...valid, body: "" })).toMatch(/instructions/i);
    expect(skillFormError({ ...valid, body: "   " })).toMatch(/instructions/i);
  });
});
