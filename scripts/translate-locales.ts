/**
 * Generates the non-English locale files in client/src/i18n from en.ts using
 * an OpenAI-compatible chat endpoint (Pollinations by default - the same
 * gateway Nova itself uses; the anonymous tier needs no API key).
 *
 * Usage:
 *   pnpm i18n:translate                 translate every missing/stale key
 *   pnpm i18n:translate es fr           only the listed locales
 *   pnpm i18n:translate -- --force      re-translate everything from scratch
 *
 * Configuration (all optional):
 *   TRANSLATE_API_BASE_URL   OpenAI-compatible base URL (default: Pollinations)
 *   TRANSLATE_API_KEY        Bearer token (falls back to POLLINATIONS_API_KEY)
 *   TRANSLATE_MODEL          Model id (default: openai-fast)
 *   TRANSLATE_TOKEN_BUDGET   Output tokens a batch may cost (default: 1250)
 *   TRANSLATE_BATCH_SIZE     Ceiling on strings per completion (default: 120)
 *   TRANSLATE_CONCURRENCY    Requests in flight (default: 4 with a key, 1 without)
 *   TRANSLATE_PACE_MS        Window over which request starts are paced
 *
 * The anonymous Pollinations tier allows one completion every ~30 seconds per
 * IP *and* caps each reply at ~1 500 output tokens, so without a key the script
 * paces itself (a full run takes a while). Set a pollen key via
 * TRANSLATE_API_KEY/POLLINATIONS_API_KEY for full speed.
 *
 * Speed comes from packing each request as close to the output cap as it can
 * get - a truncated reply burns a whole paced request and has to be re-tried -
 * and from translating locales in parallel once a key makes that worthwhile.
 * Results are also cached per string under .cache/, so an interrupted run
 * resumes instead of re-paying for work it already finished.
 *
 * The script is incremental: a manifest (client/src/i18n/manifest.json) tracks
 * the hash of each English source string per locale, so re-runs only
 * translate keys that are new or whose English text changed. Locale files and
 * the manifest are committed - reviewers can regenerate to verify.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { en } from "../client/src/i18n/en";
import { DEFAULT_LANGUAGE, languages, type LanguageOption } from "../client/src/i18n/languages";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const i18nDir = path.join(root, "client", "src", "i18n");
const manifestPath = path.join(i18nDir, "manifest.json");
/** Not committed: locale files and the manifest are the reviewable artefacts. */
const cachePath = path.join(root, ".cache", "i18n-translations.json");

const API_BASE_URL = (process.env.TRANSLATE_API_BASE_URL ?? "https://text.pollinations.ai/openai").replace(/\/$/, "");
const API_KEY = (process.env.TRANSLATE_API_KEY ?? process.env.POLLINATIONS_API_KEY ?? "").trim();
const MODEL = process.env.TRANSLATE_MODEL ?? "openai-fast";

/**
 * Strings per completion, used only as a ceiling. The tier's budget is spent
 * per *request*, and a reply that overruns it comes back truncated - wasting a
 * whole paced request - so batches are packed by TOKEN_BUDGET first and by
 * string count second. Override the ceiling with TRANSLATE_BATCH_SIZE.
 */
const BATCH_SIZE = Math.max(1, Number(process.env.TRANSLATE_BATCH_SIZE ?? 120));
/**
 * Output tokens a batch may cost, kept under the anonymous tier's ~1 500 token
 * reply cap with room left for JSON quoting. Override with
 * TRANSLATE_TOKEN_BUDGET if replies still arrive truncated.
 */
const TOKEN_BUDGET = Math.max(200, Number(process.env.TRANSLATE_TOKEN_BUDGET ?? 1250));
/**
 * The cap is on the *reply*, so a batch is costed from the translated text
 * rather than the English source: fixed framing per entry plus a per-character
 * rate. Rates are measured against the anonymous tier with real en.ts batches
 * (Spanish ~15 and Japanese ~19.6 tokens per entry).
 */
const ENTRY_OVERHEAD_TOKENS = 6;
const CHAR_TOKEN_RATE: Record<string, number> = { es: 0.23, fr: 0.23, de: 0.24, pt: 0.23, zh: 0.30, ja: 0.35 };
const DEFAULT_CHAR_TOKEN_RATE = 0.26;
const MAX_ATTEMPTS = 6;
/** Window over which request starts are paced: 32s without a key, 1.5s with one. */
const PACE_MS = Math.max(0, Number(process.env.TRANSLATE_PACE_MS ?? (API_KEY ? 1500 : 32_000)));
/**
 * Requests allowed per PACE_MS window, and in flight at once. The anonymous
 * tier is capped per IP, so parallelism only pays off once a key is set.
 * Override with TRANSLATE_CONCURRENCY.
 */
const CONCURRENCY = Math.max(1, Number(process.env.TRANSLATE_CONCURRENCY ?? (API_KEY ? 4 : 1)));

/** Brand and product names that must survive translation untouched. */
const PROPER_NOUNS =
  "Nova, GitHub, Gmail, Vercel, Composio, Telegram, OpenAI, OpenRouter, Groq, Together, DeepSeek, Anthropic, vLLM, Ollama, Neon, E2B, BYOK, API, VM, Ctrl, Cmd, Enter, Bearer, RESET, CLEAR, DELETE";

type Manifest = Record<string, Record<string, string>>;

function hash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function readManifest(): Manifest {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  } catch {
    return {};
  }
}

/**
 * Translations already fetched, keyed by "<locale>:<source hash>". Writing it
 * after every batch means an interrupted or rate-limited run resumes instead
 * of re-paying for work it had already finished.
 */
function readCache(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, string>): void {
  try {
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache) + "\n");
  } catch (error) {
    console.warn(`  could not write the cache: ${error instanceof Error ? error.message : error}`);
  }
}

/** Drops cached strings that no longer appear in en.ts. */
function pruneCache(cache: Record<string, string>, sourceEntries: Array<[string, string]>): Record<string, string> {
  const live = new Set(sourceEntries.map(([, text]) => hash(text)));
  const kept: Record<string, string> = {};
  for (const [id, value] of Object.entries(cache)) {
    const separator = id.indexOf(":");
    if (separator > 0 && live.has(id.slice(separator + 1))) kept[id] = value;
  }
  return kept;
}

function cacheKey(locale: string, text: string): string {
  return `${locale}:${hash(text)}`;
}

/** Reads an existing generated locale file into a key/value map (best effort). */
function readLocaleFile(id: string): Record<string, string> {
  try {
    const source = readFileSync(path.join(i18nDir, `${id}.ts`), "utf8");
    const entries: Record<string, string> = {};
    const pattern = /^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm;
    for (const match of source.matchAll(pattern)) {
      entries[match[1]] = JSON.parse(`"${match[2]}"`) as string;
    }
    return entries;
  } catch {
    return {};
  }
}

/** Extracts the set of {{token}} names so placeholders can be verified. */
function tokens(text: string): string[] {
  return [...text.matchAll(/\{\{\w+\}\}/g)].map(match => match[0]).sort();
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  error?: { message?: string };
}

/**
 * Paces request *starts* so at most CONCURRENCY fire per PACE_MS window, no
 * matter how many workers are running. Keeps the anonymous tier's per-IP limit
 * in check while letting keyed runs overlap requests.
 */
class RateLimiter {
  private starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();
  private pausedUntil = 0;

  /**
   * One shared back-off: when the tier says "retry after Ns" that applies to
   * every request, so all workers wait on the same clock instead of each
   * burning an attempt and a pacing window of their own.
   */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  async acquire(): Promise<void> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => (release = resolve));
    await previous;
    for (;;) {
      const now = Date.now();
      if (now < this.pausedUntil) {
        await sleep(this.pausedUntil - now);
        continue;
      }
      this.starts = this.starts.filter(at => now - at < PACE_MS);
      if (this.starts.length < CONCURRENCY) {
        this.starts.push(now);
        break;
      }
      await sleep(Math.max(1, PACE_MS - (now - this.starts[0])));
    }
    release();
  }
}

/** Caps how many requests are in flight at once. */
class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(size: number) {
    this.available = size;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>(resolve => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.available++;
  }
}

const limiter = new RateLimiter();
const slots = new Semaphore(CONCURRENCY);

/** Some OpenAI-compatible endpoints reject response_format; drop it if so. */
let jsonMode = true;

/** Calls the chat endpoint with pacing, retries and backoff. */
async function chat(system: string, user: string): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await slots.acquire();
    try {
      await limiter.acquire();
      const response = await fetch(`${API_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.1,
          // The free-tier model is a reasoning model; without a low effort it
          // spends the whole completion budget thinking and returns "".
          reasoning_effort: "low",
          // JSON mode keeps the reply parseable and measurably cheaper in
          // tokens, which is what limits how many strings fit per request.
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        if (response.status === 400 && jsonMode && /response_format|json_object/i.test(body)) {
          jsonMode = false;
          console.warn("  endpoint rejected JSON mode; continuing without it");
          continue;
        }
        // The free tier says "Retry after Ns" - honour it instead of guessing.
        const retryAfter = /Retry after (\d+)s/i.exec(body);
        if (response.status === 402 || response.status === 429) {
          const pause = retryAfter ? (Number(retryAfter[1]) + 5) * 1000 : PACE_MS;
          limiter.pause(pause);
          console.warn(`  rate limited; every request paused for ${Math.round(pause / 1000)}s`);
        }
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
      }
      const data = (await response.json()) as ChatResponse;
      if (data.error) throw new Error(data.error.message ?? "unknown API error");
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("empty completion");
      if (data.choices?.[0]?.finish_reason === "length") {
        console.warn("  reply hit the output cap; lower TRANSLATE_TOKEN_BUDGET to avoid splitting");
      }
      return content;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`  attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError.message}`);
    } finally {
      slots.release();
    }
  }
  throw lastError ?? new Error("translation request failed");
}

const SYSTEM_PROMPT = (targetName: string) => `You are a professional translator localizing English UI strings for the Nova app into ${targetName}.
Rules:
- The input is a JSON object whose keys are numeric ids. Reply with ONLY a JSON object that uses those same numeric ids as keys, each mapped to its translation. No markdown, no commentary, no extra keys.
- Preserve every {{placeholder}} token exactly as written (e.g. {{count}} stays {{count}}).
- Do not translate these proper nouns and literals: ${PROPER_NOUNS}.
- Keep the concise tone of a settings page; use the polite standard form of address for the language.
- Keep separators like "·" and "-" as in the source; keep punctuation style equivalent.`;

/** Parses the model's JSON reply, tolerating a stray code fence. */
function parseJsonObject(raw: string): Record<string, string> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in reply");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, string>;
}

/** Accepts a candidate translation only when its placeholders match the source. */
function isValid(source: string, candidate: unknown): candidate is string {
  return (
    typeof candidate === "string" &&
    candidate.trim().length > 0 &&
    tokens(candidate).join(" ") === tokens(source).join(" ")
  );
}

/**
 * Packs strings into batches that stay under the reply's output-token cap.
 * Overrunning the cap yields a truncated, unparseable reply, so the budget -
 * not the string count - decides how many fit. Cost is estimated from the
 * source length as a proxy for the translated length.
 */
function packBatches(entries: Array<[string, string]>, targetId: string): Array<Array<[string, string]>> {
  const rate = CHAR_TOKEN_RATE[targetId] ?? DEFAULT_CHAR_TOKEN_RATE;
  const costOf = (source: string) => ENTRY_OVERHEAD_TOKENS + source.length * rate;
  const batches: Array<Array<[string, string]>> = [];
  let current: Array<[string, string]> = [];
  let budget = 0;
  for (const entry of entries) {
    const cost = costOf(entry[1]);
    if (current.length > 0 && (budget + cost > TOKEN_BUDGET || current.length >= BATCH_SIZE)) {
      batches.push(current);
      current = [];
      budget = 0;
    }
    current.push(entry);
    budget += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Numbered payload: repeating `settings.connections.title` style keys costs
 * roughly a fifth of every reply, so batches are sent as id -> text and the
 * reply is mapped back by id. Measured: 64 strings cost 957 tokens numbered vs
 * 1212 with the real keys.
 */
function numbered(batch: Array<[string, string]>): Record<string, string> {
  const payload: Record<string, string> = {};
  batch.forEach(([, source], index) => (payload[String(index + 1)] = source));
  return payload;
}

/** Re-attaches the real keys to a numbered reply. */
function byKey(batch: Array<[string, string]>, parsed: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  batch.forEach(([key], index) => (out[key] = parsed[String(index + 1)]));
  return out;
}

/**
 * Translates one batch, bisecting on total failure (a bad completion wastes a
 * request either way, but smaller batches usually get through). Returns the
 * valid translations; the caller collects keys that never made it.
 */
async function translateChunk(
  targetName: string,
  batch: Array<[string, string]>
): Promise<{ done: Record<string, string>; failed: Array<[string, string]> }> {
  try {
    const parsed = byKey(batch, parseJsonObject(await chat(SYSTEM_PROMPT(targetName), JSON.stringify(numbered(batch)))));
    const done: Record<string, string> = {};
    const failed: Array<[string, string]> = [];
    for (const [key, source] of batch) {
      const candidate = parsed[key];
      if (isValid(source, candidate)) done[key] = candidate.trim();
      else failed.push([key, source]);
    }
    return { done, failed };
  } catch (error) {
    if (batch.length <= 4) throw error;
    const middle = Math.ceil(batch.length / 2);
    console.warn(`  batch failed (${error instanceof Error ? error.message : error}); splitting ${batch.length} keys and retrying`);
    const first = await translateChunk(targetName, batch.slice(0, middle));
    const second = await translateChunk(targetName, batch.slice(middle));
    return {
      done: { ...first.done, ...second.done },
      failed: [...first.failed, ...second.failed],
    };
  }
}

/**
 * Retries keys whose translation failed validation, in one batch (the free tier
 * charges a request per call, so retries are batched too); anything still
 * invalid falls back to the English source with a warning and is reported back
 * so the manifest stays stale for it, letting a later run try again.
 */
async function retryFailed(
  targetId: string,
  targetName: string,
  failed: Array<[string, string]>,
  output: Record<string, string>
): Promise<Set<string>> {
  const fellBack = new Set<string>();
  if (failed.length === 0) return fellBack;
  console.log(`  retrying ${failed.length} invalid key(s) in one final batch`);
  try {
    const parsed = byKey(failed, parseJsonObject(await chat(SYSTEM_PROMPT(targetName), JSON.stringify(numbered(failed)))));
    const stillFailed: Array<[string, string]> = [];
    for (const [key, source] of failed) {
      const candidate = parsed[key];
      if (isValid(source, candidate)) output[key] = candidate.trim();
      else stillFailed.push([key, source]);
    }
    failed = stillFailed;
  } catch {
    /* keep the English fallback below */
  }
  for (const [key, source] of failed) {
    console.warn(`  [${targetId}] keeping English for "${key}" (placeholder mismatch or missing)`);
    output[key] = source;
    fellBack.add(key);
  }
  return fellBack;
}

/** Runs tasks with at most `size` of them in flight. */
async function runPool(tasks: Array<() => Promise<void>>, size: number): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (next < tasks.length) {
      const current = next++;
      await tasks[current]();
    }
  });
  await Promise.all(workers);
}

function escapeTs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function writeLocaleFile(id: string, name: string, entries: Record<string, string>) {
  const lines = Object.keys(en).map(key => `  "${key}": "${escapeTs(entries[key] ?? (en as Record<string, string>)[key])}",`);
  const content = `import type { Translations } from "./en";

/**
 * ${name} (${id}) - MACHINE-GENERATED by scripts/translate-locales.ts.
 * Do not edit by hand: change en.ts and re-run \`pnpm i18n:translate\`.
 */
export const ${id}: Translations = {
${lines.join("\n")}
};
`;
  writeFileSync(path.join(i18nDir, `${id}.ts`), content);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const requested = args.filter(arg => arg !== "--force" && arg !== "--");
  const targets = languages.filter(
    language =>
      language.id !== DEFAULT_LANGUAGE &&
      (requested.length === 0 || requested.includes(language.id))
  );
  if (targets.length === 0) {
    console.error("No matching target locales. Known: " + languages.map(l => l.id).join(", "));
    process.exit(1);
  }

  const manifest = readManifest();
  const cache = force ? {} : readCache();
  const sourceEntries = Object.entries(en) as Array<[string, string]>;

  interface LocaleJob {
    target: LanguageOption;
    existing: Record<string, string>;
    /** Strings still needing a request (cached ones are already in `done`). */
    pending: Array<[string, string]>;
    /** Strings this run knows the answer to, cached or freshly translated. */
    done: Record<string, string>;
    /** Whole batches that never came back, also filled by failed keys. */
    failed: Array<[string, string]>;
    total: number;
  }

  const jobs: LocaleJob[] = [];
  for (const target of targets) {
    const existing = force ? {} : readLocaleFile(target.id);
    const previous = force ? {} : (manifest[target.id] ?? {});
    const stale = sourceEntries.filter(([key, text]) => !existing[key] || previous[key] !== hash(text));
    if (stale.length === 0) {
      console.log(`${target.id}: up to date`);
      continue;
    }
    const done: Record<string, string> = {};
    const pending: Array<[string, string]> = [];
    for (const [key, text] of stale) {
      const cached = cache[cacheKey(target.id, text)];
      if (cached && isValid(text, cached)) done[key] = cached;
      else pending.push([key, text]);
    }
    const reused = Object.keys(done).length;
    if (pending.length === 0) {
      console.log(`${target.id}: ${reused} string(s) served from the cache`);
    } else {
      console.log(
        `${target.id}: translating ${pending.length} of ${sourceEntries.length} strings` +
          (reused > 0 ? ` (${reused} cached)` : "") +
          ` (${MODEL})`
      );
    }
    jobs.push({ target, existing, pending, done, failed: [], total: stale.length });
  }

  const tasks: Array<() => Promise<void>> = [];
  for (const job of jobs) {
    for (const batch of packBatches(job.pending, job.target.id)) {
      tasks.push(async () => {
        try {
          const { done, failed } = await translateChunk(job.target.englishName, batch);
          Object.assign(job.done, done);
          job.failed.push(...failed);
          for (const [key, text] of batch) {
            const value = done[key];
            if (value) cache[cacheKey(job.target.id, text)] = value;
          }
          writeCache(cache);
        } catch (error) {
          console.warn(`  [${job.target.id}] batch of ${batch.length} failed outright: ${error instanceof Error ? error.message : error}`);
          job.failed.push(...batch);
        }
        console.log(`  [${job.target.id}] ${Object.keys(job.done).length}/${job.total}`);
      });
    }
  }
  await runPool(tasks, CONCURRENCY);

  for (const job of jobs) {
    const fellBack = await retryFailed(job.target.id, job.target.englishName, job.failed, job.done);
    const merged: Record<string, string> = {};
    const nextManifest: Record<string, string> = {};
    for (const [key, text] of sourceEntries) {
      merged[key] = job.done[key] ?? job.existing[key] ?? text;
      // A string that fell back to English stays unrecorded so the next run
      // retries it rather than freezing the English text into the locale.
      if (fellBack.has(key)) continue;
      nextManifest[key] = hash(text);
      const value = job.done[key];
      if (value) cache[cacheKey(job.target.id, text)] = value;
    }
    writeLocaleFile(job.target.id, job.target.englishName, merged);
    manifest[job.target.id] = nextManifest;
    console.log(`${job.target.id}: wrote client/src/i18n/${job.target.id}.ts`);
  }

  if (jobs.length > 0) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    writeCache(pruneCache(cache, sourceEntries));
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
