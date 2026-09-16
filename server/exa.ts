/** Exa Deep Search client for Nova's deep research.
 * Docs: https://exa.ai/docs/search/deep-search
 *
 * POST https://api.exa.ai/search with `type` set to one of Exa's deep research
 * models runs an iterative research loop before the response: it can issue
 * multiple searches, compare the evidence with the request, re-search what is
 * still missing, and then synthesize one grounded result. Providing an
 * `outputSchema` of `{ type: "text" }` makes the response include the
 * synthesized report in `output.content` plus field-level citations in
 * `output.grounding`. */

import { ENV } from "./_core/env";

export type ExaCitation = { url: string; title: string };

export type ExaGrounding = {
  field: string;
  citations: ExaCitation[];
  confidence?: string | null;
};

/** Exa's deep research models, shallowest to deepest. */
export type ExaDeepSearchType = "deep-lite" | "deep" | "deep-reasoning";

export const EXA_DEEP_SEARCH_TYPES: readonly ExaDeepSearchType[] = [
  "deep-lite",
  "deep",
  "deep-reasoning",
];

export type ExaDeepResearchResult = {
  report: string;
  sources: ExaCitation[];
};

export type ExaDeepResearchOptions = {
  /** The research query — the task the deep research model works on. */
  query: string;
  /** The research model / difficulty. Defaults to `deep`. */
  type?: ExaDeepSearchType;
  /** Optional system prompt steering the research behavior and report style. */
  systemPrompt?: string;
  /** Hard client-side cap on the request (default 270s, Vercel-bound). */
  timeoutMs?: number;
};

export function isExaConfigured() {
  return ENV.exaApiKey.trim().length > 0;
}

/** Coerces an arbitrary value to a valid deep search type, defaulting to `deep`. */
export function normalizeExaDeepSearchType(value: unknown): ExaDeepSearchType {
  return EXA_DEEP_SEARCH_TYPES.includes(value as ExaDeepSearchType)
    ? (value as ExaDeepSearchType)
    : "deep";
}

/** The final report text, tolerating either a bare string or a wrapped object. */
function extractReport(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (content && typeof content === "object") {
    const wrapped = content as { text?: unknown; report?: unknown };
    const text = wrapped.text ?? wrapped.report;
    if (typeof text === "string") return text.trim();
  }
  return "";
}

/** Collects the unique citations from the run's grounding, preserving order. */
function collectSources(output: { grounding?: ExaGrounding[] } | undefined): ExaCitation[] {
  const sources: ExaCitation[] = [];
  const seen = new Set<string>();
  for (const entry of output?.grounding ?? []) {
    for (const citation of entry.citations ?? []) {
      const url = citation.url?.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ url, title: citation.title?.trim() ?? "" });
    }
  }
  return sources;
}

/** Falls back to the selected pages when the run emitted no grounding. */
function fallbackSources(results: { url?: string; title?: string }[] | undefined): ExaCitation[] {
  return (results ?? [])
    .map((result) => ({ url: result.url?.trim() ?? "", title: result.title?.trim() ?? "" }))
    .filter((source) => source.url.length > 0);
}

/**
 * Runs one Exa deep research request to completion and returns its cited
 * report. Resolves with the synthesized text (`output.content`) plus the
 * deduplicated citations; rejects when the request fails or returns no report.
 */
export async function runExaDeepResearch(options: ExaDeepResearchOptions): Promise<ExaDeepResearchResult> {
  if (!isExaConfigured()) {
    throw new Error("Exa deep research is not configured — set EXA_API_KEY to enable web research.");
  }
  const type = normalizeExaDeepSearchType(options.type);
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.exaApiKey}`,
    },
    body: JSON.stringify({
      query: options.query,
      type,
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      outputSchema: {
        type: "text",
        description:
          "The complete research report: an executive summary, findings organized under clear headings, inline [1]-style citations, and a final Sources list mapping every number to Title — URL.",
      },
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 270_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const hint = detail.slice(0, 300).replace(/\s+/g, " ").trim();
    throw new Error(`Exa deep research responded with status ${response.status}${hint ? `: ${hint}` : "."}`);
  }

  const payload = (await response.json().catch(() => null)) as {
    results?: { url?: string; title?: string }[];
    output?: { content?: unknown; grounding?: ExaGrounding[] };
  } | null;

  const report = extractReport(payload?.output?.content);
  if (!report) {
    throw new Error("Exa deep research finished without a report.");
  }
  const sources = collectSources(payload?.output);
  return { report, sources: sources.length ? sources : fallbackSources(payload?.results) };
}
