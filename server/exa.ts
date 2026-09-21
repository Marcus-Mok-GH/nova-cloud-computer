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
  /** The research query - the task the deep research model works on. */
  query: string;
  /** The research model / difficulty. Defaults to `deep`. */
  type?: ExaDeepSearchType;
  /** Optional system prompt steering the research behavior and report style. */
  systemPrompt?: string;
  /** Hard client-side cap on the request (default 270s, Vercel-bound). */
  timeoutMs?: number;
  /**
   * Live progress notes as the deep research streams: one note per sub-search
   * results event ("Searched: ... found N sources"), plus a note when report
   * synthesis starts. Lets the UI stream the researcher's actual process.
   */
  onProgress?: (note: string) => void;
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

type ExaStreamEvent =
  | { type: "text-delta"; delta?: string }
  | { type: "grounding"; grounding?: ExaGrounding[]; citations?: ExaCitation[] }
  | { type: "results"; results?: { url?: string; title?: string }[] }
  | { type: "stream-reset"; streamReset?: boolean }
  | Record<string, unknown>;

/**
 * Runs one Exa deep research request to completion and returns its cited
 * report. The request streams (SSE): sub-search `results` events, field-level
 * `grounding` events, and the report's `text-delta` events arrive as the
 * researcher works, and each sub-search also surfaces as an onProgress note
 * so the caller can stream the process live. Resolves with the synthesized
 * report plus the deduplicated citations; rejects when the request fails or
 * returns no report.
 */
export async function runExaDeepResearch(options: ExaDeepResearchOptions): Promise<ExaDeepResearchResult> {
  if (!isExaConfigured()) {
    throw new Error("Exa deep research is not configured - set EXA_API_KEY to enable web research.");
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
          "The complete research report: an executive summary, findings organized under clear headings, inline [1]-style citations, and a final Sources list mapping every number to Title - URL.",
      },
      // The synthesized report only exists because outputSchema is set, and
      // streaming only kicks in with an outputSchema: this is the verified
      // gate from Exa's /search reference.
      stream: true,
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 270_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const hint = detail.slice(0, 300).replace(/\s+/g, " ").trim();
    throw new Error(`Exa deep research responded with status ${response.status}${hint ? `: ${hint}` : "."}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  // Defensive: a gateway that ignores stream:true answers with plain JSON -
  // parse it the buffered way instead of freezing on a body without SSE.
  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as
      | { results?: { url?: string; title?: string }[]; output?: { content?: unknown; grounding?: ExaGrounding[] } }
      | null;
    const report = extractReport(payload?.output?.content);
    if (!report) throw new Error("Exa deep research finished without a report.");
    const sources = collectSources(payload?.output);
    return { report, sources: sources.length ? sources : fallbackSources(payload?.results) };
  }
  if (!response.body) {
    throw new Error("Exa deep research returned an empty response body.");
  }

  let report = "";
  let reportStarted = false;
  let sources: ExaCitation[] = [];
  let foundResults: { url?: string; title?: string }[] = [];
  let hadStreamReset = false;
  const handleEvent = (event: ExaStreamEvent) => {
    if (!event || typeof event !== "object") return;
    const record = event as Record<string, unknown>;
    switch (record.type) {
      case "results": {
        const results = record.results as { url?: string; title?: string }[] | undefined ?? [];
        foundResults = foundResults.concat(results);
        const sample = results.find(result => result?.title?.trim())?.title?.trim();
        options.onProgress?.(
          `Searched the live web - found ${results.length} new source${results.length === 1 ? "" : "s"}${sample ? ` (e.g. "${sample.slice(0, 80)}")` : ""}`
        );
        return;
      }
      case "grounding": {
        const grounding = record.grounding as ExaGrounding[] | undefined;
        if (grounding?.length) {
          const merged = collectSources({ grounding });
          if (merged.length) {
            // Grounding events may arrive per output field: accumulate, never
            // replace, so citations from earlier events survive.
            const seen = new Set(sources.map(source => source.url));
            sources = [...sources, ...merged.filter(source => !seen.has(source.url))];
          }
        }
        return;
      }
      case "text-delta": {
        let delta = typeof record.delta === "string" ? record.delta : "";
        if (!delta) {
          // Exa also emits OpenAI-compatible chat completion chunks; read the
          // partial text from choices[0].delta.content when delta is absent.
          const choices = record.choices as { delta?: { content?: unknown } }[] | undefined;
          const content = choices?.[0]?.delta?.content;
          if (typeof content === "string") delta = content;
        }
        report += delta;
        if (!reportStarted && report.trim()) {
          reportStarted = true;
          const total = foundResults.length;
          options.onProgress?.(
            total > 0
              ? `Evidence gathered from ${total} sources - writing the report...`
              : "Writing the report..."
          );
        }
        return;
      }
      case "stream-reset": {
        // The researcher restarted its synthesis: drop the partial report and
        // let the deltas rebuild it.
        report = "";
        reportStarted = false;
        hadStreamReset = true;
        return;
      }
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // A misbehaving stream that never sends a newline would otherwise grow the
  // retained line until the 270s timeout; cap it and abandon the stream.
  const maxSseLineLength = 1_048_576;
  const emitSseLines = (chunk: string, onLine: (line: string) => void) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      onLine(buffer.slice(0, newlineIndex).replace(/\r$/, ""));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
    if (buffer.length > maxSseLineLength) {
      throw new Error("Exa deep research stream exceeded the maximum SSE line length.");
    }
  };
  try {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    emitSseLines(decoder.decode(value, { stream: true }), line => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      try {
        handleEvent(JSON.parse(payload) as ExaStreamEvent);
      } catch {
        // A malformed fragment never kills the research: skip the line.
      }
    });
  }
  } finally {
    // Release the connection when the stream ends early (error or bound hit).
    reader.cancel().catch(() => {});
  }
  // Flush any trailing line the stream ended without a newline on.
  if (buffer.startsWith("data:")) {
    const payload = buffer.slice(5).trim();
    if (payload && payload !== "[DONE]") {
      try {
        handleEvent(JSON.parse(payload) as ExaStreamEvent);
      } catch {
        // Same tolerance as mid-stream fragments.
      }
    }
  }

  const finished = report.trim();
  if (!finished) {
    throw new Error(
      `Exa deep research finished without a report${hadStreamReset ? " (synthesis restarted, but never completed)" : ""}.`
    );
  }
  return { report: finished, sources: sources.length ? sources : fallbackSources(foundResults) };
}
