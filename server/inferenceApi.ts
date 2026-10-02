import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { API_KEY_PREFIX, findOwnerByApiKey } from "./apiKeys";
import { chatWithCustomModel, getActiveCustomModel } from "./byokGateway";
import { getDailyCreditStatusForUser } from "./db";
import { chatWithAiGateway, type GatewayChatMessage, type GatewayChatResult, AiGatewayClientError } from "./aiGateway";
import type { CustomModel } from "../drizzle/schema";

/**
 * OpenAI-compatible inference API. Clients authenticate with a Nova API key
 * (created in Settings) as `Authorization: Bearer nova_sk_...`.
 *
 * Each workspace exposes a fixed, one-or-two-choice model surface: Nova's
 * built-in model under the public name `nova-pro`, plus the workspace's own
 * BYOK model when one is selected in Settings. Requests against the built-in
 * model are charged against the owner's daily Nova credits and workspace
 * inference allowance, exactly like chat inside the app; BYOK requests run on
 * the user's own provider and claim no allowance.
 */

export const MAX_INFERENCE_MESSAGES = 40;
export const MAX_INFERENCE_PROMPT_CHARS = 100_000;

/**
 * The public name of Nova's built-in model. The API never exposes the
 * underlying gateway model id: clients ask for `nova-pro` and the built-in
 * gateway resolves whichever default this deployment is configured with.
 */
export const NOVA_PRO_MODEL_ID = "nova-pro";

/** One callable model in a workspace's inference API surface. */
export type InferenceApiModel = {
  id: string;
  /** `nova` for the built-in model, `byok` for the workspace's own provider. */
  ownedBy: "nova" | "byok";
  /** The BYOK row to route on, or null for the built-in gateway. */
  customModel: CustomModel | null;
};

/**
 * The models one workspace's API key can call: Nova's built-in `nova-pro`,
 * plus the workspace's active BYOK model when one is selected in Settings.
 * Without BYOK there is a single choice; with it there are two.
 */
export function inferenceApiModels(customModel: CustomModel | null): InferenceApiModel[] {
  const models: InferenceApiModel[] = [{ id: NOVA_PRO_MODEL_ID, ownedBy: "nova", customModel: null }];
  if (customModel && customModel.modelId !== NOVA_PRO_MODEL_ID) {
    models.push({ id: customModel.modelId, ownedBy: "byok", customModel });
  }
  return models;
}

/**
 * Resolves the requested model against the workspace's choices. An omitted
 * model means `nova-pro`. Anything else is rejected: the API is a fixed
 * one-or-two-choice surface, not a pass-through to the provider's catalogue.
 */
export function resolveInferenceModel(customModel: CustomModel | null, requestedModel: string | undefined): InferenceApiModel {
  const models = inferenceApiModels(customModel);
  const requested = requestedModel?.trim() || NOVA_PRO_MODEL_ID;
  const match = models.find(model => model.id === requested);
  if (!match) {
    fail(400, `\`model\` must be one of: ${models.map(model => model.id).join(", ")}.`, "invalid_request_error", "invalid_model");
  }
  return match;
}

export class InferenceApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public type: string,
    public code: string
  ) {
    super(message);
    this.name = "InferenceApiError";
  }
}

export function openAiErrorPayload(status: number, message: string, type: string, code: string) {
  return { error: { message, type, code } };
}

function fail(status: number, message: string, type: string, code: string): never {
  throw new InferenceApiError(status, message, type, code);
}

/** Extracts and validates the bearer API key from an inbound request. */
export function readApiKeyFromRequest(headers: { authorization?: string; "x-api-key"?: string }): string | null {
  const authHeader = headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token.startsWith(API_KEY_PREFIX) ? token : null;
  }
  const headerKey = headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim().startsWith(API_KEY_PREFIX)) return headerKey.trim();
  return null;
}

type IncomingMessage = { role?: unknown; content?: unknown };

/**
 * Normalizes an OpenAI-style request body into gateway messages. Tools and
 * function calls are outside the v1 surface; structured content parts are
 * flattened to their text, mirroring what the in-app chat supports.
 */
export function parseInferenceApiMessages(body: { messages?: unknown; model?: unknown; tools?: unknown; tool_choice?: unknown; stream?: unknown }) {
  if (body.tools !== undefined || body.tool_choice !== undefined) {
    fail(400, "Nova's inference API does not accept tools or function calling yet.", "invalid_request_error", "tools_unsupported");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    fail(400, "`messages` must be a non-empty array.", "invalid_request_error", "invalid_messages");
  }
  if (body.messages.length > MAX_INFERENCE_MESSAGES) {
    fail(400, `\`messages\` is limited to ${MAX_INFERENCE_MESSAGES} entries per request.`, "invalid_request_error", "too_many_messages");
  }
  const messages: GatewayChatMessage[] = [];
  let totalChars = 0;
  for (const raw of body.messages as IncomingMessage[]) {
    if (raw === null || typeof raw !== "object") fail(400, "Every message must be an object with `role` and `content`.", "invalid_request_error", "invalid_messages");
    const role = (raw as IncomingMessage).role;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      fail(400, "`role` must be one of: system, user, assistant.", "invalid_request_error", "invalid_role");
    }
    const content = (raw as IncomingMessage).content;
    let text: string;
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      const parts = content as Array<{ type?: string; text?: unknown }>;
      if (!parts.every(part => part?.type === "text" && typeof part.text === "string")) {
        fail(400, "Content parts must all be of type `text`.", "invalid_request_error", "invalid_content");
      }
      text = parts.map(part => part.text).join("\n");
    } else {
      fail(400, "`content` must be a string or an array of text parts.", "invalid_request_error", "invalid_content");
    }
    totalChars += text.length;
    messages.push({ role, content: text });
  }
  if (totalChars > MAX_INFERENCE_PROMPT_CHARS) {
    fail(400, `The prompt is limited to ${MAX_INFERENCE_PROMPT_CHARS} characters.`, "invalid_request_error", "prompt_too_long");
  }
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
  if (model && model.length > 240) fail(400, "`model` is not a known Nova model.", "invalid_request_error", "invalid_model");
  const stream = body.stream === true;
  return { messages, model, stream };
}

export function buildOpenAiChatCompletion(result: GatewayChatResult, modelId?: string) {
  return {
    id: `chatcmpl-nova-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId ?? result.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: result.usage?.prompt_tokens ?? 0,
      completion_tokens: result.usage?.completion_tokens ?? 0,
      total_tokens: result.usage?.total_tokens ?? 0,
    },
    "x-nova-allowance": result.allowance,
  };
}

export function buildOpenAiSseChunk(id: string, model: string, delta: Record<string, unknown>, finishReason: string | null) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/** Maps gateway client errors to OpenAI-style status, type and code. */
export function mapGatewayClientError(error: AiGatewayClientError): { status: number; type: string; code: string } {
  switch (error.kind) {
    case "client_error":
      return { status: 400, type: "invalid_request_error", code: "bad_request" };
    case "credits_exhausted":
      return { status: 429, type: "rate_limit_error", code: "insufficient_credits" };
    case "allowance_reached":
      return { status: 429, type: "rate_limit_error", code: "allowance_reached" };
    case "rate_limit":
      return { status: 429, type: "rate_limit_error", code: "rate_limit" };
    case "configuration":
      return { status: 503, type: "server_error", code: "model_not_configured" };
    default:
      return { status: 500, type: "server_error", code: "internal_error" };
  }
}

function sendError(res: Response, status: number, message: string, type: string, code: string) {
  return res.status(status).json(openAiErrorPayload(status, message, type, code));
}

async function requireApiOwner(req: Request, res: Response): Promise<number | null> {
  const presentedKey = readApiKeyFromRequest(req.headers);
  if (!presentedKey) {
    sendError(res, 401, "Missing or invalid API key. Pass `Authorization: Bearer nova_sk_...`.", "invalid_request_error", "invalid_api_key");
    return null;
  }
  const ownerId = await findOwnerByApiKey(presentedKey);
  if (ownerId === null) {
    sendError(res, 401, "That API key has been revoked or no longer exists.", "invalid_request_error", "invalid_api_key");
    return null;
  }
  return ownerId;
}

function handleInferenceError(res: Response, error: unknown) {
  if (error instanceof InferenceApiError) return sendError(res, error.status, error.message, error.type, error.code);
  if (error instanceof AiGatewayClientError) {
    const mapped = mapGatewayClientError(error);
    return sendError(res, mapped.status, error.message, mapped.type, mapped.code);
  }
  console.error("[Inference API] Request failed", error);
  return sendError(res, 500, "Nova's inference service hit an unexpected error. Please retry shortly.", "server_error", "internal_error");
}

export const inferenceApiRouter = express.Router();

inferenceApiRouter.get("/models", async (req: Request, res: Response) => {
  try {
    const ownerId = await requireApiOwner(req, res);
    if (ownerId === null) return;
    const customModel = await getActiveCustomModel(ownerId);
    res.json({
      object: "list",
      data: inferenceApiModels(customModel).map(model => ({ id: model.id, object: "model", created: 0, owned_by: model.ownedBy })),
    });
  } catch (error) {
    handleInferenceError(res, error);
  }
});

inferenceApiRouter.get("/me", async (req: Request, res: Response) => {
  try {
    const ownerId = await requireApiOwner(req, res);
    if (ownerId === null) return;
    const credits = await getDailyCreditStatusForUser(ownerId);
    res.json({ authenticated: true, credits });
  } catch (error) {
    handleInferenceError(res, error);
  }
});

inferenceApiRouter.post("/chat/completions", async (req: Request, res: Response) => {
  let sseStarted = false;
  let completionId = "";
  try {
    const ownerId = await requireApiOwner(req, res);
    if (ownerId === null) return;
    const { messages, model, stream } = parseInferenceApiMessages(req.body ?? {});
    // The API is BYOK-aware: an active workspace custom model is a callable
    // choice alongside `nova-pro`, and each choice routes to its own backend.
    const choice = resolveInferenceModel(await getActiveCustomModel(ownerId), model);
    const runChat = (options: { onChunk?: (chunk: string) => void; signal?: AbortSignal }) =>
      choice.customModel ? chatWithCustomModel(choice.customModel, messages, options) : chatWithAiGateway(ownerId, messages, options);

    if (!stream) {
      const result = await runChat({});
      return res.json(buildOpenAiChatCompletion(result, choice.id));
    }

    completionId = `chatcmpl-nova-${randomUUID()}`;
    const abort = new AbortController();
    const closeHandler = () => abort.abort();
    res.on("close", closeHandler);

    sseStarted = true;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
    res.write(buildOpenAiSseChunk(completionId, choice.id, { role: "assistant" }, null));

    const result = await runChat({
      onChunk: chunk => {
        if (chunk) res.write(buildOpenAiSseChunk(completionId, choice.id, { content: chunk }, null));
      },
      signal: abort.signal,
    });

    res.write(buildOpenAiSseChunk(completionId, choice.id, {}, "stop"));
    if (result.usage) {
      res.write(`data: ${JSON.stringify({ id: completionId, object: "chat.completion.chunk", usage: { prompt_tokens: result.usage.prompt_tokens ?? 0, completion_tokens: result.usage.completion_tokens ?? 0, total_tokens: result.usage.total_tokens ?? 0 } })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    return res.end();
  } catch (error) {
    // Once the SSE stream has begun the client is committed to it: surface
    // the failure as an error event instead of a status code.
    if (sseStarted) {
      const reason = error instanceof InferenceApiError || error instanceof AiGatewayClientError ? error.message : "Nova's inference service hit an unexpected error.";
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: { message: reason, type: "server_error", code: "internal_error" } })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
      console.error("[Inference API] Streaming request failed", error);
      return;
    }
    handleInferenceError(res, error);
  }
});
