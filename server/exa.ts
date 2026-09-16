/** Exa AI search client for the Nova researcher sub-agent.
 * Docs: https://docs.exa.ai — POST /search with an API key. */

import { ENV } from "./_core/env";

export type ExaSearchResult = {
  title: string;
  url: string;
  publishedDate: string;
  text: string;
};

export function isExaConfigured() {
  return ENV.exaApiKey.trim().length > 0;
}

/** Normalizes one raw Exa result row. */
export function toExaResult(row: Record<string, unknown>): ExaSearchResult {
  return {
    title: (row.title ?? "").toString().trim(),
    url: (row.url ?? "").toString().trim(),
    publishedDate: (row.publishedDate ?? "").toString().trim(),
    text: (row.text ?? "").toString().trim(),
  };
}

/** Searches the live web with Exa, returning results with page text excerpts. */
export async function searchExa(query: string, numResults = 5): Promise<ExaSearchResult[]> {
  if (!isExaConfigured()) {
    throw new Error("Exa web search is not configured — set EXA_API_KEY to enable web research.");
  }
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ENV.exaApiKey,
    },
    body: JSON.stringify({
      query,
      numResults: Math.min(Math.max(numResults, 1), 8),
      type: "auto",
      text: { maxCharacters: 1500 },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Exa responded with status ${response.status}.`);
  const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).map(toExaResult).filter(result => result.title && result.url);
}
