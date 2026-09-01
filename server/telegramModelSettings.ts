import { sql } from "drizzle-orm";
import { decryptModelApiKey } from "./modelSecrets";
import { getDb, getOrCreateWorkspace } from "./db";
import { ENV } from "./_core/env";
import { listNvidiaModels } from "./nvidiaGateway";

type Provider = "nvidia-nim" | "custom";

export async function getTelegramModelSettingsForUser(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  const db = await getDb();
  if (!db) throw new Error("The Nova database is unavailable.");
  const result = await db.execute(sql`SELECT "modelProvider", "modelId", "customModelId" FROM "telegram_bot_settings" WHERE "workspaceId" = ${workspace.id} LIMIT 1`);
  const row = (result as any).rows?.[0] ?? (result as any)[0];
  const provider = (row?.modelProvider ?? "nvidia-nim") as Provider;
  const modelId = row?.modelId ?? "";
  const customModelId = row?.customModelId ? Number(row.customModelId) : null;
  const options = provider === "nvidia-nim" ? await listNvidiaModels() : [];
  return { provider, modelId, customModelId, options };
}

export async function updateTelegramModelSettingsForUser(ownerId: number, input: { provider: Provider; modelId: string; customModelId?: number | null }) {
  const workspace = await getOrCreateWorkspace(ownerId);
  const db = await getDb();
  if (!db) throw new Error("The Nova database is unavailable.");
  let customModelId = input.customModelId ?? null;
  if (input.provider === "nvidia-nim") {
    const models = await listNvidiaModels(true);
    if (!models.some(option => option.id === input.modelId)) throw new Error("That NVIDIA model is not currently available.");
  }
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
    if (!apiKey || !settings.modelId) return undefined;
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
