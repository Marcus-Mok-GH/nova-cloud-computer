import { getDb, getOrCreateWorkspace } from "./db";
import { getMistralGatewayStatus, isMistralGatewayConfigured } from "./mistralGateway";
import { isComposioConfigured } from "./composio";
import { validateTelegramBotToken } from "./telegram";

import type { ServiceHealth, ServiceState, ServiceStatusReport } from "@shared/serviceStatus";

export type { ServiceHealth, ServiceState, ServiceStatusReport };

type TelegramCheck = { configured: boolean; reachable: boolean; botUsername: string | null };

export type ServiceStatusDeps = {
  now?: () => number;
  processUptimeSeconds?: () => number;
  dbProbe?: () => Promise<void>;
  inferenceStatus?: (ownerId: number) => Promise<Awaited<ReturnType<typeof getMistralGatewayStatus>>>;
  inferenceConfigured?: () => boolean;
  telegramCheck?: () => Promise<TelegramCheck>;
  composioConfigured?: () => boolean;
  workspaceLookup?: (ownerId: number) => Promise<{ persistentSandboxId: string | null }>;
};

const TELEGRAM_STATUS_TTL_MS = 60_000;
let telegramStatusCache: { expiresAt: number; value: TelegramCheck } | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/** The Telegram bot check is a live getMe round-trip, so it is cached briefly. */
async function defaultTelegramCheck(): Promise<TelegramCheck> {
  const token = process.env.DEFAULT_TELEGRAM_BOT_TOKEN;
  if (!token) return { configured: false, reachable: false, botUsername: null };
  if (telegramStatusCache && telegramStatusCache.expiresAt > Date.now()) {
    return telegramStatusCache.value;
  }
  const profile = await withTimeout(validateTelegramBotToken(token), 4_000, null);
  const value: TelegramCheck = {
    configured: true,
    reachable: Boolean(profile),
    botUsername: profile?.username ?? null,
  };
  telegramStatusCache = { expiresAt: Date.now() + TELEGRAM_STATUS_TTL_MS, value };
  return value;
}

async function defaultDbProbe() {
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("Workspace data is unavailable.");
  await db.execute(sql`select 1`);
}

function describeUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

/**
 * Collects a live health snapshot of the deployment, described only in
 * user-facing terms: the web app, workspace data, AI responses, the Telegram
 * integration, connectors, and the workspace sandbox. Each check is isolated
 * so one failing dependency cannot take down the rest of the report.
 *
 * This report is rendered verbatim on the status page, so it must never name
 * an internal service or backend: no database/gateway/provider names, no
 * environment variable names, and no raw error messages. Failed checks get a
 * fixed, generic detail instead.
 */
export async function collectServiceStatus(
  ownerId: number,
  deps: ServiceStatusDeps = {}
): Promise<ServiceStatusReport> {
  const now = deps.now ?? (() => Date.now());
  const processUptimeSeconds = deps.processUptimeSeconds ?? (() => process.uptime());
  const dbProbe = deps.dbProbe ?? defaultDbProbe;
  const inferenceStatus = deps.inferenceStatus ?? getMistralGatewayStatus;
  const inferenceConfigured = deps.inferenceConfigured ?? isMistralGatewayConfigured;
  const telegramCheck = deps.telegramCheck ?? defaultTelegramCheck;
  const composioConfigured = deps.composioConfigured ?? isComposioConfigured;
  const workspaceLookup =
    deps.workspaceLookup ??
    (async (owner: number) => {
      const workspace = await getOrCreateWorkspace(owner);
      return { persistentSandboxId: workspace.persistentSandboxId };
    });

  const services: ServiceHealth[] = [];

  services.push({
    id: "web",
    name: "Web app",
    state: "operational",
    detail: `Responding · uptime ${describeUptime(processUptimeSeconds())}`,
    latencyMs: null,
  });

  const dbStartedAt = now();
  try {
    await dbProbe();
    const latencyMs = now() - dbStartedAt;
    services.push({
      id: "data",
      name: "Workspace data",
      state: "operational",
      detail: "Read and write check succeeded",
      latencyMs,
    });
  } catch (error) {
    console.warn(
      "[Status] workspace data probe failed:",
      error instanceof Error ? error.message : error
    );
    services.push({
      id: "data",
      name: "Workspace data",
      state: "offline",
      detail: "Temporarily unavailable",
      latencyMs: null,
    });
  }

  try {
    const inference = await inferenceStatus(ownerId);
    if (!inferenceConfigured()) {
      services.push({
        id: "ai",
        name: "AI responses",
        state: "unconfigured",
        detail: "No AI provider is set up on this workspace yet",
        latencyMs: null,
      });
    } else if (!inference.reachable) {
      services.push({
        id: "ai",
        name: "AI responses",
        state: "offline",
        detail: "Not responding right now",
        latencyMs: null,
      });
    } else if (inference.allowance.exhausted) {
      services.push({
        id: "ai",
        name: "AI responses",
        state: "degraded",
        detail: `Daily request allowance used up (${inference.allowance.usedRequests}/${inference.allowance.maxRequests} requests)`,
        latencyMs: null,
      });
    } else {
      services.push({
        id: "ai",
        name: "AI responses",
        state: "operational",
        detail:
          inference.allowance.maxRequests === null
            ? "Responding · no daily limit"
            : `Responding · ${inference.allowance.remainingRequests}/${inference.allowance.maxRequests} requests left today`,
        latencyMs: null,
      });
    }
  } catch (error) {
    console.warn(
      "[Status] AI responses probe failed:",
      error instanceof Error ? error.message : error
    );
    services.push({
      id: "ai",
      name: "AI responses",
      state: "offline",
      detail: "Not responding right now",
      latencyMs: null,
    });
  }

  try {
    const telegram = await telegramCheck();
    if (!telegram.configured) {
      services.push({
        id: "telegram",
        name: "Telegram",
        state: "unconfigured",
        detail: "Not set up on this workspace yet",
        latencyMs: null,
      });
    } else if (!telegram.reachable) {
      services.push({
        id: "telegram",
        name: "Telegram",
        state: "offline",
        detail: "Not responding right now",
        latencyMs: null,
      });
    } else {
      services.push({
        id: "telegram",
        name: "Telegram",
        state: "operational",
        detail: telegram.botUsername ? `@${telegram.botUsername} is answering` : "Responding",
        latencyMs: null,
      });
    }
  } catch (error) {
    console.warn(
      "[Status] Telegram probe failed:",
      error instanceof Error ? error.message : error
    );
    services.push({
      id: "telegram",
      name: "Telegram",
      state: "offline",
      detail: "Not responding right now",
      latencyMs: null,
    });
  }

  services.push({
    id: "connectors",
    name: "Connectors",
    state: composioConfigured() ? "operational" : "unconfigured",
    detail: composioConfigured() ? "Ready to connect apps like GitHub and Gmail" : "Not available on this workspace yet",
    latencyMs: null,
  });

  try {
    const workspace = await workspaceLookup(ownerId);
    services.push({
      id: "sandbox",
      name: "Workspace sandbox",
      state: workspace.persistentSandboxId ? "operational" : "unconfigured",
      detail: workspace.persistentSandboxId ? "Ready for this workspace" : "Not created yet",
      latencyMs: null,
    });
  } catch (error) {
    console.warn(
      "[Status] workspace sandbox lookup failed:",
      error instanceof Error ? error.message : error
    );
    services.push({
      id: "sandbox",
      name: "Workspace sandbox",
      state: "offline",
      detail: "Temporarily unavailable",
      latencyMs: null,
    });
  }

  return {
    checkedAt: new Date(now()).toISOString(),
    serverUptimeSeconds: Math.floor(processUptimeSeconds()),
    services,
  };
}
