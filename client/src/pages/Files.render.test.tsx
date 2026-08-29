import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Files from "./Files";

const state = vi.hoisted(() => ({
  computer: { data: undefined as unknown, isError: false, isLoading: false, refetch: vi.fn() },
}));

const mutation = { mutate: vi.fn(), isPending: false };
const invalidate = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main data-testid="files-shell">{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { computer: { useQuery: () => state.computer } },
    folders: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    files: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    useUtils: () => ({ workspace: { computer: { invalidate } } }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const renderFiles = () => renderToStaticMarkup(<Files />);

describe("Files page", () => {
  beforeEach(() => {
    state.computer = { data: undefined, isError: false, isLoading: false, refetch: vi.fn() };
  });

  it("shows workspace folders and files in the dedicated Files view", () => {
    state.computer = {
      data: {
        folders: [{ id: 1, name: "Plans", parentId: null }],
        files: [{ id: 2, name: "launch-brief.md", folderId: null, updatedAt: new Date() }],
      },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };

    const markup = renderFiles();
    expect(markup).toContain("Explorer");
    expect(markup).toContain("Plans");
    expect(markup).toContain("launch-brief.md");
    expect(markup).toContain("New folder");
    expect(markup).toContain("New file");
  });

  it("shows an empty state when the active Files folder has no contents", () => {
    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    expect(renderFiles()).toContain("Select a file from the Explorer to open it.");
  });

  it("shows a recoverable error state", () => {
    state.computer = { data: undefined, isError: true, isLoading: false, refetch: vi.fn() };
    expect(renderFiles()).toContain("Nova could not open your files.");
  });
});
