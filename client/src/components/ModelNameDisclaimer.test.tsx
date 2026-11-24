import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatModel } from "@shared/models";
import { NOVA_MODEL_NAME_DISCLAIMER } from "@shared/models";
import { ModelNameDisclaimer } from "./ModelNameDisclaimer";
import { ModelSelector } from "./ModelSelector";
import { PromptModelControls } from "./PromptModelControls";

// Static markup escapes the apostrophe in "Amazon's" to &#x27;, so assert on
// apostrophe-free fragments when reading rendered output.
const FRAGMENTS = [
  "Nova Lite and Nova Ultra are Nova Cloud Computer model names",
  "no association with Amazon",
  "Nova foundation models",
] as const;

function expectDisclaimer(markup: string) {
  for (const fragment of FRAGMENTS) {
    expect(markup).toContain(fragment);
  }
}

const state = vi.hoisted(() => ({
  models: [
    {
      id: "nova-pro",
      label: "Nova Lite",
      description: "Fast, free model.",
      tier: "free",
      efforts: ["auto", "low", "medium", "high", "max"],
    },
    {
      id: "gpt-6-luna",
      label: "GPT-6 Luna",
      description: "Premium model.",
      tier: "pro",
      efforts: ["auto", "low", "medium", "high", "max"],
    },
  ] satisfies ChatModel[],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    chats: {
      models: {
        useQuery: () => ({
          data: { models: state.models, current: "nova-pro", plan: "paid" },
          isLoading: false,
        }),
      },
      setModel: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
    useUtils: () => ({ chats: { models: { invalidate: () => {} } } }),
  },
}));

vi.mock("@/components/ui/dropdown-menu", async () => {
  const ReactModule = await import("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    ReactModule.createElement(ReactModule.Fragment, null, children);
  const trigger = ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    ReactModule.createElement("button", props, children);
  return {
    DropdownMenu: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: passthrough,
    DropdownMenuLabel: passthrough,
    DropdownMenuSeparator: () => ReactModule.createElement("hr"),
    DropdownMenuTrigger: trigger,
  };
});

describe("Nova model name disclaimer", () => {
  it("states the Nova catalogue names have no association with Amazon Nova", () => {
    expect(NOVA_MODEL_NAME_DISCLAIMER).toContain(
      "no association with Amazon's Nova foundation models"
    );
  });

  it("renders the note under the prompt-screen model picker", () => {
    expectDisclaimer(
      renderToStaticMarkup(
        <PromptModelControls
          models={state.models}
          plan="paid"
          selectedModelId="nova-pro"
          selectedEffortId="auto"
          onModelChange={() => {}}
          onEffortChange={() => {}}
        />
      )
    );
  });

  it("renders the note under the in-chat model picker", () => {
    expectDisclaimer(renderToStaticMarkup(<ModelSelector chatId="chat-1" />));
  });
});
