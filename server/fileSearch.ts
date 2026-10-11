/**
 * Workspace-wide file search - the pure matching, snippet and ranking layer
 * behind the Files page search box and the `files.search` tRPC query.
 *
 * Nova stores every workspace file's bytes in `workspace_files.content` (plain
 * text, or a base64 data URI for binary uploads), so search scans the
 * workspace's own rows instead of a separate index. The default mode is a
 * case-insensitive literal substring across the file name and body; `regex`
 * mode treats the query as a JavaScript regular expression. Filename matches
 * rank above body matches, and each file carries line-anchored snippets so the
 * UI never has to re-scan file content itself.
 */

/** The subset of a `workspace_files` row the searcher reads. */
export type SearchableWorkspaceFile = {
  id: number;
  name: string;
  content?: string | null;
  mimeType?: string | null;
  folderId?: number | null;
};

export type FileSearchSnippet = {
  /** 1-based line number the snippet starts on. */
  line: number;
  /** The matched line, whitespace-trimmed and length-capped for display. */
  text: string;
};

export type FileSearchMatch = {
  id: number;
  name: string;
  folderId: number | null;
  mimeType: string;
  /** True when the file's own name matched the query. */
  matchedName: boolean;
  /** Matching body lines found, capped at FILE_SEARCH_MAX_MATCHES_PER_FILE. */
  matchCount: number;
  snippets: FileSearchSnippet[];
  /** Internal ranking score; higher sorts first. */
  score: number;
};

export type FileSearchResult = { matches: FileSearchMatch[] } | { error: string };

export type FileSearchOptions = {
  query: string;
  regex?: boolean;
  limit?: number;
};

export const FILE_SEARCH_MAX_QUERY_LENGTH = 200;
export const FILE_SEARCH_DEFAULT_LIMIT = 50;
export const FILE_SEARCH_MAX_LIMIT = 200;
export const FILE_SEARCH_MAX_MATCHES_PER_FILE = 3;
export const FILE_SEARCH_MAX_SNIPPET_LENGTH = 200;

/** Name matches outrank body matches by a wide margin. */
const NAME_MATCH_SCORE = 1000;

/** Content stored as a base64 data URI is opaque bytes - matching inside it is noise. */
const BINARY_DATA_URI = /^data:[^,]*;base64,/i;

export type FileSearchMatcher = {
  test: (text: string) => boolean;
  count: (text: string) => number;
  firstIndex: (text: string) => number;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds the case-insensitive matcher for one query. Returns an error object
 * for a blank query, an over-long query, or a regular expression that is
 * invalid or matches everything.
 */
export function buildFileSearchMatcher(query: string, regex = false): FileSearchMatcher | { error: string } {
  const trimmed = query.trim();
  if (!trimmed) return { error: "Enter something to search for." };
  if (trimmed.length > FILE_SEARCH_MAX_QUERY_LENGTH) {
    return { error: `Search queries are at most ${FILE_SEARCH_MAX_QUERY_LENGTH} characters.` };
  }
  const source = regex ? trimmed : escapeRegExp(trimmed);
  let single: RegExp;
  let global: RegExp;
  try {
    single = new RegExp(source, "i");
    global = new RegExp(source, "gi");
  } catch {
    return { error: "That is not a valid regular expression." };
  }
  // A pattern that can match the empty string (e.g. `a*` or `x?`) would report
  // every line as a hit; reject it so results stay meaningful.
  if (single.test("")) return { error: "That pattern matches everything - make it more specific." };
  return {
    test: text => single.test(text),
    count: text => (text.match(global) ?? []).length,
    firstIndex: text => text.search(single),
  };
}

/** Clamps a requested result limit into the supported range. */
function clampLimit(limit?: number) {
  if (limit === undefined || !Number.isFinite(limit)) return FILE_SEARCH_DEFAULT_LIMIT;
  return Math.min(FILE_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Trims a line and keeps the match in view when it is longer than the cap. */
function capSnippet(text: string, matchIndex: number) {
  if (text.length <= FILE_SEARCH_MAX_SNIPPET_LENGTH) return text;
  const half = Math.floor(FILE_SEARCH_MAX_SNIPPET_LENGTH / 2);
  let start = Math.max(0, matchIndex - half);
  const end = Math.min(text.length, start + FILE_SEARCH_MAX_SNIPPET_LENGTH);
  start = Math.max(0, end - FILE_SEARCH_MAX_SNIPPET_LENGTH);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function buildSnippet(line: string, lineNumber: number, matcher: FileSearchMatcher): FileSearchSnippet {
  const trimmed = line.trim();
  const index = matcher.firstIndex(trimmed);
  return { line: lineNumber, text: capSnippet(trimmed, index < 0 ? 0 : index) };
}

/**
 * Searches the given workspace files, newest-rank first. A file is included
 * when its name or body matches; body matches are summarized with up to
 * FILE_SEARCH_MAX_MATCHES_PER_FILE line snippets.
 */
export function searchWorkspaceFiles(files: SearchableWorkspaceFile[], options: FileSearchOptions): FileSearchResult {
  const matcher = buildFileSearchMatcher(options.query, options.regex);
  if ("error" in matcher) return matcher;

  const matches: FileSearchMatch[] = [];
  for (const file of files) {
    const matchedName = matcher.test(file.name);
    const content = typeof file.content === "string" ? file.content : "";
    const snippets: FileSearchSnippet[] = [];
    let matchCount = 0;
    if (content && !BINARY_DATA_URI.test(content)) {
      const lines = content.split("\n");
      for (let index = 0; index < lines.length && matchCount < FILE_SEARCH_MAX_MATCHES_PER_FILE; index += 1) {
        if (!matcher.test(lines[index])) continue;
        matchCount += 1;
        snippets.push(buildSnippet(lines[index], index + 1, matcher));
      }
    }
    if (!matchedName && matchCount === 0) continue;
    matches.push({
      id: file.id,
      name: file.name,
      folderId: file.folderId ?? null,
      mimeType: file.mimeType ?? "text/plain",
      matchedName,
      matchCount,
      snippets,
      score: (matchedName ? NAME_MATCH_SCORE : 0) + matchCount,
    });
  }

  matches.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name) || left.id - right.id);
  return { matches: matches.slice(0, clampLimit(options.limit)) };
}
