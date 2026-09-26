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
  if (!db) throw new Error("The Nova database is unavailable.");
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
 * Collects a live health snapshot of every backend service this deployment
 * depends on: the API server itself, the Neon database, the Mistral inference
 * gateway (with the caller's remaining request allowance), the Telegram bot,
 * Composio connectors, and the account's persistent sandbox. Each check is
 * isolated so one failing dependency cannot take down the rest of the report.
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
    id: "api",
    name: "Nova API server",
    state: "operational",
    detail: `Responding · uptime ${describeUptime(processUptimeSeconds())}`,
    latencyMs: null,
  });

  const dbStartedAt = now();
  try {
    await dbProbe();
    const latencyMs = now() - dbStartedAt;
    services.push({
      id: "database",
      name: "Neon database",
      state: "operational",
      detail: "Query round-trip succeeded",
      latencyMs,
    });
  } catch (error) {
    services.push({
      id: "database",
      name: "Neon database",
      state: "offline",
      detail: error instanceof Error ? error.message : "Query round-trip failed",
      latencyMs: null,
    });
  }

  try {
    const inference = await inferenceStatus(ownerId);
    if (!inferenceConfigured()) {
      services.push({
        id: "inference",
        name: "Inference gateway (Mistral)",
        state: "unconfigured",
        detail: "No gateway URL or token configured on this server",
        latencyMs: null,
      });
    } else if (!inference.reachable) {
      services.push({
        id: "inference",
        name: "Inference gateway (Mistral)",
        state: "offline",
        detail: "Configured but unreachable (failed /models probe)",
        latencyMs: null,
      });
    } else if (inference.allowance.exhausted) {
      services.push({
        id: "inference",
        name: "Inference gateway (Mistral)",
        state: "degraded",
        detail: `Reachable but allowance exhausted (${inference.allowance.usedRequests}/${inference.allowance.maxRequests} requests used)`,
        latencyMs: null,
      });
    } else {
      services.push({
        id: "inference",
        name: "Inference gateway (Mistral)",
        state: "operational",
        detail:
          inference.allowance.maxRequests === null
            ? "Reachable · unlimited allowance"
            : `Reachable · ${inference.allowance.remainingRequests}/${inference.allowance.maxRequests} requests left today`,
        latencyMs: null,
      });
    }
  } catch (error) {
    services.push({
      id: "inference",
      name: "Inference gateway (Mistral)",
      state: "offline",
      detail: error instanceof Error ? error.message : "Gateway status check failed",
      latencyMs: null,
    });
  }

  try {
    const telegram = await telegramCheck();
    if (!telegram.configured) {
      services.push({
        id: "telegram",
        name: "Telegram bot",
        state: "unconfigured",
        detail: "DEFAULT_TELEGRAM_BOT_TOKEN is not set on this server",
        latencyMs: null,
      });
    } else if (!telegram.reachable) {
      services.push({
        id: "telegram",
        name: "Telegram bot",
        state: "offline",
        detail: "Token set but the getMe probe failed or timed out",
        latencyMs: null,
      });
    } else {
      services.push({
        id: "telegram",
        name: "Telegram bot",
        state: "operational",
        detail: telegram.botUsername ? `@${telegram.botUsername} is answering` : "getMe probe succeeded",
        latencyMs: null,
      });
    }
  } catch (error) {
    services.push({
      id: "telegram",
      name: "Telegram bot",
      state: "offline",
      detail: error instanceof Error ? error.message : "Bot status check failed",
      latencyMs: null,
    });
  }

  services.push({
    id: "composio",
    name: "Composio connectors",
    state: composioConfigured() ? "operational" : "unconfigured",
    detail: composioConfigured() ? "Project API key is set" : "COMPOSIO_API_KEY is not set on this server",
    latencyMs: null,
  });

  try {
    const workspace = await workspaceLookup(ownerId);
    services.push({
      id: "sandbox",
      name: "Persistent sandbox",
      state: workspace.persistentSandboxId ? "operational" : "unconfigured",
      detail: workspace.persistentSandboxId
        ? `Sandbox ${workspace.persistentSandboxId} is provisioned`
        : "No persistent sandbox is recorded for this workspace yet",
      latencyMs: null,
    });
  } catch (error) {
    services.push({
      id: "sandbox",
      name: "Persistent sandbox",
      state: "offline",
      detail: error instanceof Error ? error.message : "Workspace lookup failed",
      latencyMs: null,
    });
  }

  return {
    checkedAt: new Date(now()).toISOString(),
    serverUptimeSeconds: Math.floor(processUptimeSeconds()),
    services,
  };
}
