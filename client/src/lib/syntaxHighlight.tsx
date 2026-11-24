import React from "react";

export type HighlightLanguage =
  | "javascript" | "typescript" | "jsx" | "tsx" | "json" | "html" | "xml"
  | "css" | "scss" | "python" | "java" | "c" | "cpp" | "csharp" | "go"
  | "rust" | "bash" | "shell" | "sql" | "yaml" | "markdown" | "php" | "text";

const extensionMap: Record<string, HighlightLanguage> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", jsx: "jsx", tsx: "tsx",
  json: "json", jsonc: "json", html: "html", htm: "html", xml: "xml", svg: "xml", css: "css", scss: "scss",
  py: "python", java: "java", c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", cs: "csharp",
  go: "go", rs: "rust", sh: "shell", bash: "bash", zsh: "shell", sql: "sql", yaml: "yaml", yml: "yaml",
  md: "markdown", markdown: "markdown", php: "php",
};

export function detectLanguage(filename: string, mimeType?: string | null): HighlightLanguage {
  const name = filename.toLowerCase();
  // `.slice(lastIndexOf + 1)` is the same extension as `.split(".").pop()`
  // (a dot-less name yields the whole name) without allocating every segment.
  const extension = name.slice(name.lastIndexOf(".") + 1);
  const mapped = extensionMap[extension];
  if (mapped) return mapped;
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime.includes("javascript")) return "javascript";
  if (mime.includes("typescript")) return "typescript";
  if (mime.includes("json")) return "json";
  if (mime.includes("html")) return "html";
  if (mime.includes("xml")) return "xml";
  if (mime.includes("css")) return "css";
  if (mime.includes("python")) return "python";
  if (mime.includes("sql")) return "sql";
  if (mime.includes("markdown")) return "markdown";
  return "text";
}

const LANGUAGE_LABELS: Record<HighlightLanguage, string> = {
  javascript: "JavaScript", typescript: "TypeScript", jsx: "JSX", tsx: "TSX", json: "JSON", html: "HTML", xml: "XML",
  css: "CSS", scss: "SCSS", python: "Python", java: "Java", c: "C", cpp: "C++", csharp: "C#", go: "Go", rust: "Rust",
  bash: "Bash", shell: "Shell", sql: "SQL", yaml: "YAML", markdown: "Markdown", php: "PHP", text: "Plain text",
};

export function languageLabel(language: HighlightLanguage) {
  return LANGUAGE_LABELS[language];
}

type Token = { kind: "comment" | "string" | "number" | "keyword" | "literal" | "function" | "tag" | "attribute" | "property" | "operator" | "heading" | "punctuation" | "plain"; text: string };

const keywordSets: Record<string, Set<string>> = {
  javascript: new Set("as async await break case catch class const continue debugger default delete do else export extends finally for from function get if implements import in instanceof interface let new of return set static super switch this throw try typeof var void while with yield enum public private protected package null undefined true false".split(" ")),
  typescript: new Set("as async await break case catch class const continue debugger default delete do else export extends finally for from function get if implements import in instanceof interface let new of return set static super switch this throw try typeof var void while with yield enum public private protected package null undefined true false type keyof readonly declare namespace abstract satisfies unknown never any boolean number string".split(" ")),
  jsx: new Set("as async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new return switch this throw try typeof var void while yield null undefined true false".split(" ")),
  tsx: new Set("as async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new return switch this throw try typeof var void while yield null undefined true false type interface public private readonly unknown never any boolean number string".split(" ")),
  python: new Set("and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield True False None self".split(" ")),
  java: new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null".split(" ")),
  c: new Set("auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while true false NULL".split(" ")),
  cpp: new Set("alignas alignof and asm auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend if inline int long mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while".split(" ")),
  csharp: new Set("abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await var dynamic".split(" ")),
  go: new Set("break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var".split(" ")),
  rust: new Set("as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn".split(" ")),
  sql: new Set("select from where and or not insert into values update set delete create alter drop table index view join inner left right full outer on as group by order having limit offset distinct union all case when then else end null is in exists like between asc desc primary key foreign references constraint database".split(" ")),
  shell: new Set("if then else elif fi for while in do done case esac function select time coproc export local readonly declare typeset source alias unalias return exit true false".split(" ")),
  bash: new Set("if then else elif fi for while in do done case esac function select time coproc export local readonly declare typeset source alias unalias return exit true false".split(" ")),
  php: new Set("and or xor __FILE__ __LINE__ array as break case class const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while yield true false null".split(" ")),
};

const TOKEN_CLASSES: Record<Token["kind"], string> = {
  comment: "text-neutral-500 italic", string: "text-emerald-600 dark:text-emerald-400", number: "text-amber-600 dark:text-amber-300",
  keyword: "text-purple-700 dark:text-purple-400 font-medium", literal: "text-orange-600 dark:text-orange-300", function: "text-blue-700 dark:text-blue-300",
  tag: "text-red-600 dark:text-red-400", attribute: "text-sky-700 dark:text-sky-300", property: "text-cyan-700 dark:text-cyan-300",
  operator: "text-pink-600 dark:text-pink-300", heading: "text-purple-700 dark:text-purple-300 font-semibold", punctuation: "text-neutral-600 dark:text-neutral-300", plain: "",
};

function tokenClass(kind: Token["kind"]) {
  return TOKEN_CLASSES[kind];
}

/** Shared by every language with no keyword list, so no Set is allocated. */
const NO_KEYWORDS: ReadonlySet<string> = new Set<string>();

/** Words a tokeniser reports as literals rather than keywords. */
const LITERAL_WORDS: ReadonlySet<string> = new Set([
  "true", "false", "null", "undefined", "None", "True", "False", "none", "nil", "nullptr",
]);

/** The markup and code token patterns, compiled once instead of per call. */
const HTML_TOKEN = /(<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
const CODE_TOKEN = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|===|!==|=>|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|[+\-*\/%=<>!&|^~?:])+/g;
/** Markdown is rendered by splitting, never by tokenising. */
const MARKDOWN_SPLIT = /(\n#{1,6}\s+[^\n]+|`[^`]+`)/g;
/** ` name=` inside a start tag, split so the attribute can be coloured. */
const TAG_ATTRIBUTE = /(\s+)([A-Za-z_:][-\w:.]*)(=)/g;
const TAG_ATTRIBUTE_HEAD = /^([A-Za-z_:][-\w:.]*)(=)/;
const QUOTE_START = /^[`"']/;
const DIGIT_START = /^\d/;
const OPERATOR_START = /^[+\-*\/%=<>!&|^~?:]/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const CALL_FOLLOWS = /^\s*\(/;
const JSON_VALUE_FOLLOWS = /^\s*:/;

function tokenize(code: string, language: HighlightLanguage): Token[] {
  if (language === "markdown")
    return code.split(MARKDOWN_SPLIT).map(text => ({ kind: text.startsWith("#") ? "heading" : text.startsWith("`") ? "string" : "plain", text } as Token));
  const tokens: Token[] = [];
  const keywords = keywordSets[language] ?? NO_KEYWORDS;
  const htmlLike = language === "html" || language === "xml";
  const pattern = htmlLike ? HTML_TOKEN : CODE_TOKEN;
  const isJson = language === "json";
  let last = 0;
  // Stepped with `exec` on the compiled pattern rather than materialising
  // every match first: a large file produces thousands of matches, and the
  // intermediate array was a full second copy of them.
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "plain", text: code.slice(last, index) });
    const value = match[0];
    if (htmlLike) {
      if (value.startsWith("<!--")) tokens.push({ kind: "comment", text: value });
      else if (value.startsWith("<")) {
        const tag = value.replace(TAG_ATTRIBUTE, "$1§ATTR§$2$3");
        const pieces = tag.split("§ATTR§");
        tokens.push({ kind: "tag", text: pieces[0] });
        for (let pieceIndex = 1; pieceIndex < pieces.length; pieceIndex += 1) {
          const piece = pieces[pieceIndex];
          const attr = TAG_ATTRIBUTE_HEAD.exec(piece);
          if (attr) {
            tokens.push({ kind: "attribute", text: attr[1] });
            tokens.push({ kind: "operator", text: "=" });
            tokens.push({ kind: "string", text: piece.slice(attr[0].length) });
          } else tokens.push({ kind: "tag", text: piece });
        }
      } else tokens.push({ kind: "string", text: value });
    } else if (value.startsWith("//") || value.startsWith("#") || value.startsWith("/*")) tokens.push({ kind: "comment", text: value });
    else if (QUOTE_START.test(value)) tokens.push({ kind: "string", text: value });
    else if (DIGIT_START.test(value)) tokens.push({ kind: "number", text: value });
    else if (keywords.has(value)) tokens.push({ kind: LITERAL_WORDS.has(value) ? "literal" : "keyword", text: value });
    else if (OPERATOR_START.test(value)) tokens.push({ kind: "operator", text: value });
    else {
      const rest = code.slice(index + value.length);
      tokens.push({
        kind: IDENTIFIER.test(value) && CALL_FOLLOWS.test(rest)
          ? "function"
          : isJson && JSON_VALUE_FOLLOWS.test(rest)
            ? "property"
            : "plain",
        text: value,
      });
    }
    last = index + value.length;
  }
  if (last < code.length) tokens.push({ kind: "plain", text: code.slice(last) });
  return tokens;
}

export function HighlightedCode({ code, language }: { code: string; language: HighlightLanguage }) {
  const tokens = React.useMemo(() => tokenize(code, language), [code, language]);
  return <code>{tokens.map((token, index) => <span key={`${index}-${token.text.slice(0, 8)}`} className={tokenClass(token.kind)}>{token.text}</span>)}</code>;
}
