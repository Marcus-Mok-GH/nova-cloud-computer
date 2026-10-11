/**
 * Snapshot a snippet into matched and unmatched segments so the Files page can
 * highlight the query inside a search result without re-implementing the
 * server's matching rules. Mirrors `server/fileSearch.ts`: case-insensitive,
 * literal by default, regular expression when `regex` is set.
 */

export type HighlightSegment = { text: string; match: boolean };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Returns the snippet as alternating plain/matched segments. Never throws. */
export function highlightSegments(text: string, query: string, regex = false): HighlightSegment[] {
  const trimmed = query.trim();
  if (!trimmed) return [{ text, match: false }];

  let pattern: RegExp;
  try {
    pattern = new RegExp(regex ? trimmed : escapeRegExp(trimmed), "gi");
  } catch {
    return [{ text, match: false }];
  }
  if (pattern.test("")) return [{ text, match: false }];

  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(text)) !== null) {
    if (found.index > lastIndex) segments.push({ text: text.slice(lastIndex, found.index), match: false });
    if (found[0]) segments.push({ text: found[0], match: true });
    lastIndex = found.index + found[0].length;
    // A zero-width match (e.g. a lookaround) must not spin forever.
    if (found[0] === "") pattern.lastIndex += 1;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), match: false });
  return segments.length ? segments : [{ text, match: false }];
}
