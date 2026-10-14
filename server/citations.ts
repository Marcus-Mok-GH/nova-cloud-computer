/** Citations for the message the main agent finally delivers.
 *
 * A run consults the live web in two places: `research_web` (an Exa deep
 * research report with its own numbered source list) and `browse` (a page the
 * agent opened). Until now those sources only lived inside the collapsed
 * research panel, so a reply that quoted them showed bare claims - or bare
 * `[1]` markers with no way to resolve them - unless the reader knew to open
 * the tool activity and hunt for the matching line.
 *
 * This collects the sources while the run works and renders them as ONE list
 * appended to the BOTTOM of the reply itself, so every citation the turn
 * gathered is visible together, in the message the user actually reads. The
 * list only carries what the reply does not already link: a source the model
 * quoted inline is already displayed there, and repeating it would double the
 * citation instead of completing it. */

import type { ExaCitation } from "./exa";

/**
 * How the delivering channel renders text. The web chat parses Markdown (so a
 * citation can be a real link); Telegram is sent without a parse mode, so its
 * copy must stay plain text or the reader sees raw asterisks and brackets.
 */
export type CitationStyle = "markdown" | "plain";

/** A source, as every web-carrying tool reports it. */
export type Citation = ExaCitation;

/** Longest title kept whole, so one page title cannot bury the rest. */
const MAX_TITLE_LENGTH = 120;

/** `open <target>`, with or without the CLI name the model sometimes keeps. */
const OPEN_COMMAND = /^(?:agent-browser\s+)?open\s+(.+)$/i;

/**
 * Extensions that mark a scheme-less `open` target as a workspace file rather
 * than a host - `open index.html` must not become `https://index.html`.
 */
const FILE_EXTENSIONS = new Set([
  "html", "htm", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "json",
  "md", "txt", "csv", "xml", "yml", "yaml", "png", "jpg", "jpeg", "gif",
  "svg", "webp", "pdf", "zip", "tar", "gz", "py", "rb", "go", "rs", "sh",
]);

/** Strips the characters that would break a `[title](url)` Markdown link. */
function cleanTitle(title: string): string {
  return title.replace(/[[\]()]/g, " ").replace(/\s+/g, " ").trim();
}

/** The title shown for a source, shortened and falling back to the URL. */
function titleOf(citation: Citation): string {
  const title = cleanTitle(citation.title ?? "");
  if (!title) return citation.url;
  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…`
    : title;
}

/**
 * The URL a `browse` call opened, or undefined when the command does not open
 * a web page (a click, a snapshot, a local file). Scheme-less hosts the model
 * writes (`open example.com`) are promoted to https so the citation links.
 */
export function browseOpenUrl(command: string): string | undefined {
  const match = OPEN_COMMAND.exec((command ?? "").trim());
  if (!match) return undefined;
  const target = match[1].trim().replace(/^["']|["']$/g, "").split(/\s+/)[0];
  if (!target) return undefined;
  if (/^https?:\/\//i.test(target)) return target;
  if (/^[/?~.]/.test(target)) return undefined;
  const host = target.split("/")[0];
  const extension = host.split(".").pop()?.toLowerCase() ?? "";
  if (!host.includes(".") || FILE_EXTENSIONS.has(extension)) return undefined;
  return `https://${target}`;
}

/** The label for a source only known by its URL: its host, e.g. `example.com`. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * The sources one run consulted, in the order it consulted them. The agent
 * records every web-carrying tool call as it runs, and the finished reply
 * asks for its citation block once, right before the reply is streamed on and
 * persisted.
 */
export class RunCitations {
  private readonly sources: Citation[] = [];
  private readonly seen = new Set<string>();

  /** How many distinct sources the run collected. */
  get size(): number {
    return this.sources.length;
  }

  /**
   * Records the sources a tool call consulted. Failed calls contribute
   * nothing (the page or report never came back), and repeat URLs collapse to
   * the first sighting so a report opened twice is cited once.
   *
   * @param toolName The tool that ran.
   * @param argsJson The raw JSON arguments of the call, read for `browse`.
   * @param execution The outcome - `citations` carries a research report's
   *   own source list, which only the executor has in structured form.
   */
  record(
    toolName: string,
    argsJson: string,
    execution: { ok: boolean; citations?: Citation[] }
  ): void {
    if (!execution.ok) return;
    if (toolName === "research_web") {
      for (const citation of execution.citations ?? []) this.add(citation);
      return;
    }
    if (toolName !== "browse") return;
    let command = "";
    try {
      const parsed = JSON.parse(argsJson || "{}") as { command?: unknown };
      if (typeof parsed?.command === "string") command = parsed.command;
    } catch {
      // Malformed arguments: nothing identifiable was opened.
      return;
    }
    const url = browseOpenUrl(command);
    if (url) this.add({ url, title: hostOf(url) });
  }

  /**
   * The citation block to place at the bottom of `reply`, or an empty string
   * when there is nothing left to show: no sources were collected, or the
   * reply already links every one of them.
   *
   * @param reply The reply about to be delivered, used to drop sources the
   *   model already cited inline.
   * @param style Markdown for the web chat, plain text for Telegram.
   */
  block(reply: string, style: CitationStyle): string {
    const pending = this.sources.filter(
      citation => !reply.includes(citation.url)
    );
    if (pending.length === 0) return "";
    const lines = pending.map((citation, index) => {
      const title = titleOf(citation);
      const isDefaultTitle = title === citation.url;
      if (style === "plain")
        return `${index + 1}. ${isDefaultTitle ? "" : `${title} - `}${citation.url}`;
      return `${index + 1}. ${isDefaultTitle ? citation.url : `[${title}](${citation.url})`}`;
    });
    return style === "plain"
      ? `\n\nSources:\n${lines.join("\n")}`
      : `\n\n---\n\n**Sources**\n\n${lines.join("\n")}`;
  }

  private add(citation: Citation): void {
    const url = (citation.url ?? "").trim();
    if (!url || this.seen.has(url)) return;
    this.seen.add(url);
    this.sources.push({ url, title: citation.title ?? "" });
  }
}

/** The rendering style a channel needs for its citation block. */
export function citationStyleFor(
  channel: "telegram" | "web" | undefined
): CitationStyle {
  return channel === "telegram" ? "plain" : "markdown";
}
