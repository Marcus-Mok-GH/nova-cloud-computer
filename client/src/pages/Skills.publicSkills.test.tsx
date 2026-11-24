// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import Skills, { skillFormError } from "./Skills";
import { PUBLIC_SKILLS } from "@shared/publicSkills";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type SkillRow = {
  id: number;
  name: string;
  description: string;
  body: string;
  updatedAt: Date;
};

/**
 * The public gallery is interactive (typing filters it, clicking adds), which
 * static markup cannot observe, so this file renders the real page in jsdom and
 * drives it through the DOM.
 */
const state = vi.hoisted(() => ({
  skills: [] as SkillRow[],
  isLoading: false,
  isError: false,
  /** The create mutation: the handler it was configured with, plus its spy. */
  create: {
    mutate: vi.fn(),
    isPending: false,
    options: undefined as
      | {
          onSuccess?: (created: unknown) => void;
          onError?: (error: unknown) => void;
        }
      | undefined,
  },
  invalidate: vi.fn(),
}));

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
          error: null,
          refetch: vi.fn(),
        }),
      },
      create: {
        useMutation: (options?: (typeof state.create)["options"]) => {
          state.create.options = options;
          return state.create;
        },
      },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ skills: { list: { invalidate: state.invalidate } } }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

let container: HTMLDivElement | undefined;
let root: Root | undefined;

const renderSkills = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Skills />);
  });
};

/** Types into a controlled input the way React 19 hears it. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const q = (selector: string) => container?.querySelector(selector) ?? null;
const searchInput = () =>
  q('[data-testid="public-skill-search"]') as HTMLInputElement | null;

beforeEach(() => {
  state.skills = [];
  state.isLoading = false;
  state.isError = false;
  state.create.mutate.mockClear();
  state.create.options = undefined;
  state.invalidate.mockClear();
  (toast.success as ReturnType<typeof vi.fn>).mockClear();
  (toast.error as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("the public skills gallery", () => {
  it("renders every catalogue entry behind a search box", () => {
    renderSkills();
    expect(q('[data-testid="public-skills"]')).not.toBeNull();
    // Scoped to <article>: the search input shares the same testid prefix.
    expect(
      container?.querySelectorAll('article[data-testid^="public-skill-"]')
    ).toHaveLength(PUBLIC_SKILLS.length);
    expect(searchInput()?.placeholder).toBe("Search public skills");
    expect(searchInput()?.getAttribute("aria-label")).toBe(
      "Search public skills"
    );
  });

  it("ships entries the Skills form itself accepts", () => {
    for (const skill of PUBLIC_SKILLS) {
      expect(
        skillFormError({
          name: skill.name,
          description: skill.description,
          body: skill.body,
        }),
        skill.name
      ).toBeNull();
    }
  });

  it("filters the catalogue as the user types", () => {
    renderSkills();
    typeInto(searchInput()!, "EXPLAIN");
    expect(
      container?.querySelectorAll('article[data-testid^="public-skill-"]')
    ).toHaveLength(1);
    expect(q('[data-testid="public-skill-sql-tuning"]')).not.toBeNull();
    expect(q('[data-testid="public-skill-weekly-report"]')).toBeNull();
  });

  it("offers a way back when nothing matches", () => {
    renderSkills();
    typeInto(searchInput()!, "zzzz-no-such-skill");
    expect(q('[data-testid="public-skills-empty"]')).not.toBeNull();
    const clear = Array.from(container?.querySelectorAll("button") ?? []).find(
      button => button.textContent?.includes("Clear search")
    );
    expect(clear).toBeDefined();
    act(() => clear?.click());
    expect(q('[data-testid="public-skills-empty"]')).toBeNull();
    expect(
      container?.querySelectorAll('article[data-testid^="public-skill-"]')
    ).toHaveLength(PUBLIC_SKILLS.length);
  });

  it("adds a public skill to the library with its full instructions", () => {
    renderSkills();
    const skill = PUBLIC_SKILLS.find(s => s.name === "weekly-report")!;
    act(() => {
      (q('[data-testid="add-weekly-report"]') as HTMLButtonElement | null)?.click();
    });
    expect(state.create.mutate).toHaveBeenCalledTimes(1);
    expect(state.create.mutate).toHaveBeenCalledWith({
      name: skill.name,
      description: skill.description,
      body: skill.body,
    });

    // The success handler is what tells the user it worked and refreshes the
    // library, so drive it directly rather than trusting it was wired.
    act(() => {
      state.create.options?.onSuccess?.({ name: skill.name });
    });
    expect(toast.success).toHaveBeenCalledWith(
      '"weekly-report" is now in your library.'
    );
    expect(state.invalidate).toHaveBeenCalledTimes(1);
  });

  it("reports a failed add instead of claiming it worked", () => {
    renderSkills();
    act(() => {
      state.create.options?.onError?.({
        message: 'A skill named "weekly-report" already exists.',
      });
    });
    expect(toast.error).toHaveBeenCalledWith(
      'A skill named "weekly-report" already exists.'
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("marks a skill the library already holds instead of offering it twice", () => {
    state.skills = [
      {
        id: 4,
        name: "weekly-report",
        description: "Mine.",
        body: "1. Do it.",
        updatedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ];
    renderSkills();
    expect(q('[data-testid="added-weekly-report"]')).not.toBeNull();
    expect(q('[data-testid="add-weekly-report"]')).toBeNull();
    expect(
      container?.textContent
    ).toContain("In your library");
    // The rest of the catalogue is still addable.
    expect(q('[data-testid="add-code-review"]')).not.toBeNull();
  });
});
