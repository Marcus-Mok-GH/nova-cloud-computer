/**
 * Code-file heuristics and the unified-diff renderer. These are pure
 * helpers with no dependencies, shared by the workspace agent's tool
 * executor (which blocks/writes code) and its run loop (which nudges on
 * self-written code) - so they live in their own module rather than in
 * either of them.
 */

/** File extensions whose content is real code the specialist should own. */
const CODE_FILE_EXTENSIONS = new Set([
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "swift",
  "go",
  "rs",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "scala",
  "sh",
  "bash",
  "sql",
  "vue",
  "svelte",
  "html",
  "htm",
  "css",
  "scss",
  "less",
]);

/** True when the file name marks it as code (not notes, docs or data). */
export function isCodeFileName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return CODE_FILE_EXTENSIONS.has(
    name
      .slice(dot + 1)
      .trim()
      .toLowerCase()
  );
}

/** A write this large is beyond the tiny tweak the agent may do itself. */
export function isSubstantialCode(content: string): boolean {
  return content.split("\n").length > 15 || content.length > 800;
}

const DIFF_MAX_LINES = 400;
const DIFF_MAX_CHARS = 16000;

/**
 * A compact unified diff ("@@ -1,3 +1,4 @@" hunks with -/+ lines) between a
 * file's old and new content, for the edit_file dropdown. edit_file replaces
 * the whole file, so a naive line-by-line diff would mark every line changed
 * whenever a line is inserted near the top; this trims the common prefix and
 * suffix first and diffs only the middle, which is what makes the hunks read
 * like a real change. Returns "" when the content is unchanged.
 */
export function unifiedDiff(before: string, after: string): string {
  if (before === after) return "";
  // An empty file has no lines to anchor a range to, not one blank line -
  // otherwise creating a file reports a removal of line 1.
  const oldLines = before === "" ? [] : before.split("\n");
  const newLines = after === "" ? [] : after.split("\n");
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] ===
      newLines[newLines.length - 1 - suffix]
  )
    suffix++;
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);
  // Cap the middle so a whole-file rewrite does not balloon the persisted
  // activity row (and the chat payload) with hundreds of changed lines.
  const shownRemoved = removed.slice(0, DIFF_MAX_LINES);
  const shownAdded = added.slice(0, DIFF_MAX_LINES);
  // A zero-count range points at the line the change follows rather than the
  // first changed line, so an insertion after line N reads -N,0 (and 0,0 for a
  // file created from nothing).
  const oldStart = removed.length ? prefix + 1 : prefix;
  const newStart = added.length ? prefix + 1 : prefix;
  const header = `@@ -${oldStart},${removed.length} +${newStart},${added.length} @@`;
  const truncated =
    shownRemoved.length < removed.length || shownAdded.length < added.length;
  const lines = [header];
  for (const line of shownRemoved) lines.push(`-${line}`);
  for (const line of shownAdded) lines.push(`+${line}`);
  if (truncated) lines.push("… diff truncated …");
  const text = lines.join("\n");
  if (text.length <= DIFF_MAX_CHARS) return text;
  // Line count is not the only way a diff blows up: a minified bundle or a
  // single-line JSON puts hundreds of thousands of characters in one line, so
  // keep whole lines up to the character budget instead.
  const note = "\n… diff truncated …";
  const kept = [header];
  let keptChars = header.length;
  for (const line of lines.slice(1)) {
    if (keptChars + 1 + line.length + note.length > DIFF_MAX_CHARS) break;
    kept.push(line);
    keptChars += 1 + line.length;
  }
  return `${kept.join("\n")}${note}`;
}
