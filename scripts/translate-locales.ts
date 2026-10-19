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
 *   TRANSLATE_API_BASE_URL  OpenAI-compatible base URL (default: Pollinations)
 *   TRANSLATE_API_KEY       Bearer token (falls back to POLLINATIONS_API_KEY)
 *   TRANSLATE_MODEL         Model id (default: openai-fast)
 *
 * The anonymous Pollinations tier allows one completion every ~30 seconds per
 * IP, so without a key the script paces itself (a full run takes a while).
 * Set a pollen key via TRANSLATE_API_KEY/POLLINATIONS_API_KEY for full speed.
 *
 * The script is incremental: a manifest (client/src/i18n/manifest.json) tracks
 * the hash of each English source string per locale, so re-runs only
 * translate keys that are new or whose English text changed. Locale files and
 * the manifest are committed - reviewers can regenerate to verify.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { en } from "../client/src/i18n/en";
import { DEFAULT_LANGUAGE, languages } from "../client/src/i18n/languages";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const i18nDir = path.join(root, "client", "src", "i18n");
const manifestPath = path.join(i18nDir, "manifest.json");

const API_BASE_URL = (process.env.TRANSLATE_API_BASE_URL ?? "https://text.pollinations.ai/openai").replace(/\/$/, "");
const API_KEY = (process.env.TRANSLATE_API_KEY ?? process.env.POLLINATIONS_API_KEY ?? "").trim();
const MODEL = process.env.TRANSLATE_MODEL ?? "openai-fast";

/** Strings per completion; large batches conserve the tight free-tier budget. */
const BATCH_SIZE = 60;
const MAX_ATTEMPTS = 6;
/** Minimum gap between requests: 32s without a key, 1.5s with one. */
const PACE_MS = API_KEY ? 1500 : 32_000;

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
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

let lastRequestAt = 0;

/** Calls the chat endpoint with pacing, retries and backoff. */
async function chat(system: string, user: string): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wait = Math.max(0, PACE_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    try {
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
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        // The free tier says "Retry after Ns" - honour it instead of guessing.
        const retryAfter = /Retry after (\d+)s/i.exec(body);
        if (response.status === 402 || response.status === 429) {
          const pause = retryAfter ? (Number(retryAfter[1]) + 5) * 1000 : PACE_MS;
          console.warn(`  rate limited; waiting ${Math.round(pause / 1000)}s`);
          await sleep(pause);
          lastRequestAt = Date.now();
        }
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
      }
      const data = (await response.json()) as ChatResponse;
      if (data.error) throw new Error(data.error.message ?? "unknown API error");
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("empty completion");
      return content;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`  attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError.message}`);
    }
  }
  throw lastError ?? new Error("translation request failed");
}

const SYSTEM_PROMPT = (targetName: string) => `You are a professional translator localizing English UI strings for the Nova app into ${targetName}.
Rules:
- Reply with ONLY a JSON object mapping each input key to its translation. No markdown, no commentary.
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
 * Translates one batch, bisecting on total failure (a bad completion wastes a
 * request either way, but smaller batches usually get through). Returns the
 * valid translations; the caller collects keys that never made it.
 */
async function translateChunk(
  targetName: string,
  batch: Array<[string, string]>
): Promise<{ done: Record<string, string>; failed: Array<[string, string]> }> {
  try {
    const parsed = parseJsonObject(await chat(SYSTEM_PROMPT(targetName), JSON.stringify(Object.fromEntries(batch))));
    const done: Record<string, string> = {};
    const failed: Array<[string, string]> = [];
    for (const [key, source] of batch) {
      if (isValid(source, parsed[key])) done[key] = parsed[key].trim();
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
 * Translates the pending keys for one locale in batches. Keys that come back
 * invalid are gathered and retried together once at the end (the free tier
 * charges one request per call, so retries are batched too); anything still
 * invalid falls back to the English source with a warning.
 */
async function translateLocale(
  targetId: string,
  targetName: string,
  pending: Array<[string, string]>
): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  let failed: Array<[string, string]> = [];
  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const batch = pending.slice(offset, offset + BATCH_SIZE);
    try {
      const { done, failed: batchFailed } = await translateChunk(targetName, batch);
      Object.assign(output, done);
      failed.push(...batchFailed);
    } catch (error) {
      console.warn(`  batch of ${batch.length} failed outright: ${error instanceof Error ? error.message : error}`);
      failed.push(...batch);
    }
    console.log(`  ${Math.min(offset + BATCH_SIZE, pending.length)}/${pending.length}`);
  }
  if (failed.length > 0) {
    console.log(`  retrying ${failed.length} invalid key(s) in one final batch`);
    try {
      const parsed = parseJsonObject(await chat(SYSTEM_PROMPT(targetName), JSON.stringify(Object.fromEntries(failed))));
      const stillFailed: Array<[string, string]> = [];
      for (const [key, source] of failed) {
        if (isValid(source, parsed[key])) output[key] = parsed[key].trim();
        else stillFailed.push([key, source]);
      }
      failed = stillFailed;
    } catch {
      /* keep the English fallback below */
    }
    for (const [key, source] of failed) {
      console.warn(`  [${targetId}] keeping English for "${key}" (placeholder mismatch or missing)`);
      output[key] = source;
    }
  }
  return output;
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
  const sourceEntries = Object.entries(en) as Array<[string, string]>;

  for (const target of targets) {
    const existing = force ? {} : readLocaleFile(target.id);
    const previous = force ? {} : (manifest[target.id] ?? {});
    const pending = sourceEntries.filter(([key, text]) => !existing[key] || previous[key] !== hash(text));
    if (pending.length === 0) {
      console.log(`${target.id}: up to date`);
      continue;
    }
    console.log(`${target.id}: translating ${pending.length} of ${sourceEntries.length} strings (${MODEL})`);
    const translated = await translateLocale(target.id, target.englishName, pending);
    const merged: Record<string, string> = {};
    const nextManifest: Record<string, string> = {};
    for (const [key, text] of sourceEntries) {
      merged[key] = translated[key] ?? existing[key] ?? text;
      nextManifest[key] = hash(text);
    }
    writeLocaleFile(target.id, target.englishName, merged);
    manifest[target.id] = nextManifest;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`${target.id}: wrote client/src/i18n/${target.id}.ts`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
