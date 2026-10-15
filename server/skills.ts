/**
 * Skills: the workspace's reusable procedures, stored in the open Agent Skills
 * format (name + description + markdown body) and scoped to the owner who
 * wrote them, exactly like conversation memories.
 *
 * The module owns three things: the store (create/update/delete/list), the
 * one rule the format must not break (a skill name is unique per owner, so
 * `read_skill name` resolves to exactly one procedure), and the prompt line
 * that surfaces name + description to the agent. The body never enters a
 * prompt on its own - read_skill loads it, which is what keeps a library of
 * skills free until one of them is actually used.
 */
import { desc, eq } from "drizzle-orm";
import { workspaceSkills, type WorkspaceSkill } from "../drizzle/schema";
import { getDb } from "./db";

/** A skill's name already exists for this owner. Surfaced as a conflict. */
export class SkillNameTakenError extends Error {
  constructor(name: string) {
    super(`A skill named "${name}" already exists - pick a different name.`);
    this.name = "SkillNameTakenError";
  }
}

/** The skill store itself is unreachable; the caller decides what to say. */
export class SkillStorageError extends Error {
  constructor() {
    super("Nova can't reach your skills right now. Please try again shortly.");
    this.name = "SkillStorageError";
  }
}

export type SkillInput = {
  name: string;
  description: string;
  body?: string;
};

/**
 * True for the unique-constraint violation the (ownerId, name) index raises.
 * The cause chain is walked because the Neon HTTP driver wraps driver errors.
 */
function isDuplicateSkillName(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function requireSkillsDb() {
  const db = await getDb();
  if (!db) throw new SkillStorageError();
  return db;
}

/** Every skill this owner has, most recently updated first. */
export async function listSkillsForUser(
  ownerId: number
): Promise<WorkspaceSkill[]> {
  const db = await requireSkillsDb();
  return db
    .select()
    .from(workspaceSkills)
    .where(eq(workspaceSkills.ownerId, ownerId))
    .orderBy(desc(workspaceSkills.updatedAt));
}

/** Looks one skill up by id, or null when it is not this owner's. */
export async function getSkillForUser(
  ownerId: number,
  skillId: number
): Promise<WorkspaceSkill | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(workspaceSkills)
    .where(eq(workspaceSkills.id, skillId))
    .limit(1);
  const row = rows[0];
  return row && row.ownerId === ownerId ? row : null;
}

/**
 * Resolves a skill by its name (what `read_skill` gets from the prompt's
 * skills block). Names are stored spec-valid lowercase, but the lookup is
 * forgiving about case and surrounding whitespace a model may add.
 */
export async function getSkillByNameForUser(
  ownerId: number,
  name: string
): Promise<WorkspaceSkill | null> {
  const db = await getDb();
  if (!db) return null;
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const rows = await db
    .select()
    .from(workspaceSkills)
    .where(eq(workspaceSkills.name, key))
    .limit(1);
  const row = rows[0];
  return row && row.ownerId === ownerId ? row : null;
}

/** Stores a new skill. Rejects with `SkillNameTakenError` on a duplicate name. */
export async function createSkillForUser(
  ownerId: number,
  input: SkillInput
): Promise<WorkspaceSkill> {
  const db = await requireSkillsDb();
  try {
    const [row] = await db
      .insert(workspaceSkills)
      .values({
        ownerId,
        name: input.name.trim().toLowerCase(),
        description: input.description.trim(),
        body: input.body ?? "",
      })
      .returning();
    if (!row) throw new SkillStorageError();
    return row;
  } catch (error) {
    if (isDuplicateSkillName(error))
      throw new SkillNameTakenError(input.name.trim());
    throw error;
  }
}

/**
 * Applies a partial update. Returns null when no skill with that id belongs to
 * this owner, so a stranger's id can neither be edited nor probed.
 */
export async function updateSkillForUser(
  ownerId: number,
  skillId: number,
  input: Partial<SkillInput>
): Promise<WorkspaceSkill | null> {
  const db = await requireSkillsDb();
  const existing = await getSkillForUser(ownerId, skillId);
  if (!existing) return null;
  const updateSet: Partial<typeof workspaceSkills.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined)
    updateSet.name = input.name.trim().toLowerCase();
  if (input.description !== undefined)
    updateSet.description = input.description.trim();
  if (input.body !== undefined) updateSet.body = input.body;
  try {
    const [row] = await db
      .update(workspaceSkills)
      .set(updateSet)
      .where(eq(workspaceSkills.id, existing.id))
      .returning();
    if (!row) throw new SkillStorageError();
    return row;
  } catch (error) {
    if (isDuplicateSkillName(error))
      throw new SkillNameTakenError(input.name ?? existing.name);
    throw error;
  }
}

/** Removes one of this owner's skills. False when it is not theirs or is gone. */
export async function deleteSkillForUser(
  ownerId: number,
  skillId: number
): Promise<boolean> {
  const db = await requireSkillsDb();
  const existing = await getSkillForUser(ownerId, skillId);
  if (!existing) return false;
  await db.delete(workspaceSkills).where(eq(workspaceSkills.id, existing.id));
  return true;
}

/**
 * The system-prompt line: name and description only, never a body. An empty
 * library says so plainly instead of leaving the model to wonder.
 */
export function formatSkillsForPrompt(
  skills: Array<Pick<WorkspaceSkill, "name" | "description">>
): string {
  if (!skills.length) return "none yet - the user has not added any skills.";
  return skills
    .map(skill => `- ${skill.name}: ${skill.description}`)
    .join("\n");
}

/**
 * The skills block for one run. Never throws: a store that is unreachable
 * degrades to "no skills" rather than failing a chat that does not need them.
 */
export async function listSkillsForPrompt(ownerId: number): Promise<string> {
  try {
    return formatSkillsForPrompt(await listSkillsForUser(ownerId));
  } catch (error) {
    console.warn(
      "[Skills] Could not load skills for the prompt:",
      error instanceof Error ? error.message : error
    );
    return "none yet";
  }
}
