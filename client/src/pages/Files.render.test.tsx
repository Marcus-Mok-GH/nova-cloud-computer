import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Files, { FileSearchResults } from "./Files";

const state = vi.hoisted(() => ({
  computer: { data: undefined as unknown, isError: false, isLoading: false, refetch: vi.fn() },
  search: { data: [] as unknown, isLoading: false, isFetching: false, isError: false, error: null as Error | null },
}));

const mutation = { mutate: vi.fn(), isPending: false };
const invalidate = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main data-testid="files-shell">{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { computer: { useQuery: () => state.computer } },
    folders: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    files: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation }, search: { useQuery: () => state.search } },
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
    expect(markup).toContain("Search workspace files");
    expect(markup).toContain("Plans");
    expect(markup).toContain("launch-brief.md");
    expect(markup).toContain("New folder");
    expect(markup).toContain("New file");
    // VS Code style explorer header actions
    expect(markup).toContain("Collapse folders");
    // rows are compact VS Code style tree rows
    expect(markup).toContain("h-[26px]");
    // The shell owns a definite viewport height so the flex-1 editor gets a
    // usable typing area even though the dashboard main has no fixed height on
    // phones (it is min-h-svh below md).
    expect(markup).toContain("h-[calc(100svh-5rem)]");
    expect(markup).toContain("md:h-full");
  });

  it("shows an empty state when the active Files folder has no contents", () => {
    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    expect(renderFiles()).toContain("Select a file from the Explorer to open it.");
  });

  it("shows a recoverable error state", () => {
    state.computer = { data: undefined, isError: true, isLoading: false, refetch: vi.fn() };
    expect(renderFiles()).toContain("Nova could not open your files.");
  });

  it("renders search results with folder trail and highlighted snippets", () => {
    const markup = renderToStaticMarkup(
      <FileSearchResults
        results={[{ id: 2, name: "launch-brief.md", folderId: 1, mimeType: "text/markdown", matchedName: true, matchCount: 1, snippets: [{ line: 4, text: "Launch date: Friday" }], score: 1001 }]}
        loading={false}
        error={null}
        query="launch"
        regex={false}
        folders={[{ id: 1, name: "Plans", parentId: null }]}
        files={[{ id: 2, name: "launch-brief.md", content: "x", folderId: 1 }]}
        onOpen={vi.fn()}
      />,
    );
    expect(markup).toContain("launch-brief.md");
    expect(markup).toContain("Plans");
    expect(markup).toContain("1 match");
    expect(markup).toContain("<mark");
    expect(markup).toContain("Launch");
  });

  it("explains an empty or failed search", () => {
    const base = { results: [], loading: false, error: null, query: "zed", regex: false, folders: [], files: [], onOpen: vi.fn() };
    expect(renderToStaticMarkup(<FileSearchResults {...base} />)).toContain("No files match");
    expect(renderToStaticMarkup(<FileSearchResults {...base} error="Nova could not search your files." />)).toContain("Nova could not search your files.");
  });
});
