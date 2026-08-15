import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Workspace from "./Workspace";

const state = vi.hoisted(() => ({
  computer: { data: undefined as unknown, isError: false, isLoading: false, refetch: vi.fn() },
}));

const mutation = { mutate: vi.fn(), isPending: false };
const invalidate = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main data-testid="workspace-shell">{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { computer: { useQuery: () => state.computer } },
    folders: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    files: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    chats: { create: { useMutation: () => mutation }, messages: { useQuery: () => ({ data: [], isLoading: false }) }, send: { useMutation: () => mutation } },
    useUtils: () => ({ workspace: { computer: { invalidate } }, chats: { messages: { invalidate } } }),
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/app", vi.fn()] }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const renderWorkspace = () => renderToStaticMarkup(<Workspace />);

describe("Workspace rendered browser states", () => {
  beforeEach(() => {
    state.computer = { data: undefined, isError: false, isLoading: false, refetch: vi.fn() };
  });

  it("renders persisted root folders and files from the workspace computer query", () => {
    state.computer = {
      data: {
        folders: [{ id: 1, name: "Plans", parentId: null }],
        files: [{ id: 2, name: "launch-brief.md", folderId: null, updatedAt: new Date() }],
      },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };

    const markup = renderWorkspace();
    expect(markup).toContain("Plans");
    expect(markup).toContain("launch-brief.md");
    expect(markup).toContain("Workspace folders");
  });

  it("renders loading, empty, and error states for the workspace browser", () => {
    state.computer = { data: undefined, isError: false, isLoading: true, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("Opening your private workspace");

    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("This folder is ready for your work.");

    state.computer = { data: undefined, isError: true, isLoading: false, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("Nova could not open your computer.");
  });
});
