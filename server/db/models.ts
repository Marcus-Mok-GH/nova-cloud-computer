import { and, asc, eq } from "drizzle-orm";
import { customModels, workspaceSettings } from "../../drizzle/schema";
import { encryptModelApiKey } from "../modelSecrets";
import { requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";

// "mistral" is the legacy stored identifier for Nova's built-in AI gateway.
// It is the persisted `model_provider` enum value, so it stays as-is.
type ActiveProvider = "anthropic" | "openai" | "gemini" | "custom" | "mistral";
type ModelCompatibility = "openai" | "anthropic";

function toSafeCustomModel(model: typeof customModels.$inferSelect) {
  const { encryptedApiKey: _encryptedApiKey, ...safeModel } = model;
  return { ...safeModel, hasApiKey: true };
}

async function getOrCreateWorkspaceSettings(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  return getOrCreateWorkspaceSettingsByWorkspaceId(workspace.id);
}

/** Internal: the caller must have resolved a workspace this owner owns. */
async function getOrCreateWorkspaceSettingsByWorkspaceId(workspaceId: number) {
  const db = await requireDb();
  const existing = await db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspaceId)).limit(1);
  if (existing[0]) return existing[0];
  await db.insert(workspaceSettings).values({ workspaceId }).onConflictDoNothing();
  const created = await db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspaceId)).limit(1);
  if (!created[0]) throw new Error("Nova could not create workspace settings.");
  return created[0];
}

export async function listCustomModelsForUser(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  return listCustomModelsByWorkspaceId(workspace.id);
}

/** Internal: the caller must have resolved a workspace this owner owns. */
async function listCustomModelsByWorkspaceId(workspaceId: number) {
  const db = await requireDb();
  return (await db.select().from(customModels).where(eq(customModels.workspaceId, workspaceId)).orderBy(asc(customModels.createdAt))).map(toSafeCustomModel);
}

export async function getCustomModelForUser(ownerId: number, customModelId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(customModels).where(and(eq(customModels.id, customModelId), eq(customModels.workspaceId, workspace.id))).limit(1))[0];
}

export async function createCustomModelForUser(ownerId: number, input: { name: string; modelId: string; baseUrl: string; compatibility: ModelCompatibility; apiKey: string; supportsImageInput: boolean }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [created] = await db.insert(customModels).values({
    workspaceId: workspace.id,
    name: input.name,
    modelId: input.modelId,
    baseUrl: input.baseUrl,
    compatibility: input.compatibility,
    encryptedApiKey: encryptModelApiKey(input.apiKey),
    supportsImageInput: input.supportsImageInput,
  }).returning();
  if (!created) throw new Error("Nova could not save the custom model.");
  return toSafeCustomModel(created);
}

export async function deleteCustomModelForUser(ownerId: number, customModelId: number) {
  const db = await requireDb();
  const model = await getCustomModelForUser(ownerId, customModelId);
  if (!model) return false;
  await db.delete(customModels).where(eq(customModels.id, model.id));
  const settings = await getOrCreateWorkspaceSettings(ownerId);
  if (settings.activeCustomModelId === model.id) {
    await db.update(workspaceSettings).set({ activeProvider: "anthropic", activeModelId: "claude-sonnet", activeCustomModelId: null, updatedAt: new Date() }).where(eq(workspaceSettings.id, settings.id));
  }
  return true;
}

/** The workspace's active BYOK custom model row (with encrypted key), or null when Nova's built-in gateway is in use. */
export async function getActiveCustomModelForUser(ownerId: number) {
  const db = await requireDb();
  const settings = await getOrCreateWorkspaceSettings(ownerId);
  if (settings.activeProvider !== "custom" || settings.activeCustomModelId === null) return null;
  return (await db
    .select()
    .from(customModels)
    .where(and(eq(customModels.id, settings.activeCustomModelId), eq(customModels.workspaceId, settings.workspaceId)))
    .limit(1))[0] ?? null;
}

export async function getWorkspaceModelSettingsForUser(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  return getWorkspaceModelSettingsByWorkspaceId(workspace.id);
}

/** Internal: the caller must have resolved a workspace this owner owns. */
export async function getWorkspaceModelSettingsByWorkspaceId(workspaceId: number) {
  const [settings, models] = await Promise.all([
    getOrCreateWorkspaceSettingsByWorkspaceId(workspaceId),
    listCustomModelsByWorkspaceId(workspaceId),
  ]);
  return { ...settings, customModels: models };
}

/** Structured personalisation controls. Plain strings in the database; the
 *  router validates them against these unions before they are saved. */
export type PersonalisationDetail = "brief" | "balanced" | "detailed";
export type PersonalisationProactiveness = "ask_first" | "act_and_tell" | "autonomous";
export type PersonalisationExpertise = "new" | "some" | "expert";
export const PERSONALISATION_DETAILS: PersonalisationDetail[] = ["brief", "balanced", "detailed"];
export const PERSONALISATION_PROACTIVENESS: PersonalisationProactiveness[] = ["ask_first", "act_and_tell", "autonomous"];
export const PERSONALISATION_EXPERTISE: PersonalisationExpertise[] = ["new", "some", "expert"];

export type PersonalisationSettings = {
  enabled: boolean;
  profile: string | null;
  tone: string | null;
  detail: PersonalisationDetail | null;
  proactiveness: PersonalisationProactiveness | null;
  expertise: PersonalisationExpertise | null;
};

export type PersonalisationInput = {
  enabled?: boolean;
  profile?: string | null;
  tone?: string | null;
  detail?: PersonalisationDetail | null;
  proactiveness?: PersonalisationProactiveness | null;
  expertise?: PersonalisationExpertise | null;
};

export async function updateWorkspaceModelSettingsForUser(ownerId: number, input: { activeProvider?: ActiveProvider; activeModelId?: string; activeCustomModelId?: number | null; workspaceRules?: string | null } & PersonalisationInput) {
  const db = await requireDb();
  const settings = await getOrCreateWorkspaceSettings(ownerId);
  const updateSet: Partial<typeof workspaceSettings.$inferInsert> = { updatedAt: new Date() };
  if (input.activeCustomModelId !== undefined && input.activeCustomModelId !== null) {
    const model = await getCustomModelForUser(ownerId, input.activeCustomModelId);
    if (!model) return undefined;
    updateSet.activeCustomModelId = model.id;
    if (input.activeProvider === "custom") updateSet.activeModelId = model.modelId;
  } else if (input.activeCustomModelId === null) updateSet.activeCustomModelId = null;
  if (input.activeProvider === "custom" && (input.activeCustomModelId ?? settings.activeCustomModelId) === null) return undefined;
  // Leaving the custom provider (back to a built-in gateway provider) must
  // clear the active custom-model row too: "use the built-in AI" means
  // exactly that, not a leftover selection that silently re-routes agent
  // traffic to the user's own endpoint.
  if (input.activeProvider !== undefined && input.activeProvider !== "custom") updateSet.activeCustomModelId = null;
  if (input.activeProvider !== undefined) updateSet.activeProvider = input.activeProvider;
  if (input.activeModelId !== undefined) updateSet.activeModelId = input.activeModelId;
  if (input.workspaceRules !== undefined) updateSet.workspaceRules = input.workspaceRules;
  if (input.enabled !== undefined) updateSet.personalisationEnabled = input.enabled;
  if (input.profile !== undefined) updateSet.personalisationProfile = input.profile;
  if (input.tone !== undefined) updateSet.personalisationTone = input.tone;
  if (input.detail !== undefined) updateSet.personalisationDetail = input.detail;
  if (input.proactiveness !== undefined) updateSet.personalisationProactiveness = input.proactiveness;
  if (input.expertise !== undefined) updateSet.personalisationExpertise = input.expertise;
  if (Object.keys(updateSet).length === 1) return getWorkspaceModelSettingsForUser(ownerId);
  await db.update(workspaceSettings).set(updateSet).where(eq(workspaceSettings.id, settings.id));
  return getWorkspaceModelSettingsForUser(ownerId);
}

/** The user's saved communication-style preference, injected into every agent run. */
export async function getCommunicationStyleForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [row] = await db.select({ communicationStyle: workspaceSettings.communicationStyle }).from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspace.id)).limit(1);
  return row?.communicationStyle ?? null;
}

/** Persists the user's communication-style preference (set by the agent via its tool). */
export async function setCommunicationStyleForUser(ownerId: number, style: string) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const trimmed = style.trim().slice(0, 500);
  await db.update(workspaceSettings).set({ communicationStyle: trimmed, updatedAt: new Date() }).where(eq(workspaceSettings.workspaceId, workspace.id));
  return trimmed;
}

/** The user's saved personalisation controls and distilled profile. */
export async function getPersonalisationForUser(ownerId: number): Promise<PersonalisationSettings> {
  const settings = await getOrCreateWorkspaceSettings(ownerId);
  return {
    enabled: settings.personalisationEnabled,
    profile: settings.personalisationProfile,
    tone: settings.personalisationTone,
    detail: settings.personalisationDetail as PersonalisationDetail | null,
    proactiveness: settings.personalisationProactiveness as PersonalisationProactiveness | null,
    expertise: settings.personalisationExpertise as PersonalisationExpertise | null,
  };
}

/**
 * Persists personalisation changes (set by the agent's `set_personalisation`
 * tool or the Settings UI). Empty strings clear text fields; only the keys the
 * caller passes are touched. Values are clipped so a chatty model cannot store
 * an unbounded blob.
 */
export async function setPersonalisationForUser(ownerId: number, input: PersonalisationInput): Promise<PersonalisationSettings> {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const updateSet: Partial<typeof workspaceSettings.$inferInsert> = { updatedAt: new Date() };
  if (input.enabled !== undefined) updateSet.personalisationEnabled = input.enabled;
  if (input.profile !== undefined) updateSet.personalisationProfile = input.profile?.trim().slice(0, 2000) || null;
  if (input.tone !== undefined) updateSet.personalisationTone = input.tone?.trim().slice(0, 60) || null;
  if (input.detail !== undefined) updateSet.personalisationDetail = input.detail ?? null;
  if (input.proactiveness !== undefined) updateSet.personalisationProactiveness = input.proactiveness ?? null;
  if (input.expertise !== undefined) updateSet.personalisationExpertise = input.expertise ?? null;
  await db.update(workspaceSettings).set(updateSet).where(eq(workspaceSettings.workspaceId, workspace.id));
  return getPersonalisationForUser(ownerId);
}
