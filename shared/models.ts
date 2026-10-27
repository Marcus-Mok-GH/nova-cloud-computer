/**
 * The chat model catalogue shared by the client composer and the server's
 * gating/routing. `nova-pro` is the free built-in model every account can
 * use; every other entry is a premium model that requires an active paid
 * subscription (see server/db/credits.ts).
 *
 * `upstreamModel` is the model id requested from the AI gateway. When it is
 * undefined the gateway's own primary → fallback chain runs, which is exactly
 * what `nova-pro` is. Premium ids default to the latest models below and can
 * be replaced wholesale with the NOVA_CHAT_MODELS_JSON env var (same shape as
 * `DEFAULT_CHAT_MODELS`), so a deployment can match its gateway's catalogue
 * without a code change.
 */
export type ChatModelTier = "free" | "pro";

export type ChatModel = {
  /** Public id the client sends and the chat row stores. */
  id: string;
  label: string;
  description: string;
  tier: ChatModelTier;
  /** Gateway model id; undefined = the built-in nova-pro chain. */
  upstreamModel?: string;
};

export const FREE_CHAT_MODEL_ID = "nova-pro";

export const DEFAULT_CHAT_MODELS: ChatModel[] = [
  {
    id: FREE_CHAT_MODEL_ID,
    label: "Nova Pro",
    description: "Nova's built-in model - fast, free for everyone.",
    tier: "free",
  },
  {
    id: "nova-ultra",
    label: "Nova Ultra",
    description: "Nova's most capable model for hard problems and long tasks.",
    tier: "pro",
    upstreamModel: "gpt-5.2",
  },
  {
    id: "claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    description: "Anthropic's latest Sonnet - strong coding and reasoning.",
    tier: "pro",
    upstreamModel: "claude-sonnet-4.6",
  },
  {
    id: "gemini-3-pro",
    label: "Gemini 3 Pro",
    description: "Google's latest Gemini Pro - long context and multimodal.",
    tier: "pro",
    upstreamModel: "gemini-3-pro-preview",
  },
  {
    id: "grok-4.1",
    label: "Grok 4.1",
    description: "xAI's latest Grok - fast reasoning and tool use.",
    tier: "pro",
    upstreamModel: "grok-4.1-fast",
  },
];

function isChatModel(value: unknown): value is ChatModel {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    candidate.id.length <= 64 &&
    typeof candidate.label === "string" &&
    typeof candidate.description === "string" &&
    (candidate.tier === "free" || candidate.tier === "pro") &&
    (candidate.upstreamModel === undefined ||
      (typeof candidate.upstreamModel === "string" && candidate.upstreamModel.length > 0))
  );
}

/**
 * Reads NOVA_CHAT_MODELS_JSON without touching `process` in the browser: this
 * module is shared with the client bundle, where `process` is not defined.
 */
function defaultModelsEnv(): string | undefined {
  return typeof process !== "undefined" ? process.env?.NOVA_CHAT_MODELS_JSON : undefined;
}

/**
 * The active catalogue: NOVA_CHAT_MODELS_JSON when it parses as a valid list
 * that still contains the free model, otherwise the built-in defaults. The
 * env override can only relabel or replace premium entries - a catalogue
 * without `nova-pro` is rejected so the free path can never disappear.
 */
export function getChatModels(env: string | undefined = defaultModelsEnv()): ChatModel[] {
  const raw = env?.trim();
  if (!raw) return DEFAULT_CHAT_MODELS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isChatModel)) {
      return DEFAULT_CHAT_MODELS;
    }
    if (!parsed.some(model => model.id === FREE_CHAT_MODEL_ID && model.tier === "free")) {
      return DEFAULT_CHAT_MODELS;
    }
    return parsed;
  } catch {
    return DEFAULT_CHAT_MODELS;
  }
}

/** Looks up a catalogue entry by its public id. */
export function getChatModelById(modelId: string | null | undefined, models: ChatModel[] = getChatModels()) {
  if (!modelId) return undefined;
  return models.find(model => model.id === modelId);
}

/** The catalogue's default selection: the free built-in model. */
export function getDefaultChatModel(models: ChatModel[] = getChatModels()) {
  return models.find(model => model.id === FREE_CHAT_MODEL_ID) ?? models[0];
}
