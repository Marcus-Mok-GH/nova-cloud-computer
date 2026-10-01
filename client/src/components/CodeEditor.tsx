import { HighlightedCode, type HighlightLanguage } from "@/lib/syntaxHighlight";
import React, { useCallback, useMemo, useRef } from "react";

export type EditorCursor = { line: number; column: number };

type CodeEditorProps = {
  value: string;
  language: HighlightLanguage;
  onChange: (value: string) => void;
  onCursorChange?: (cursor: EditorCursor) => void;
  onSave?: () => void;
  readOnly?: boolean;
  ariaLabel: string;
};

const LINE_HEIGHT = 24;
const GUTTER_WIDTH = 56;

/**
 * VS Code-style editing surface: a transparent <textarea> layered over a
 * syntax-highlighted <pre>, with a synced line-number gutter. Keeps the
 * highlight and the caret perfectly aligned by sharing font metrics and
 * scroll offsets.
 */
export default function CodeEditor({ value, language, onChange, onCursorChange, onSave, readOnly = false, ariaLabel }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const lines = useMemo(() => value.split("\n"), [value]);
  const gutterDigits = Math.max(2, String(lines.length).length);
  const gutterWidth = GUTTER_WIDTH + gutterDigits * 8;

  const reportCursor = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !onCursorChange) return;
    const upto = value.slice(0, textarea.selectionStart);
    const lastNewline = upto.lastIndexOf("\n");
    onCursorChange({ line: upto.split("\n").length, column: upto.length - lastNewline });
  }, [value, onCursorChange]);

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-textarea.scrollTop}px)`;
    if (highlightRef.current) highlightRef.current.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave?.();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (start === end) {
        textarea.setRangeText("  ", start, end, "end");
        onChange(textarea.value);
      } else {
        // Indent every selected line, like VS Code.
        const selected = value.slice(start, end);
        const indented = selected.replace(/^/gm, "  ");
        textarea.setRangeText(indented, start, end, "select");
        onChange(textarea.value);
      }
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
    syncScroll();
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-card font-mono text-[13px] leading-6 dark:bg-[#0d0d0d]">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 overflow-hidden border-r border-border/70 bg-card select-none dark:border-white/5 dark:bg-[#0d0d0d]" style={{ width: gutterWidth }}>
        <div ref={gutterRef} className="text-right font-mono text-[12px] leading-6 text-muted-foreground/50" style={{ paddingTop: 12, paddingBottom: 12, willChange: "transform" }}>
          {lines.map((_, index) => <div key={index} className="pr-3">{index + 1}</div>)}
        </div>
      </div>

      <div className="absolute inset-0 overflow-hidden" style={{ paddingLeft: gutterWidth }}>
        <pre ref={highlightRef} aria-hidden="true" className="m-0 min-h-full whitespace-pre py-3 pl-3 pr-16 font-mono text-[13px] leading-6 text-foreground dark:text-foreground" style={{ willChange: "transform" }}>
          <HighlightedCode code={`${value}\n`} language={language} />
        </pre>
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        readOnly={readOnly}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        aria-label={ariaLabel}
        onChange={handleChange}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        onKeyUp={reportCursor}
        onClick={reportCursor}
        onSelect={reportCursor}
        className="absolute inset-0 resize-none overflow-auto border-0 bg-transparent py-3 pl-3 pr-16 font-mono text-[13px] leading-6 text-transparent caret-foreground outline-none [tab-size:2]"
        style={{ paddingLeft: gutterWidth + 12, lineHeight: `${LINE_HEIGHT}px` }}
      />
    </div>
  );
}
