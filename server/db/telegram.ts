import { createHmac } from "crypto";
import { eq, sql } from "drizzle-orm";
import { telegramBotSettings, telegramUpdateLog, workspaces } from "../../drizzle/schema";
import { decryptPrivateCredential, encryptPrivateCredential } from "../modelSecrets";
import { getTelegramWebhookInfo } from "../telegram";
import { ENV } from "../_core/env";
import { requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";

type TelegramWebhookStatus = { linked: boolean };

async function resolveTelegramWebhookStatus(setting: typeof telegramBotSettings.$inferSelect): Promise<TelegramWebhookStatus | null> {
  try {
    const token = decryptPrivateCredential(setting.encryptedBotToken);
    const info = await getTelegramWebhookInfo(token);
    // Never expose the webhook URL: it embeds the bot token.
    return { linked: info.linked };
  } catch {
    return { linked: false };
  }
}

/** Deterministic per-workspace code that authorizes a Telegram chat link through the shared bot. */
export function telegramLinkCodeForUser(ownerId: number) {
  return createHmac("sha256", ENV.modelCredentialSecret).update(`nova-telegram-link:${ownerId}`).digest("hex").slice(0, 12);
}

/** Resolves the workspace owner whose link code matches, for secure webhook-time chat linking. */
export async function findWorkspaceOwnerByTelegramLinkCode(linkCode: string) {
  const db = await requireDb();
  const rows = await db.select({ workspaceId: telegramBotSettings.workspaceId }).from(telegramBotSettings);
  for (const row of rows) {
    const ws = (await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1))[0];
    if (ws && telegramLinkCodeForUser(ws.ownerId).toLowerCase() === linkCode.toLowerCase()) return ws.ownerId;
  }
  return null;
}

function toSafeTelegramSettings(setting: typeof telegramBotSettings.$inferSelect | undefined, webhook: TelegramWebhookStatus | null, ownerId: number) {
  const linkCode = telegramLinkCodeForUser(ownerId);
  if (!setting) return { configured: false as const, chatId: null, botUsername: null, botDisplayName: null, webhook: null, linkCode };
  return {
    configured: true as const,
    chatId: setting.chatId,
    botUsername: setting.botUsername,
    botDisplayName: setting.botDisplayName,
    webhook,
    linkCode,
  };
}

/**
 * Returns the workspace's Telegram bot row, materializing a record for the
 * server-wide default bot when the owner has not configured an explicit token
 * yet. Returns undefined only when no default bot is set and nothing is saved.
 */
async function getOrCreateTelegramSetting(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const existing = (await db.select().from(telegramBotSettings).where(eq(telegramBotSettings.workspaceId, workspace.id)).limit(1))[0];
  if (existing) return existing;
  if (!ENV.defaultTelegramBotToken) return undefined;
  const [inserted] = await db.insert(telegramBotSettings).values({
    workspaceId: workspace.id,
    encryptedBotToken: encryptPrivateCredential(ENV.defaultTelegramBotToken),
    chatId: null,
    botUsername: null,
    botDisplayName: null,
  }).onConflictDoNothing({ target: telegramBotSettings.workspaceId }).returning();
  if (inserted) return inserted;
  // A concurrent first-insert wins and returns no row to the loser: reread the winner's.
  return (await db.select().from(telegramBotSettings).where(eq(telegramBotSettings.workspaceId, workspace.id)).limit(1))[0] ?? existing;
}

export async function getTelegramSettingsForUser(ownerId: number) {
  const setting = await getOrCreateTelegramSetting(ownerId);
  const webhook = setting ? await resolveTelegramWebhookStatus(setting) : null;
  return toSafeTelegramSettings(setting, webhook, ownerId);
}

export async function saveTelegramSettingsForUser(ownerId: number, input: { botToken: string; chatId?: string | null; botUsername?: string | null; botDisplayName?: string | null }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  await db.insert(telegramBotSettings).values({
    workspaceId: workspace.id,
    encryptedBotToken: encryptPrivateCredential(input.botToken),
    chatId: input.chatId ?? null,
    botUsername: input.botUsername ?? null,
    botDisplayName: input.botDisplayName ?? null,
  }).onConflictDoUpdate({
    target: telegramBotSettings.workspaceId,
    set: {
      encryptedBotToken: encryptPrivateCredential(input.botToken),
      chatId: input.chatId ?? null,
      botUsername: input.botUsername ?? null,
      botDisplayName: input.botDisplayName ?? null,
      updatedAt: new Date(),
    },
  });
  return getTelegramSettingsForUser(ownerId);
}

export async function updateTelegramChatForUser(ownerId: number, chatId: string) {
  const setting = await getOrCreateTelegramSetting(ownerId);
  if (!setting) return toSafeTelegramSettings(undefined, null, ownerId);
  const db = await requireDb();
  const [updated] = await db.update(telegramBotSettings).set({ chatId, updatedAt: new Date() }).where(eq(telegramBotSettings.workspaceId, setting.workspaceId)).returning();
  const webhook = updated ? await resolveTelegramWebhookStatus(updated) : null;
  return toSafeTelegramSettings(updated, webhook, ownerId);
}

export async function getTelegramCredentialsForUser(ownerId: number) {
  const setting = await getOrCreateTelegramSetting(ownerId);
  if (!setting) return undefined;
  return { token: decryptPrivateCredential(setting.encryptedBotToken), chatId: setting.chatId, botUsername: setting.botUsername, botDisplayName: setting.botDisplayName };
}

export async function deleteTelegramSettingsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [deleted] = await db.delete(telegramBotSettings).where(eq(telegramBotSettings.workspaceId, workspace.id)).returning({ id: telegramBotSettings.id });
  return !!deleted;
}

export async function findWorkspaceOwnerByTelegramToken(token: string, chatId?: string) {
  const db = await requireDb();
  // Shared (default) bot: isolate by Telegram chatId - each Telegram user is
  // bound to exactly one workspace via telegramBotSettings.chatId. This prevents
  // cross-tenant message leakage when many users share the same bot.
  if (ENV.defaultTelegramBotToken && token === ENV.defaultTelegramBotToken) {
    if (chatId) {
      const linked = (await db.select().from(telegramBotSettings).where(eq(telegramBotSettings.chatId, chatId)).limit(1))[0];
      if (linked) {
        const ws = (await db.select().from(workspaces).where(eq(workspaces.id, linked.workspaceId)).limit(1))[0];
        if (ws) return ws.ownerId;
      }
    }
    // Unlinked chat: do not attribute to oldest workspace - caller must handle null (ask to link).
    return null;
  }
  const rows = await db.select().from(telegramBotSettings);
  for (const row of rows) {
    try {
      const decrypted = decryptPrivateCredential(row.encryptedBotToken);
      if (decrypted === token) {
        const workspace = (await db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1))[0];
        return workspace?.ownerId ?? null;
      }
    } catch {
      // skip corrupted encrypted value
    }
  }
  return null;
}

/**
 * Atomically claims a Telegram webhook update id. Returns true when this call
 * is the first to see the update, false when Telegram is redelivering an
 * update Nova already handled (the webhook holds the HTTP connection open for
 * the whole agent run, so Telegram re-sends updates it saw time out - without
 * this claim every redelivery would re-run the agent and duplicate replies).
 * Old rows are pruned opportunistically; a database error fails open so the
 * bot keeps working even if the log table is unavailable.
 */
export async function claimTelegramUpdate(updateId: number): Promise<boolean> {
  const db = await requireDb();
  try {
    await db.execute(sql`DELETE FROM "telegram_update_log" WHERE "createdAt" < now() - interval '7 days'`);
  } catch {}
  const claimed = await db
    .insert(telegramUpdateLog)
    .values({ updateId })
    .onConflictDoNothing()
    .returning({ updateId: telegramUpdateLog.updateId });
  return claimed.length > 0;
}
