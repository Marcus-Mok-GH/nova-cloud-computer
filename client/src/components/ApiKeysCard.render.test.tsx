import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiKeysCard from "./ApiKeysCard";

const state = vi.hoisted(() => ({
  keys: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
}));

const mutation = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, variables: undefined as unknown }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ apiKeys: { list: { invalidate: vi.fn() } } }),
    apiKeys: {
      list: { useQuery: () => state.keys },
      create: { useMutation: (_options?: unknown) => mutation },
      rename: { useMutation: (_options?: unknown) => mutation },
      revoke: { useMutation: (_options?: unknown) => mutation },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const sampleKeys = [
  { id: 1, name: "nightly-scripts", keyPreview: "nova_sk_9f2a1c44…", createdAt: "2026-09-27T00:00:00Z", lastUsedAt: "2026-09-27T01:00:00Z" },
  { id: 2, name: "playground", keyPreview: "nova_sk_77bd0e12…", createdAt: "2026-09-26T00:00:00Z", lastUsedAt: null },
];

describe("ApiKeysCard", () => {
  beforeEach(() => {
    state.keys = { data: sampleKeys, isLoading: false, isError: false, refetch: vi.fn() };
  });

  it("lists existing keys with preview, usage and revoke buttons", () => {
    const markup = renderToStaticMarkup(<ApiKeysCard />);
    expect(markup).toContain("Inference API keys");
    expect(markup).toContain("nightly-scripts");
    expect(markup).toContain("nova_sk_9f2a1c44…");
    expect(markup).toContain("playground");
    expect(markup).toContain("never used");
    expect(markup).toContain("Revoke");
    expect(markup).toContain("Rename");
    expect(markup).toContain("Create key");
  });

  it("shows the once-only key banner only after creation, and the API example", () => {
    const markup = renderToStaticMarkup(<ApiKeysCard />);
    expect(markup).not.toContain("Copy this key now");
    expect(markup).toContain("/api/v1/chat/completions");
    expect(markup).toContain("Authorization: Bearer nova_sk_YOUR_KEY");
  });

  it("renders an empty state and a loading state", () => {
    state.keys = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    expect(renderToStaticMarkup(<ApiKeysCard />)).toContain("No API keys yet");
    state.keys = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    expect(renderToStaticMarkup(<ApiKeysCard />)).toContain("Loading keys");
  });
});
