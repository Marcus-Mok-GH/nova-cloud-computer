import type { SlashCommand } from "@shared/commands";
import React from "react";

/**
 * The slash menu that floats above the composer while the user types a command:
 * the matching commands, best match first, with the highlighted one ready for
 * Enter or Tab. It is presentational - the composer owns the query, the
 * highlight and the keyboard - and it positions itself above whatever
 * `relative` container it is rendered in.
 */

/** The menu's element id, which the composer's textarea points `aria-controls` at. */
export const SLASH_MENU_ID = "slash-command-menu";

interface SlashCommandMenuProps {
  /** The commands to offer, best match first. */
  commands: readonly SlashCommand[];
  /** The index of the highlighted command. */
  activeIndex: number;
  /** Called when a command is picked, by click or by the keyboard. */
  onSelect: (command: SlashCommand) => void;
  /** Called as the pointer moves over a command, so the highlight follows it. */
  onActiveIndexChange: (index: number) => void;
}

export function SlashCommandMenu({
  commands,
  activeIndex,
  onSelect,
  onActiveIndexChange,
}: SlashCommandMenuProps) {
  // Nothing matched, so the menu stays out of the way instead of floating an
  // empty panel over the conversation.
  if (commands.length === 0) return null;
  return (
    <div
      id={SLASH_MENU_ID}
      role="listbox"
      aria-label="Slash commands"
      className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-64 overflow-y-auto border border-foreground/[0.14] bg-card/95 p-1.5 shadow-[0_18px_50px_rgba(36,40,34,0.16)] backdrop-blur-xl dark:border-white/[0.12]"
    >
      {commands.map((command, index) => (
        <button
          key={command.name}
          type="button"
          role="option"
          id={`${SLASH_MENU_ID}-option-${index}`}
          aria-selected={index === activeIndex}
          // Picking on mousedown (rather than click) keeps the caret in the
          // textarea, which a click would have blurred away first.
          onMouseDown={event => {
            event.preventDefault();
            onSelect(command);
          }}
          onMouseEnter={() => onActiveIndexChange(index)}
          className={`flex w-full items-baseline gap-2.5 px-2.5 py-2 text-left transition ${
            index === activeIndex
              ? "bg-primary/[0.10] text-foreground"
              : "text-foreground/80 hover:bg-foreground/[0.05] dark:hover:bg-white/[0.06]"
          }`}
        >
          <span className="shrink-0 font-mono text-[13px] font-bold">
            {command.name}
          </span>
          {command.args && (
            <span className="shrink-0 font-mono text-[13px] text-muted-foreground">
              {command.args}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {command.description}
          </span>
        </button>
      ))}
    </div>
  );
}
