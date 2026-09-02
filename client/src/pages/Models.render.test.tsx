import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Models from "./Models";

const mutation = { mutate: vi.fn(), isPending: false };
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    nvidia: {
      models: {
        useQuery: () => ({
          data: [
            { id: "meta/llama-3.1-8b-instruct", kind: "text" },
            { id: "nvidia/neva-22b", kind: "vision" },
          ],
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
    },
    workspace: {
      modelSettings: {
        useQuery: () => ({
          data: {
            activeProvider: "nvidia-nim",
            activeModelId: "meta/llama-3.1-8b-instruct",
          },
          isLoading: false,
        }),
      },
      updateSettings: { useMutation: () => mutation },
    },
    useUtils: () => ({
      workspace: { modelSettings: { invalidate: vi.fn() } },
      telegram: { modelSettings: { invalidate: vi.fn() } },
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("Model home", () => {
  it("shows dynamically discovered text and vision model choices", () => {
    const markup = renderToStaticMarkup(<Models />);
    expect(markup).toContain("Model home");
    expect(markup).toContain("meta/llama-3.1-8b-instruct");
    expect(markup).toContain("nvidia/neva-22b");
    expect(markup).toContain("Vision-language");
    expect(markup).toContain("Currently selected");
    expect(markup).not.toContain("image generation");
  });
});
