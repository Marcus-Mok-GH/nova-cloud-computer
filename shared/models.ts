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

/**
 * The deep-thinking effort levels a model can expose. `auto` is always
 * present: it defers to the model's own default. The deeper levels are only
 * meaningful on reasoning-capable models - the gateway sends `reasoning_effort`
 * for the GLM-5.2-and-newer families and ignores it everywhere else.
 */
export type EffortId = "auto" | "low" | "medium" | "high" | "max";

/** Every effort level the gateway understands, deepest last. */
export const CHAT_EFFORT_OPTIONS: EffortId[] = [
  "auto",
  "low",
  "medium",
  "high",
  "max",
];

export type ChatModel = {
  /** Public id the client sends and the chat row stores. */
  id: string;
  label: string;
  description: string;
  tier: ChatModelTier;
  /** Gateway model id; undefined = the built-in nova-pro chain. */
  upstreamModel?: string;
  /**
   * The effort levels this model's selector offers, dynamically per model.
   * Always includes `"auto"`. The built-in Nova models expose the full depth
   * range; external premium models only offer `"auto"` because the gateway
   * would risk a rejection sending `reasoning_effort` to a strict endpoint
   * that does not accept it.
   */
  efforts: EffortId[];
};

export const FREE_CHAT_MODEL_ID = "nova-pro";

/** The full depth range the built-in Nova models expose. */
const NOVA_EFFORTS: EffortId[] = ["auto", "low", "medium", "high", "max"];
/** Effort options for models the gateway only serves in its default depth. */
const AUTO_ONLY_EFFORTS: EffortId[] = ["auto"];

export const DEFAULT_CHAT_MODELS: ChatModel[] = [
  {
    id: FREE_CHAT_MODEL_ID,
    label: "Nova Lite",
    description: "Nova's built-in model - fast, free for everyone.",
    tier: "free",
    efforts: NOVA_EFFORTS,
  },
  {
    id: "nova-ultra",
    label: "Nova Ultra",
    description: "Nova's most capable model for hard problems and long tasks.",
    tier: "pro",
    upstreamModel: "minimax/minimax-m3.1-flash",
    efforts: NOVA_EFFORTS,
  },
  {
    id: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash 1017",
    description: "DeepSeek's V4.1 Flash - fast, strong coding and reasoning.",
    tier: "pro",
    upstreamModel: "deepseek/deepseek-v4.1-flash",
    efforts: AUTO_ONLY_EFFORTS,
  },
  {
    id: "gemini-4-carbon",
    label: "Gemini 4 Carbon",
    description: "Google's Gemini 4 Carbon - newest flagship, long context and multimodal.",
    tier: "pro",
    upstreamModel: "gemini-4-carbon",
    efforts: AUTO_ONLY_EFFORTS,
  },
  {
    id: "claude-sonnet-5.5",
    label: "Claude Sonnet 5.5",
    description: "Anthropic's Sonnet 5.5 - fast, strong coding and reasoning.",
    tier: "pro",
    upstreamModel: "claude-sonnet-5-5",
    efforts: AUTO_ONLY_EFFORTS,
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
 * Coerces a raw (possibly env-supplied) effort list into the model's public
 * effort options: keeps only the gateway-known ids, always includes `auto`,
 * and de-dupes. An entry with no recognisable effort list offers only auto.
 */
function normalizeEfforts(raw: unknown): EffortId[] {
  const known = new Set<string>(CHAT_EFFORT_OPTIONS);
  const cleaned = Array.isArray(raw)
    ? raw.filter((value): value is EffortId => typeof value === "string" && known.has(value))
    : [];
  const deduped: EffortId[] = [];
  for (const value of cleaned) {
    if (!deduped.includes(value)) deduped.push(value);
  }
  if (!deduped.includes("auto")) deduped.unshift("auto");
  return deduped;
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
  if (!raw) return withEfforts(DEFAULT_CHAT_MODELS);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isChatModel)) {
      return withEfforts(DEFAULT_CHAT_MODELS);
    }
    if (!parsed.some(model => model.id === FREE_CHAT_MODEL_ID && model.tier === "free")) {
      return withEfforts(DEFAULT_CHAT_MODELS);
    }
    return withEfforts(parsed);
  } catch {
    return withEfforts(DEFAULT_CHAT_MODELS);
  }
}

/** Guarantees every entry carries a public effort list regardless of source. */
function withEfforts(models: ChatModel[]): ChatModel[] {
  return models.map(model => ({
    ...model,
    efforts: normalizeEfforts(
      model.efforts ?? (model.id === FREE_CHAT_MODEL_ID ? NOVA_EFFORTS : AUTO_ONLY_EFFORTS)
    ),
  }));
}

/** Looks up a catalogue entry by its public id. */
export function getChatModelById(modelId: string | null | undefined, models: ChatModel[] = getChatModels()) {
  if (!modelId) return undefined;
  return models.find(model => model.id === modelId);
}

/** The effort options a single model offers (always includes `auto`). */
export function effortOptionsForModel(model: ChatModel | undefined): EffortId[] {
  return model?.efforts?.length ? model.efforts : ["auto"];
}

/**
 * The effort options for a model id, resolved against the active catalogue.
 * An unknown or default model id offers the default model's options.
 */
export function effortOptionsForModelId(modelId: string | null | undefined, models: ChatModel[] = getChatModels()): EffortId[] {
  return effortOptionsForModel(getChatModelById(modelId, models) ?? getDefaultChatModel(models));
}

/** The catalogue's default selection: the free built-in model. */
export function getDefaultChatModel(models: ChatModel[] = getChatModels()) {
  return models.find(model => model.id === FREE_CHAT_MODEL_ID) ?? models[0];
}
