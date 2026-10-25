import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { SLASH_MENU_ID, SlashCommandMenu } from "./SlashCommandMenu";
import { SLASH_COMMANDS } from "@shared/commands";

const noop = () => {};

const render = (commands = SLASH_COMMANDS, activeIndex = 0) =>
  renderToStaticMarkup(
    <SlashCommandMenu
      commands={commands}
      activeIndex={activeIndex}
      onSelect={noop}
      onActiveIndexChange={noop}
    />
  );

describe("SlashCommandMenu", () => {
  it("renders nothing when no command matches", () => {
    expect(render([])).toBe("");
  });

  it("lists each command with its argument placeholder and description", () => {
    const markup = render();
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain(`id="${SLASH_MENU_ID}"`);
    expect(markup).toContain("/ultraplan");
    expect(markup).toContain("&lt;task&gt;");
    expect(markup).toContain(SLASH_COMMANDS[0].description);
    // One option per command, each addressable by the textarea's
    // aria-activedescendant.
    expect(markup.match(/role="option"/g) || []).toHaveLength(
      SLASH_COMMANDS.length
    );
    expect(markup).toContain(`id="${SLASH_MENU_ID}-option-0"`);
  });

  it("marks only the highlighted command as selected", () => {
    const commands = [
      { name: "/alpha", args: "<a>", description: "first" },
      { name: "/beta", args: "<b>", description: "second" },
    ];
    const markup = render(commands, 1);
    expect(markup.match(/aria-selected="true"/g) || []).toHaveLength(1);
    const selected = markup.match(/<button[^>]*aria-selected="true"[^>]*>/);
    expect(selected?.[0]).toContain(`id="${SLASH_MENU_ID}-option-1"`);
  });
});
