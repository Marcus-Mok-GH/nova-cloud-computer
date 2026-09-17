import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Deployments from "./Deployments";

const state = vi.hoisted(() => ({
  data: {
    configured: true,
    latest: {
      id: 30,
      siteId: "site-1",
      siteName: "nova-live-site",
      siteUrl: "https://nova-live-site.netlify.app",
      status: "live" as string,
      fileCount: 4,
      error: null,
      createdAt: new Date("2026-09-16T12:00:00.000Z"),
      updatedAt: new Date("2026-09-16T12:00:10.000Z"),
    },
    history: [
      {
        id: 30,
        siteId: "site-1",
        siteName: "nova-live-site",
        siteUrl: "https://nova-live-site.netlify.app",
        status: "live",
        fileCount: 4,
        error: null,
        createdAt: new Date("2026-09-16T12:00:00.000Z"),
        updatedAt: new Date("2026-09-16T12:00:10.000Z"),
      },
      {
        id: 29,
        siteId: "site-1",
        siteName: "nova-live-site",
        siteUrl: "https://nova-live-site.netlify.app",
        status: "failed" as string,
        fileCount: 3,
        error: "status 500",
        createdAt: new Date("2026-09-16T10:00:00.000Z"),
        updatedAt: new Date("2026-09-16T10:00:20.000Z"),
      },
    ],
  },
}));

const mutation = { mutate: vi.fn(), isPending: false };
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    deployments: {
      status: { useQuery: () => ({ data: state.data, isLoading: false, isError: false, refetch: vi.fn(), isFetching: false }) },
      deploy: { useMutation: () => mutation },
    },
    useUtils: () => ({ deployments: { status: { invalidate: vi.fn() } } }),
  },
}));

describe("Deployments page", () => {
  beforeEach(() => {
    state.data = {
      ...state.data,
      configured: true,
    };
  });

  it("shows the live website with its URL, redeploy control, and history", () => {
    const markup = renderToStaticMarkup(<Deployments />);
    expect(markup).toContain("Your live website");
    expect(markup).toContain("nova-live-site.netlify.app");
    expect(markup).toContain("Live 24/7");
    expect(markup).toContain("Deploy latest changes");
    expect(markup).toContain("Copy URL");
    expect(markup).toContain("Deployment history");
    expect(markup).toContain("Open website");
  });

  it("asks the operator for the Netlify token when deployments are not configured", () => {
    state.data = { ...state.data, configured: false, latest: null as never, history: [] };
    const markup = renderToStaticMarkup(<Deployments />);
    expect(markup).toContain("NETLIFY_API_TOKEN");
    expect(markup).toContain("Nothing deployed yet");
    expect(markup).not.toContain("Deploy latest changes");
  });

  it("surfaces the failure of the latest deployment", () => {
    state.data = {
      ...state.data,
      latest: { ...state.data.latest!, status: "failed", error: "status 500" } as never,
    };
    const markup = renderToStaticMarkup(<Deployments />);
    expect(markup).toContain("Last deployment failed: status 500");
    expect(markup).toContain("Publish my workspace");
  });
});
