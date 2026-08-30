// Zero-config web search for the workspace agent.
//
// Combines two keyless, read-only sources so Nova can answer questions about
// the outside world without any API credential:
//   - DuckDuckGo Instant Answer API (encyclopedia-style abstracts + links)
//   - Wikipedia full-text search (ranked titles + snippets)
//
// Both return best-effort JSON; a source that fails is skipped rather than
// failing the search.

const DDG_API = "https://api.duckduckgo.com/";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESULT_LENGTH = 4_000;
const MAX_RECORDS = 6;

type SearchRecord = {
  title: string;
  url: string;
  snippet?: string;
};

const fetchJson = async (url: URL, headers: Record<string, string>): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`Web search source returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const stripHtml = (value: string) =>
  value
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

async function searchWikipedia(query: string): Promise<SearchRecord[]> {
  const url = new URL(WIKI_API);
  url.search = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(MAX_RECORDS),
    srprop: "snippet",
    format: "json",
    origin: "*",
  }).toString();
  const data = (await fetchJson(url, { "user-agent": "NovaWebSearch/1.0 (workspace agent)" })) as {
    query?: { search?: Array<{ title: string; snippet?: string }> };
  };
  return (data.query?.search ?? []).map(hit => ({
    title: hit.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
    snippet: hit.snippet ? stripHtml(hit.snippet) : undefined,
  }));
}

async function searchDuckDuckGo(query: string): Promise<{ summary: string; records: SearchRecord[] }> {
  const url = new URL(DDG_API);
  url.search = new URLSearchParams({
    q: query,
    format: "json",
    no_html: "1",
    skip_disambig: "1",
  }).toString();
  const data = (await fetchJson(url, { "user-agent": "NovaWebSearch/1.0 (workspace agent)" })) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<Record<string, unknown> & { Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
  };
  const summary = stripHtml(data.AbstractText ?? "");
  const records: SearchRecord[] = [];
  const abstractUrl = typeof data.AbstractURL === "string" && data.AbstractURL ? data.AbstractURL : undefined;
  if (abstractUrl && summary) {
    records.push({ title: data.Heading || query, url: abstractUrl, snippet: summary.slice(0, 200) });
  }
  for (const topic of data.RelatedTopics ?? []) {
    if (topic.Text && topic.FirstURL) {
      records.push({ title: stripHtml(topic.Text), url: topic.FirstURL });
    }
  }
  return { summary, records: records.slice(0, MAX_RECORDS) };
}

export async function webSearch(query: string): Promise<string> {
  const trimmed = query.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!trimmed) return `Web search requires a query.`;
  const [ddg, wiki] = await Promise.allSettled([searchDuckDuckGo(trimmed), searchWikipedia(trimmed)]);
  const ddgResult = ddg.status === "fulfilled" ? ddg.value : undefined;
  const wikiRecords = wiki.status === "fulfilled" ? wiki.value : [];

  const lines: string[] = [`Web search results for "${trimmed}":`];
  if (ddgResult?.summary) {
    lines.push("", "Summary:", ddgResult.summary);
  }
  const records = [...(ddgResult?.records ?? []), ...wikiRecords];
  if (records.length > 0) {
    lines.push("", "Sources:");
    for (const record of records.slice(0, MAX_RECORDS)) {
      lines.push(`• ${record.title}${record.snippet ? ` — ${record.snippet}` : ""}`, `  ${record.url}`);
    }
  }
  if (lines.length === 1) return `No results found for "${trimmed}".`;
  return lines.join("\n").slice(0, MAX_RESULT_LENGTH);
}