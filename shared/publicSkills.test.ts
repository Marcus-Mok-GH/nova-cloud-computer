import { describe, expect, it } from "vitest";
import {
  PUBLIC_SKILLS,
  listPublicSkills,
  searchPublicSkills,
  type PublicSkill,
} from "./publicSkills";
import {
  SKILL_BODY_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  skillDescriptionError,
  skillNameError,
} from "./skills";

/** The rule the create endpoint applies to a skill body. */
const bodyError = (body: string): string | null =>
  body.trim() ? null : "Write the instructions Nova should follow for this skill.";

describe("the public skill catalogue", () => {
  it("ships every entry in the Agent Skills shape the API accepts", () => {
    for (const skill of PUBLIC_SKILLS) {
      expect(skillNameError(skill.name), skill.name).toBeNull();
      expect(skillDescriptionError(skill.description), skill.name).toBeNull();
      expect(bodyError(skill.body), skill.name).toBeNull();
      expect(skill.body.length, skill.name).toBeLessThanOrEqual(
        SKILL_BODY_MAX_LENGTH
      );
      expect(skill.description.length, skill.name).toBeLessThanOrEqual(
        SKILL_DESCRIPTION_MAX_LENGTH
      );
      expect(skill.name.length, skill.name).toBeLessThanOrEqual(
        SKILL_NAME_MAX_LENGTH
      );
    }
  });

  it("keeps names unique, because an add is keyed by name", () => {
    const names = PUBLIC_SKILLS.map(skill => skill.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("lists the catalogue alphabetically for browsing", () => {
    const names = listPublicSkills().map(skill => skill.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toHaveLength(PUBLIC_SKILLS.length);
  });

  it("hands out copies, so a caller cannot rewrite the shipped list", () => {
    listPublicSkills().pop();
    searchPublicSkills("").pop();
    expect(listPublicSkills()).toHaveLength(PUBLIC_SKILLS.length);
    expect(searchPublicSkills("")).toHaveLength(PUBLIC_SKILLS.length);
  });
});

describe("searching public skills", () => {
  it("returns everything for a blank query", () => {
    expect(searchPublicSkills("")).toHaveLength(PUBLIC_SKILLS.length);
    expect(searchPublicSkills("   ")).toHaveLength(PUBLIC_SKILLS.length);
  });

  it("matches the name, case-insensitively", () => {
    expect(searchPublicSkills("WEEKLY-REPORT").map(s => s.name)).toEqual([
      "weekly-report",
    ]);
    expect(searchPublicSkills("postmortem").map(s => s.name)).toEqual([
      "incident-postmortem",
    ]);
  });

  it("matches the description", () => {
    const results = searchPublicSkills("status report");
    expect(results.map(s => s.name)).toContain("weekly-report");
  });

  it("matches the instructions, not just the headline", () => {
    // "EXPLAIN" appears only inside sql-tuning's body - a search that looked
    // at the name and description alone would miss it.
    expect(searchPublicSkills("EXPLAIN").map(s => s.name)).toEqual([
      "sql-tuning",
    ]);
  });

  it("returns nothing when no entry matches", () => {
    expect(searchPublicSkills("zzzz-no-such-skill")).toEqual([]);
  });

  it("returns a filtered copy rather than mutating the catalogue", () => {
    const before = PUBLIC_SKILLS.length;
    searchPublicSkills("report").pop();
    expect(PUBLIC_SKILLS).toHaveLength(before);
  });
});
