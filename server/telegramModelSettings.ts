import { sql } from "drizzle-orm";
import { decryptModelApiKey } from "./modelSecrets";
import { getDb, getOrCreateWorkspace } from "./db";
import { ENV } from "./_core/env";

export const TELEGRAM_MODEL_OPTIONS = [
  { provider: "nvidia-nim", modelId: "z-ai/glm-5.2", name: "GLM 5.2" },
  { provider: "nvidia-nim", modelId: "moonshotai/kimi-k2.5", name: "Kimi K2.5" },
  { provider: "nvidia-nim", modelId: "minimaxai/minimax-m2.1", name: "MiniMax M2.1" },
] as const;

type Provider = "nvidia-nim" | "custom";

export async function getTelegramModelSettingsForUser(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  const db = await getDb();
  if (!db) throw new Error("The Nova database is unavailable.");
  const result = await db.execute(sql`SELECT "modelProvider", "modelId", "customModelId" FROM "telegram_bot_settings" WHERE "workspaceId" = ${workspace.id} LIMIT 1`);
  const row = (result as any).rows?.[0] ?? (result as any)[0];
  return {
    provider: (row?.modelProvider ?? "nvidia-nim") as Provider,
    modelId: row?.modelId ?? "z-ai/glm-5.2",
    customModelId: row?.customModelId ? Number(row.customModelId) : null,
    options: TELEGRAM_MODEL_OPTIONS,
  };
}

export async function updateTelegramModelSettingsForUser(ownerId: number, input: { provider: Provider; modelId: string; customModelId?: number | null }) {
  const workspace = await getOrCreateWorkspace(ownerId);
  const db = await getDb();
  if (!db) throw new Error("The Nova database is unavailable.");
  if (input.provider === "nvidia-nim" && !TELEGRAM_MODEL_OPTIONS.some(option => option.modelId === input.modelId)) throw new Error("That Telegram model is not available.");
  let customModelId = input.customModelId ?? null;
  if (input.provider === "custom") {
    if (!customModelId) throw new Error("Choose a custom model.");
    const check = await db.execute(sql`SELECT id, "modelId" FROM "custom_models" WHERE id = ${customModelId} AND "workspaceId" = ${workspace.id} LIMIT 1`);
    const custom = (check as any).rows?.[0] ?? (check as any)[0];
    if (!custom) throw new Error("That custom model is not available in your workspace.");
    input = { ...input, modelId: custom.modelId };
  }
  await db.execute(sql`UPDATE "telegram_bot_settings" SET "modelProvider" = ${input.provider}, "modelId" = ${input.modelId}, "customModelId" = ${customModelId}, "updatedAt" = now() WHERE "workspaceId" = ${workspace.id}`);
  return getTelegramModelSettingsForUser(ownerId);
}

export async function getTelegramModelConnectionForUser(ownerId: number) {
  const settings = await getTelegramModelSettingsForUser(ownerId);
  const apiKey = process.env.NVIDIA_NIM_API_KEY || ENV.nvidiaNimApiKey;
  if (settings.provider === "nvidia-nim") {
    if (!apiKey) return undefined;
    return { model: settings.modelId, apiUrl: ENV.nvidiaNimApiUrl, apiKey };
  }
  if (!settings.customModelId) return undefined;
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.execute(sql`SELECT "modelId", "baseUrl", "compatibility", "encryptedApiKey" FROM "custom_models" WHERE id = ${settings.customModelId} AND "workspaceId" = (SELECT "id" FROM "workspaces" WHERE "ownerId" = ${ownerId} LIMIT 1) LIMIT 1`);
  const row = (result as any).rows?.[0] ?? (result as any)[0];
  if (!row) return undefined;
  return { model: row.modelId, apiUrl: row.baseUrl, apiKey: decryptModelApiKey(row.encryptedApiKey) };
}
