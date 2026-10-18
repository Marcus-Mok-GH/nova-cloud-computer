import { desc } from "drizzle-orm";
import { getDb } from "./db";
import { AiGatewayClientError } from "./aiGateway";
import { novaApiErrorLogs } from "../drizzle/schema";
import { NOVA_PRO_MODEL_ID } from "@shared/const";

export const NOVA_API_ERROR_ENDPOINT = "/api/v1/chat/completions";
const MAX_MESSAGE_CHARS = 1200;

function truncate(message: string): string {
  return message.length > MAX_MESSAGE_CHARS ? message.slice(0, MAX_MESSAGE_CHARS) : message;
}

function classifyError(error: unknown): { statusCode: number; errorKind: string | null; errorCode: string; errorMessage: string } {
  // Duck-typed InferenceApiError (name + status/code) to avoid a runtime
  // import cycle with server/inferenceApi.ts, which imports this module.
  const candidate = error as { name?: unknown; status?: unknown; code?: unknown; message?: unknown } | null;
  if (candidate && candidate.name === "InferenceApiError" && typeof candidate.status === "number" && typeof candidate.code === "string") {
    return { statusCode: candidate.status, errorKind: "inference_api_error", errorCode: candidate.code, errorMessage: truncate(typeof candidate.message === "string" ? candidate.message : "Request failed.") };
  }
  if (error instanceof AiGatewayClientError) {
    const mapped = mapGatewayKind(error.kind);
    return { statusCode: mapped.status, errorKind: error.kind, errorCode: mapped.code, errorMessage: truncate(error.message) };
  }
  const message = error instanceof Error && error.message ? error.message : "Nova's inference service hit an unexpected error.";
  return { statusCode: 500, errorKind: "internal_error", errorCode: "internal_error", errorMessage: truncate(message) };
}

function mapGatewayKind(kind: AiGatewayClientError["kind"]): { status: number; code: string } {
  switch (kind) {
    case "client_error":
      return { status: 400, code: "bad_request" };
    case "credits_exhausted":
      return { status: 429, code: "insufficient_credits" };
    case "allowance_reached":
      return { status: 429, code: "allowance_reached" };
    case "rate_limit":
      return { status: 429, code: "rate_limit" };
    case "configuration":
      return { status: 503, code: "model_not_configured" };
    default:
      return { status: 500, code: "internal_error" };
  }
}

export type RecordNovaApiErrorInput = {
  ownerId: number;
  error: unknown;
  endpoint?: string;
  method?: string;
  /** Pass false for BYOK-routed requests so they are never logged. */
  isNovaModel?: boolean;
};

/**
 * Persists a failed Nova-model API request. Callers must gate on
 * `choice.ownedBy === "nova"` (or an unresolved request that defaults to
 * `nova-pro`); BYOK failures return null and store nothing.
 */
export async function recordNovaApiError(input: RecordNovaApiErrorInput): Promise<number | null> {
  if (input.isNovaModel === false) return null;
  try {
    const db = await getDb();
    if (!db) return null;
    const classified = classifyError(input.error);
    const [row] = await db
      .insert(novaApiErrorLogs)
      .values({
        ownerId: input.ownerId,
        endpoint: input.endpoint ?? NOVA_API_ERROR_ENDPOINT,
        method: input.method ?? "POST",
        modelId: NOVA_PRO_MODEL_ID,
        statusCode: classified.statusCode,
        errorKind: classified.errorKind,
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
      })
      .returning({ id: novaApiErrorLogs.id });
    return row?.id ?? null;
  } catch (logError) {
    console.warn("[Nova API errors] Could not persist error log", logError instanceof Error ? logError.message : logError);
    return null;
  }
}

export const NOVA_API_ERROR_LOGS_LIMIT = 100;

export async function listNovaApiErrorLogs(limit = NOVA_API_ERROR_LOGS_LIMIT) {
  const db = await getDb();
  if (!db) throw new Error("Nova can't reach your workspace data right now. Please try again shortly.");
  const rows = await db
    .select({
      id: novaApiErrorLogs.id,
      ownerId: novaApiErrorLogs.ownerId,
      endpoint: novaApiErrorLogs.endpoint,
      method: novaApiErrorLogs.method,
      modelId: novaApiErrorLogs.modelId,
      statusCode: novaApiErrorLogs.statusCode,
      errorKind: novaApiErrorLogs.errorKind,
      errorCode: novaApiErrorLogs.errorCode,
      errorMessage: novaApiErrorLogs.errorMessage,
      createdAt: novaApiErrorLogs.createdAt,
    })
    .from(novaApiErrorLogs)
    .orderBy(desc(novaApiErrorLogs.createdAt))
    .limit(Math.min(Math.max(limit, 1), NOVA_API_ERROR_LOGS_LIMIT));
  return rows;
}

export async function clearNovaApiErrorLogs(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Nova can't reach your workspace data right now. Please try again shortly.");
  const deleted = await db.delete(novaApiErrorLogs).returning({ id: novaApiErrorLogs.id });
  return deleted.length;
}
