/**
 * The Agent Skills format (https://agentskills.io) as Nova stores it: a skill
 * is a kebab-case `name`, a `description` saying what it does and when to use
 * it, and the markdown instructions that load on demand.
 *
 * These rules live here, not in the server or the client alone, so the form on
 * the Skills page, the tRPC input schema, and the SKILL.md rendering can never
 * drift from each other - a skill Nova accepts must be a skill any other
 * Agent Skills tool (Claude Code, OpenCode, ...) can also load.
 */

/** Max length of the spec's `name` field (also the skill's identifier). */
export const SKILL_NAME_MAX_LENGTH = 64;
/** Max length of the spec's `description` field. */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;
/** Upper bound Nova puts on a skill body; the spec recommends keeping it under 500 lines. */
export const SKILL_BODY_MAX_LENGTH = 100_000;

/**
 * The spec's name rules in one expression: lowercase letters, numbers and
 * single hyphens only, never leading, trailing, or doubled.
 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SKILL_NAME_MESSAGE =
  "Use lowercase letters, numbers, and single hyphens - for example weekly-report.";
export const SKILL_DESCRIPTION_MESSAGE =
  "Say what the skill does and when Nova should use it.";

/** A skill as the format module sees it. */
export type SkillFields = {
  name: string;
  description: string;
  body?: string | null;
};

/** Returns a spec-valid skill name for a human title, or "" when nothing usable is left. */
export function skillNameFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_NAME_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/** Validation for one field: an error message, or null when it is acceptable. */
export function skillNameError(name: string): string | null {
  const value = name.trim();
  if (!value) return "A skill needs a name.";
  if (value.length > SKILL_NAME_MAX_LENGTH)
    return `Names are at most ${SKILL_NAME_MAX_LENGTH} characters.`;
  if (!SKILL_NAME_PATTERN.test(value)) return SKILL_NAME_MESSAGE;
  return null;
}

/** Validation for one field: an error message, or null when it is acceptable. */
export function skillDescriptionError(description: string): string | null {
  const value = description.trim();
  if (!value) return "Describe what the skill does and when to use it.";
  if (value.length > SKILL_DESCRIPTION_MAX_LENGTH)
    return `Descriptions are at most ${SKILL_DESCRIPTION_MAX_LENGTH} characters.`;
  // The spec forbids markup in a description: it is injected into a prompt
  // verbatim, so angle-bracketed text could be read as a tag by the model.
  if (value.includes("<") && value.includes(">"))
    return "Descriptions cannot contain < > markup.";
  return null;
}

/**
 * The skill rendered as SKILL.md: YAML frontmatter with the spec's required
 * fields, then the instructions. What the Skills page previews and what an
 * export hands to another agent tool.
 */
export function renderSkillMarkdown(skill: SkillFields): string {
  const body = (skill.body ?? "").replace(/^\n+/, "");
  const frontmatter = [
    "---",
    `name: ${skill.name.trim()}`,
    `description: ${JSON.stringify(skill.description.trim())}`,
    "---",
  ].join("\n");
  return body ? `${frontmatter}\n\n${body}\n` : `${frontmatter}\n`;
}
