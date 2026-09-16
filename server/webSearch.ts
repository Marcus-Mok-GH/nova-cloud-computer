/** Live web search for the Nova workspace agent.
 *
 * Provider chain: Tavily (best, LLM-oriented results) → Brave Search → a
 * keyless DuckDuckGo HTML scrape as a last resort. API keys come from env
 * (TAVILY_API_KEY, BRAVE_SEARCH_API_KEY); the DuckDuckGo fallback needs no
 * key but is rate-limited on datacenter IPs, so configuring a key is
 * recommended in production. All HTML parsing lives in pure functions so it
 * can be unit-tested offline. */

import { ENV } from "./_core/env";

export type WebSearchResult = { title: string; url: string; snippet: string };

const RESULT_LINK = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const RESULT_SNIPPET = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripMarkup(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** DuckDuckGo wraps result links in its own redirect (uddg=<encoded url>) —
 * recover the real destination URL. */
function resolveResultUrl(href: string): string {
  try {
    const url = new URL(href.startsWith("//") ? `https:${href}` : href, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target || url.toString();
  } catch {
    return href;
  }
}

/** Parses DuckDuckGo HTML search results into clean titles, URLs and snippets. */
export function parseDuckDuckGoResults(html: string, limit = 5): WebSearchResult[] {
  const links: Array<{ href: string; title: string }> = [];
  let match: RegExpExecArray | null;
  RESULT_LINK.lastIndex = 0;
  while ((match = RESULT_LINK.exec(html)) !== null) links.push({ href: match[1], title: stripMarkup(match[2]) });
  const snippets: string[] = [];
  RESULT_SNIPPET.lastIndex = 0;
  while ((match = RESULT_SNIPPET.exec(html)) !== null) snippets.push(stripMarkup(match[1]));
  return links
    .slice(0, limit)
    .map((link, index) => ({ title: link.title, url: resolveResultUrl(link.href), snippet: snippets[index] ?? "" }))
    .filter(result => result.title && result.url);
}

/** Normalizes a raw provider result row. */
function toResult(row: { title?: string; url?: string; content?: string; description?: string; snippet?: string }): WebSearchResult {
  return {
    title: (row.title ?? "").toString().trim(),
    url: (row.url ?? "").toString().trim(),
    snippet: ((row.content ?? row.description ?? row.snippet ?? "").toString() || "").replace(/\s+/g, " ").trim(),
  };
}

export async function searchWithTavily(query: string, limit: number): Promise<WebSearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ENV.tavilyApiKey}` },
    body: JSON.stringify({ query, max_results: limit, search_depth: "basic" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Tavily responded with status ${response.status}.`);
  const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).map(row => toResult(row as Parameters<typeof toResult>[0])).filter(result => result.title && result.url);
}

export async function searchWithBrave(query: string, limit: number): Promise<WebSearchResult[]> {
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
    headers: { accept: "application/json", "x-subscription-token": ENV.braveSearchApiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Brave responded with status ${response.status}.`);
  const data = (await response.json()) as { web?: { results?: Array<Record<string, unknown>> } };
  return (data.web?.results ?? []).slice(0, limit).map(row => toResult(row as Parameters<typeof toResult>[0])).filter(result => result.title && result.url);
}

async function searchWithDuckDuckGo(query: string, limit: number): Promise<WebSearchResult[]> {
  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 (compatible; NovaWorkspaceAgent/1.0)",
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("DuckDuckGo refused the request — configure TAVILY_API_KEY or BRAVE_SEARCH_API_KEY for reliable web search.");
  const results = parseDuckDuckGoResults(await response.text(), limit);
  if (!results.length) throw new Error("DuckDuckGo returned no results — configure TAVILY_API_KEY or BRAVE_SEARCH_API_KEY for reliable web search.");
  return results;
}

/** Searches the live web for a query and returns up to `limit` results. */
export async function searchWeb(query: string, limit = 5): Promise<WebSearchResult[]> {
  if (ENV.tavilyApiKey) return searchWithTavily(query, limit);
  if (ENV.braveSearchApiKey) return searchWithBrave(query, limit);
  return searchWithDuckDuckGo(query, limit);
}
