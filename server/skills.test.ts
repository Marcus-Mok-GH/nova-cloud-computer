import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SkillNameTakenError,
  SkillStorageError,
  createSkillForUser,
  deleteSkillForUser,
  formatSkillsForPrompt,
  getSkillByNameForUser,
  getSkillForUser,
  listSkillsForPrompt,
  listSkillsForUser,
  updateSkillForUser,
} from "./skills";
import { getDb } from "./db";
import {
  SKILL_NAME_MAX_LENGTH,
  renderSkillMarkdown,
  skillDescriptionError,
  skillNameError,
  skillNameFromTitle,
} from "@shared/skills";

vi.mock("./db", () => ({ getDb: vi.fn() }));

type Row = Record<string, unknown>;

/**
 * A chainable stand-in for the drizzle builder: `where` conditions are
 * captured, not evaluated (evaluating them belongs to Postgres), while every
 * terminal step resolves rows so the skills module's `await` reads real values.
 */
const makeFakeDb = (store: {
  rows: Row[];
  onInsert?: (values: Row) => Row;
  onUpdate?: (values: Row) => Row;
}) => {
  const select = (limit?: number) =>
    Promise.resolve(
      limit === undefined ? [...store.rows] : store.rows.slice(0, limit)
    );
  const query = {
    from: () => query,
    where: () => query,
    orderBy: () => select(),
    limit: (n: number) => select(n),
  };
  return {
    select: () => ({ from: () => query }),
    insert: () => ({
      values: (values: Row) => ({
        returning: async () => [
          store.onInsert ? store.onInsert(values) : values,
        ],
      }),
    }),
    update: () => ({
      set: (values: Row) => ({
        where: () => ({
          returning: async () =>
            store.onUpdate ? [store.onUpdate(values)] : [values],
        }),
      }),
    }),
    delete: () => ({ where: async () => undefined }),
  };
};

const skillRow = (overrides: Row = {}) => ({
  id: 11,
  ownerId: 1,
  name: "weekly-report",
  description:
    "Writes the weekly status report. Use when the user asks for the weekly update.",
  body: "1. Read the shipped changes.\n2. Summarize in five bullets.",
  createdAt: new Date("2026-10-01T09:00:00Z"),
  updatedAt: new Date("2026-10-02T09:00:00Z"),
  ...overrides,
});

beforeEach(() => {
  vi.mocked(getDb).mockReset();
});

describe("skill store", () => {
  it("fails loudly when the store is unreachable instead of showing an empty library", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(listSkillsForUser(1)).rejects.toBeInstanceOf(
      SkillStorageError
    );
    await expect(
      createSkillForUser(1, {
        name: "weekly-report",
        description: "d",
        body: "b",
      })
    ).rejects.toBeInstanceOf(SkillStorageError);
    await expect(
      updateSkillForUser(1, 11, { body: "x" })
    ).rejects.toBeInstanceOf(SkillStorageError);
    await expect(deleteSkillForUser(1, 11)).rejects.toBeInstanceOf(
      SkillStorageError
    );
    // The prompt block is the one caller that must not fail a chat.
    await expect(listSkillsForPrompt(1)).resolves.toContain("none yet");
  });

  it("stores a skill under its spec-valid name and returns the record", async () => {
    const inserted = vi.fn((values: Row) => skillRow({ id: 21, ...values }));
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({ rows: [], onInsert: inserted }) as never
    );
    const skill = await createSkillForUser(1, {
      name: "  Weekly-Report ",
      description: "Writes the weekly status report.",
      body: "1. Read the shipped changes.",
    });
    expect(inserted.mock.calls[0][0]).toMatchObject({
      ownerId: 1,
      name: "weekly-report",
      description: "Writes the weekly status report.",
    });
    expect(skill).toMatchObject({ id: 21, name: "weekly-report" });
  });

  it("reports a duplicate skill name as a conflict the router can surface", async () => {
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({
        rows: [],
        onInsert: () => {
          throw Object.assign(new Error("duplicate key value"), {
            code: "23505",
          });
        },
      }) as never
    );
    await expect(
      createSkillForUser(1, {
        name: "weekly-report",
        description: "d",
        body: "b",
      })
    ).rejects.toBeInstanceOf(SkillNameTakenError);
  });

  it("applies a partial update and refreshes the timestamp", async () => {
    const updated = vi.fn((values: Row) => skillRow(values));
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({ rows: [skillRow()], onUpdate: updated }) as never
    );
    const skill = await updateSkillForUser(1, 11, {
      description: "New trigger.",
    });
    expect(updated.mock.calls[0][0]).toMatchObject({
      description: "New trigger.",
    });
    expect(
      (updated.mock.calls[0][0].updatedAt as Date).getTime()
    ).toBeGreaterThan(skillRow().updatedAt.getTime());
    expect(skill).toMatchObject({ name: "weekly-report" });
  });

  it("never edits, reads, or deletes a skill that belongs to someone else", async () => {
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({ rows: [skillRow({ ownerId: 1 })] }) as never
    );
    await expect(getSkillForUser(2, 11)).resolves.toBeNull();
    await expect(getSkillByNameForUser(2, "weekly-report")).resolves.toBeNull();
    await expect(
      updateSkillForUser(2, 11, { body: "stolen" })
    ).resolves.toBeNull();
    await expect(deleteSkillForUser(2, 11)).resolves.toBe(false);
    await expect(getSkillForUser(1, 11)).resolves.toMatchObject({
      name: "weekly-report",
    });
  });

  it("resolves a skill by name, forgiving the case a model may send", async () => {
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({ rows: [skillRow()] }) as never
    );
    await expect(
      getSkillByNameForUser(1, "  Weekly-Report ")
    ).resolves.toMatchObject({
      id: 11,
    });
    await expect(getSkillByNameForUser(1, "   ")).resolves.toBeNull();
  });
});

describe("skills in the system prompt", () => {
  it("lists name and description only - a body never rides in the prompt", () => {
    const line = formatSkillsForPrompt([
      {
        name: "weekly-report",
        description: "Writes the weekly status report.",
      },
    ]);
    expect(line).toContain("- weekly-report: Writes the weekly status report.");
    expect(line).not.toContain("1. Read the shipped changes.");
  });

  it("says plainly when the workspace has no skills yet", () => {
    expect(formatSkillsForPrompt([])).toContain("none yet");
    expect(formatSkillsForPrompt([])).not.toContain("undefined");
  });

  it("degrades to no skills when the store cannot be read", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("neon down"));
    await expect(listSkillsForPrompt(1)).resolves.toContain("none yet");
  });
});

describe("Agent Skills format rules", () => {
  it("accepts spec-valid names and rejects everything the spec forbids", () => {
    expect(skillNameError("weekly-report")).toBeNull();
    expect(skillNameError("a1-b2-c3")).toBeNull();
    expect(skillNameError("Weekly-Report")).toMatch(/lowercase/);
    expect(skillNameError("-leading")).toMatch(/lowercase/);
    expect(skillNameError("trailing-")).toMatch(/lowercase/);
    expect(skillNameError("double--hyphen")).toMatch(/lowercase/);
    expect(skillNameError("with space")).toMatch(/lowercase/);
    expect(skillNameError("")).toMatch(/name/);
    expect(skillNameError("a".repeat(SKILL_NAME_MAX_LENGTH + 1))).toMatch(
      /at most/
    );
  });

  it("requires a real description and forbids markup in it", () => {
    expect(
      skillDescriptionError(
        "Extracts PDFs and merges them. Use when PDFs come up."
      )
    ).toBeNull();
    expect(skillDescriptionError("")).toMatch(/Describe/);
    expect(skillDescriptionError("uses <b> tags")).toMatch(/markup/);
  });

  it("slugifies a human title into a valid skill name", () => {
    expect(skillNameFromTitle("Weekly Status Report")).toBe(
      "weekly-status-report"
    );
    expect(skillNameFromTitle("  Deploy! (v2)  ")).toBe("deploy-v2");
    expect(skillNameFromTitle("!!!")).toBe("");
    expect(skillNameFromTitle("a".repeat(80))).toHaveLength(
      SKILL_NAME_MAX_LENGTH
    );
  });

  it("renders SKILL.md with frontmatter before the instructions", () => {
    const markdown = renderSkillMarkdown({
      name: "weekly-report",
      description: "Writes the weekly status report.",
      body: "1. Read the shipped changes.",
    });
    expect(markdown.startsWith("---\nname: weekly-report\n")).toBe(true);
    expect(markdown).toContain(
      'description: "Writes the weekly status report."'
    );
    expect(markdown.indexOf("---", 4)).toBeLessThan(
      markdown.indexOf("1. Read the shipped changes.")
    );
    // No body still yields a loadable skill file.
    expect(renderSkillMarkdown({ name: "x", description: "y", body: "" })).toBe(
      '---\nname: x\ndescription: "y"\n---\n'
    );
  });
});
