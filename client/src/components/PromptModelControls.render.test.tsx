import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatModel } from "@shared/models";
import { PromptModelControls } from "./PromptModelControls";

const models = [
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash 1017", tier: "pro" },
  { id: "nova-lite", label: "Nova Lite", tier: "free" },
] as unknown as ChatModel[];

function renderControls() {
  return renderToStaticMarkup(
    <PromptModelControls
      models={models}
      plan="paid"
      selectedModelId="deepseek-v4.1-flash"
      selectedEffortId="auto"
      onModelChange={() => {}}
      onEffortChange={() => {}}
    />
  );
}

describe("PromptModelControls", () => {
  it("caps a long model label with truncation instead of letting it stretch", () => {
    const html = renderControls();
    // The label span: growth capped at 8rem, shrinkable, ellipsized.
    expect(html).toContain("max-w-[8rem] min-w-0 truncate");
    // The trigger and the control group must be able to shrink below their
    // content floor on narrow viewports, or the row overflows the composer.
    expect(html).toContain("inline-flex h-8 min-w-0 items-center");
    expect(html).toContain('class="flex min-w-0 items-center gap-2"');
    // The full label still reaches the DOM; the cap does the clipping.
    expect(html).toContain("DeepSeek V4.1 Flash 1017");
  });
});
