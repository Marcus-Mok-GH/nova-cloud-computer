/**
 * Workspace personalities: the named presets behind the composer's personality
 * picker. Default (Nova's own voice) is implicit - see shared/personalities.ts -
 * and every other row belongs to a workspace.
 *
 * Two reads matter to the agent: `listPersonalitiesForUser` (the picker's list,
 * Default first) and `resolveActivePersonalityForUser` (what the current run
 * should adopt). A row that was deleted after being selected resolves to
 * Default rather than failing the run.
 */
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { workspacePersonalities, workspaceSettings } from "../../drizzle/schema";
import { requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";
import {
  DEFAULT_PERSONALITY,
  DEFAULT_PERSONALITY_ID,
  PERSONALITY_INSTRUCTIONS_MAX,
  PERSONALITY_NAME_MAX,
  asPersonalityCollaboration,
  asPersonalityDetail,
  asPersonalityExpertise,
  type Personality,
} from "@shared/personalities";

function rowToPersonality(row: {
  id: string;
  name: string;
  instructions: string | null;
  detail: string | null;
  collaboration: string | null;
  expertise: string | null;
}): Personality {
  return {
    id: row.id,
    name: row.name,
    description: "",
    instructions: row.instructions,
    detail: asPersonalityDetail(row.detail),
    collaboration: asPersonalityCollaboration(row.collaboration),
    expertise: asPersonalityExpertise(row.expertise),
    builtIn: false,
  };
}

/** Default first, then the workspace's own personalities, oldest first. */
export async function listPersonalitiesForUser(ownerId: number): Promise<Personality[]> {
  const workspace = await getOrCreateWorkspace(ownerId);
  const db = await requireDb();
  const rows = await db
    .select()
    .from(workspacePersonalities)
    .where(eq(workspacePersonalities.workspaceId, workspace.id))
    .orderBy(asc(workspacePersonalities.createdAt), asc(workspacePersonalities.id));
  return [DEFAULT_PERSONALITY, ...rows.map(rowToPersonality)];
}

/**
 * The workspace's settings row, created on demand. Several personality reads
 * and writes need it (the active-selection column lives there), and a
 * workspace that never opened Settings has no row yet - a bare UPDATE would
 * silently match zero rows and lose the selection.
 */
async function ensureWorkspaceSettingsRow(workspaceId: number) {
  const db = await requireDb();
  const existing = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  if (existing[0]) return existing[0];
  await db.insert(workspaceSettings).values({ workspaceId }).onConflictDoNothing();
  const created = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  if (!created[0]) throw new Error("Nova could not create workspace settings.");
  return created[0];
}

/** The currently selected personality id for the workspace ("default" unless set). */
export async function getActivePersonalityIdForUser(ownerId: number): Promise<string> {
  const workspace = await getOrCreateWorkspace(ownerId);
  const row = await ensureWorkspaceSettingsRow(workspace.id);
  return row.activePersonalityId ?? DEFAULT_PERSONALITY_ID;
}

/**
 * The personality a run should adopt: the selected row when it still exists,
 * otherwise Default. Never null, so the prompt always has a personality block.
 */
export async function resolveActivePersonalityForUser(ownerId: number): Promise<Personality> {
  const activeId = await getActivePersonalityIdForUser(ownerId);
  if (activeId === DEFAULT_PERSONALITY_ID) return DEFAULT_PERSONALITY;
  const workspace = await getOrCreateWorkspace(ownerId);
  const db = await requireDb();
  const [row] = await db
    .select()
    .from(workspacePersonalities)
    .where(and(eq(workspacePersonalities.id, activeId), eq(workspacePersonalities.workspaceId, workspace.id)))
    .limit(1);
  return row ? rowToPersonality(row) : DEFAULT_PERSONALITY;
}

/** Select a personality. A non-default id must exist in this workspace. */
export async function setActivePersonalityForUser(ownerId: number, personalityId: string) {
  const workspace = await getOrCreateWorkspace(ownerId);
  const db = await requireDb();
  const id = personalityId.trim() || DEFAULT_PERSONALITY_ID;
  if (id !== DEFAULT_PERSONALITY_ID) {
    const [existing] = await db
      .select({ id: workspacePersonalities.id })
      .from(workspacePersonalities)
      .where(and(eq(workspacePersonalities.id, id), eq(workspacePersonalities.workspaceId, workspace.id)))
      .limit(1);
    if (!existing) return undefined;
  }
  const settings = await ensureWorkspaceSettingsRow(workspace.id);
  await db
    .update(workspaceSettings)
    .set({ activePersonalityId: id, updatedAt: new Date() })
    .where(eq(workspaceSettings.id, settings.id));
  return { activePersonalityId: id };
}

export type PersonalityInput = {
  name: string;
  instructions?: string | null;
  detail?: string | null;
  collaboration?: string | null;
  expertise?: string | null;
};

function cleanInput(input: PersonalityInput) {
  return {
    name: input.name.trim().slice(0, PERSONALITY_NAME_MAX),
    instructions: input.instructions?.trim().slice(0, PERSONALITY_INSTRUCTIONS_MAX) || null,
    detail: asPersonalityDetail(input.detail ?? null),
    collaboration: asPersonalityCollaboration(input.collaboration ?? null),
    expertise: asPersonalityExpertise(input.expertise ?? null),
  };
}

/** Creates a personality and returns it. Ids are opaque (`p_<random>`). */
export async function createPersonalityForUser(ownerId: number, input: PersonalityInput): Promise<Personality> {
  const workspace = await getOrCreateWorkspace(ownerId);
  const db = await requireDb();
  const values = cleanInput(input);
  const id = `p_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const [created] = await db
    .insert(workspacePersonalities)
    .values({ id, workspaceId: workspace.id, ...values })
    .returning();
  return rowToPersonality(created);
}

/** Updates a personality the workspace owns. Returns undefined when missing. */
export async function updatePersonalityForUser(
  ownerId: number,
  personalityId: string,
  input: PersonalityInput
): Promise<Personality | undefined> {
  const workspace = await getOrCreateWorkspace(ownerId);
  const db = await requireDb();
  const [updated] = await db
    .update(workspacePersonalities)
    .set({ ...cleanInput(input), updatedAt: new Date() })
    .where(and(eq(workspacePersonalities.id, personalityId), eq(workspacePersonalities.workspaceId, workspace.id)))
    .returning();
  return updated ? rowToPersonality(updated) : undefined;
}

/**
 * Deletes a personality. When the deleted row was the active selection the
 * workspace falls back to Default, so no run is left pointing at a dead id.
 */
export async function deletePersonalityForUser(ownerId: number, personalityId: string): Promise<boolean> {
  const workspace = await getOrCreateWorkspace(ownerId);
  const db = await requireDb();
  const [deleted] = await db
    .delete(workspacePersonalities)
    .where(and(eq(workspacePersonalities.id, personalityId), eq(workspacePersonalities.workspaceId, workspace.id)))
    .returning({ id: workspacePersonalities.id });
  if (!deleted) return false;
  const settings = await ensureWorkspaceSettingsRow(workspace.id);
  if (settings.activePersonalityId === personalityId) {
    await db
      .update(workspaceSettings)
      .set({ activePersonalityId: DEFAULT_PERSONALITY_ID, updatedAt: new Date() })
      .where(eq(workspaceSettings.id, settings.id));
  }
  return true;
}