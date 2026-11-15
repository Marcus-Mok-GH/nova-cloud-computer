/**
 * Dynamic "auto" effort: classifies the user's latest request into a
 * concrete reasoning depth (low | medium | high) so an auto-effort chat
 * sends as much thinking as *this* ask needs instead of one fixed depth.
 * Pure and deterministic - no model call - so it costs nothing per turn.
 *
 * The classifier is deliberately conservative: short pleasantries and
 * single factual questions resolve shallow, ordinary tasks land medium,
 * and only requests with real reasoning surface (code blocks, step-by-step
 * asks, architecture/trade-off/proof language, long or list-shaped input)
 * go deep. Callers decide what a level means per provider; unknown models
 * never see an effort field at all.
 */

export type RequestEffort = "low" | "medium" | "high";

/** Minimal message shape the classifiers need (matches GatewayChatMessage). */
type EffortMessage = {
  role: string;
  content?: string | null | Array<{ type?: string; text?: string }>;
};

/**
 * The newest user message's text, multimodal parts included. Returns ""
 * when the conversation has no user text (image-only turns, no messages),
 * which callers treat as "keep the deployment/provider default".
 */
export function lastUserText(messages: readonly EffortMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .filter(part => part.type === "text" && typeof part.text === "string")
        .map(part => part.text)
        .join("\n")
        .trim();
      if (text) return text;
      // Image-only turn: no textual request to classify; keep looking at
      // earlier user turns rather than guessing from pixels.
      continue;
    }
    continue;
  }
  return "";
}

const GREETING =
  /^(?:hi+|hello|hey|yo|thanks|thank you|thx|ok(?:ay)?|yes|no|test|ping|good (?:morning|afternoon|evening))\b/;

const TASK_VERB =
  /\b(?:write|summari[sz]e|create|build|make|fix|find|explain|list|draft|schedule|research|review|check|translate|convert|generate|organize|implement|update|install|configure|compare|plan|design|debug|deploy|analy[sz]e)\b/;

const HEAVY_REASONING =
  /step[- ]by[- ]step|think (?:hard|deeply)|reason through|prove|derivative|integral|complexit|big[- ]o|architect|trade[- ]offs?|root[- ]cause|refactor|migrat|security|threat model|optimi[sz]e|benchmark|algorithm|pros and cons|design (?:a|an|the) (?:system|architecture|pipeline)|implementation plan|concurren|distributed/;

/**
 * Classify one request's text. Deterministic scoring (see tests for the
 * behaviour table): code fences, heavy-reasoning keywords, length, list
 * shapes and multiple questions push deeper; greetings and short factual
 * questions pull shallower; ordinary task imperatives land medium.
 */
export function classifyRequestEffort(raw: string): RequestEffort {
  const text = raw.trim();
  if (!text) return "medium";
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);

  let score = 0;
  if (text.includes("```")) score += 3;
  const heavyHits = lower.match(HEAVY_REASONING)?.length ?? 0;
  score += Math.min(heavyHits * 2, 6);
  if (words.length >= 40) score += 1;
  if (words.length >= 90) score += 1;
  if (words.length >= 160) score += 1;
  if (/^\s*(?:\d+[.)]|[-*])\s+/m.test(text)) score += 1;
  if ((text.match(/\?/g)?.length ?? 0) >= 2) score += 1;
  if (TASK_VERB.test(lower)) score += 1;

  if (GREETING.test(lower) && words.length <= 12 && !TASK_VERB.test(lower)) {
    return "low";
  }
  if (words.length <= 12 && text.endsWith("?") && !TASK_VERB.test(lower)) {
    return "low";
  }
  if (score <= 0) return "low";
  if (score <= 2) return "medium";
  return "high";
}
