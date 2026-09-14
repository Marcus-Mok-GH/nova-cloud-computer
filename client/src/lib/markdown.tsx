import React from "react";
import { HighlightedCode, type HighlightLanguage } from "@/lib/syntaxHighlight";

/**
 * Lightweight Markdown renderer for AI chat messages.
 * Supports: **bold**, __bold__, *italic*, ~~strike~~, `inline code`,
 * fenced ``` code blocks (syntax highlighted), # headings, bullet and
 * numbered lists, > blockquotes, --- rules, [links](url) and bare URLs.
 * Everything else renders as plain, safe text (no HTML injection).
 */

const fenceAliases: Record<string, HighlightLanguage> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", javascript: "javascript",
  ts: "typescript", typescript: "typescript", jsx: "jsx", tsx: "tsx",
  json: "json", html: "html", htm: "html", xml: "xml", css: "css", scss: "scss",
  py: "python", python: "python", java: "java", c: "c", cpp: "cpp", "c++": "cpp",
  cs: "csharp", csharp: "csharp", go: "go", rs: "rust", rust: "rust",
  sh: "bash", bash: "bash", shell: "shell", zsh: "shell",
  sql: "sql", yaml: "yaml", yml: "yaml", md: "markdown", markdown: "markdown", php: "php",
};

// Order matters: inline code first, then bold, strike, italic, links, bare URLs.
// Italic/bold/strike require non-space edges so plain asterisks in prose
// (e.g. "2 * 3 * 4") and snake_case words are left alone.
const INLINE_TOKEN = /(`[^`\n]+`)|(\*\*(?:\S(?:[^*\n]*?\S)?)\*\*)|(__(?:\S(?:[^_\n]*?\S)?)__)|(~~(?:\S(?:[^~\n]*?\S)?)~~)|(\*(?:\S(?:[^*\n]*?\S)?)\*)|(\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^\s)]+\))|(https?:\/\/[^\s<>()\[\]]+)/g;

const BARE_URL = /^https?:\/\//;
const LINK_TOKEN = /^\[([^\]]+)\]\((.+)\)$/;

function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = new RegExp(INLINE_TOKEN.source, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    n += 1;
    const key = `${keyPrefix}-i${n}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key} className="rounded-sm bg-neutral-200/80 px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key} className="font-bold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<s key={key}>{token.slice(2, -2)}</s>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("[")) {
      const link = LINK_TOKEN.exec(token);
      if (link) {
        const href = safeHref(link[2]);
        if (href) nodes.push(<a key={key} href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-primary underline underline-offset-2">{link[1]}</a>);
        else nodes.push(link[1]);
      } else nodes.push(token);
    } else if (BARE_URL.test(token)) {
      nodes.push(<a key={key} href={token} target="_blank" rel="noreferrer noopener" className="break-all text-primary underline underline-offset-2">{token}</a>);
    } else {
      nodes.push(token);
    }
    cursor = regex.lastIndex;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function renderParagraphLines(lines: string[], keyPrefix: string): React.ReactNode[] {
  return lines.map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{renderInline(line, `${keyPrefix}-l${i}`)}</React.Fragment>);
}

const HORIZONTAL_RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^(#{1,6})\s+(.+)$/;
const BULLET = /^\s*[-*+]\s+(.+)$/;
const ORDERED = /^\s*\d+[.)]\s+(.+)$/;
const QUOTE = /^\s*>\s?(.*)$/;

function CodeBlock({ code, tag }: { code: string; tag: string }) {
  const language = fenceAliases[tag.trim().toLowerCase()] ?? "text";
  return <div className="overflow-x-auto rounded-lg border border-border bg-background p-3 dark:border-white/10 dark:bg-background"><pre className="m-0 whitespace-pre font-mono text-[13px] leading-6 text-foreground dark:text-foreground"><HighlightedCode code={code} language={language} /></pre></div>;
}

export function MarkdownText({ text }: { text: string }) {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const nextKey = () => `md-${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block (an unclosed fence still renders, for streaming).
    const fence = /^\s*```\s*([A-Za-z0-9+#-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i += 1; }
      i += 1; // skip closing fence (or EOF)
      blocks.push(<CodeBlock key={nextKey()} code={code.join("\n")} tag={fence[1]} />);
      continue;
    }

    // Headings
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const size = level <= 1 ? "text-[15px]" : level === 2 ? "text-sm" : "text-[13px]";
      blocks.push(<p key={nextKey()} className={`${level <= 2 ? "font-bold" : "font-semibold"} ${size} leading-6`}>{renderInline(heading[2], `h${key}`)}</p>);
      i += 1;
      continue;
    }

    // Horizontal rule
    if (HORIZONTAL_RULE.test(line)) {
      blocks.push(<hr key={nextKey()} className="border-border dark:border-white/10" />);
      i += 1;
      continue;
    }

    // Blockquote (consecutive quoted lines)
    const quote = QUOTE.exec(line);
    if (quote) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i]);
        if (!q) break;
        quoted.push(q[1]);
        i += 1;
      }
      blocks.push(<blockquote key={nextKey()} className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">{renderParagraphLines(quoted, `q${key}`)}</blockquote>);
      continue;
    }

    // Bullet list (consecutive items)
    const bullet = BULLET.exec(line);
    if (bullet) {
      const items: string[] = [];
      while (i < lines.length) {
        const b = BULLET.exec(lines[i]);
        if (!b) break;
        items.push(b[1]);
        i += 1;
      }
      blocks.push(<ul key={nextKey()} className="list-disc space-y-1 pl-5">{items.map((item, idx) => <li key={idx}>{renderInline(item, `ul${key}-${idx}`)}</li>)}</ul>);
      continue;
    }

    // Numbered list (consecutive items)
    const ordered = ORDERED.exec(line);
    if (ordered) {
      const items: string[] = [];
      while (i < lines.length) {
        const o = ORDERED.exec(lines[i]);
        if (!o) break;
        items.push(o[1]);
        i += 1;
      }
      blocks.push(<ol key={nextKey()} className="list-decimal space-y-1 pl-5">{items.map((item, idx) => <li key={idx}>{renderInline(item, `ol${key}-${idx}`)}</li>)}</ol>);
      continue;
    }

    // Blank line
    if (line.trim() === "") { i += 1; continue; }

    // Paragraph: consecutive non-blank, non-structural lines joined with <br>.
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) && !HEADING.test(lines[i]) && !HORIZONTAL_RULE.test(lines[i]) &&
      !QUOTE.test(lines[i]) && !BULLET.test(lines[i]) && !ORDERED.test(lines[i])
    ) { para.push(lines[i]); i += 1; }
    blocks.push(<p key={nextKey()} className="whitespace-normal">{renderParagraphLines(para, `p${key}`)}</p>);
  }

  return <div className="space-y-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{blocks}</div>;
}
