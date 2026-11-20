// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let mockUser: {
  id: number;
  name: string;
  email: string;
  username: string | null;
  role: "user" | "admin" | "developer";
} = { id: 1, name: "Test", email: "t@t.com", username: null, role: "user" };
let mockOnboarding = {
  completed: true,
  source: null,
  useCase: null,
  experience: null,
  country: null,
  needsCountry: false,
};

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ loading: false, user: mockUser, logout: vi.fn() }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      setUsername: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      onboarding: { useQuery: () => ({ data: mockOnboarding }) },
    },
    workspace: {
      computer: {
        useQuery: () => ({ data: { chats: [], files: [] } }),
      },
    },
    credits: {
      status: { useQuery: () => ({ data: { remainingCredits: 500, dailyCredits: 500, creditValueCents: 1 } }) },
    },
    billing: { subscription: { useQuery: () => ({ data: { plan: "free", proAccess: false } }) } },
    admin: { apiErrorLogs: { useQuery: () => ({ data: [] }) } },
    useUtils: () => ({ workspace: { computer: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/app", vi.fn()],
  useSearch: () => "",
}));
// The dialogs are mocked to markers: what this file pins is WHICH of them the
// layout opens, and a Radix portal emits nothing under jsdom anyway.
vi.mock("./UsernamePrompt", async () => {
  const { createElement } = await import("react");
  return { UsernamePrompt: () => createElement("div", null, "username prompt") };
});
vi.mock("./OnboardingModal", async () => {
  const { createElement } = await import("react");
  return { OnboardingModal: () => createElement("div", null, "onboarding modal") };
});
vi.mock("./CountryPromptModal", async () => {
  const { createElement } = await import("react");
  return { CountryPromptModal: () => createElement("div", null, "country prompt") };
});
vi.mock("./OnboardingFlow", async () => {
  const { createElement } = await import("react");
  return {
    OnboardingFlow: () => createElement("div", null, "first-run flow"),
    ONBOARDING_FLOW_SEEN_KEY: "nova.onboardingFlow.v1",
  };
});

import DashboardLayout from "./DashboardLayout";

describe("DashboardLayout first-run flow gating", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
  });

  const mount = async () => {
    await act(async () => {
      root?.render(
        <DashboardLayout>
          <div>content</div>
        </DashboardLayout>
      );
    });
    // The auto-open decision runs in an effect; flush it.
    await act(async () => {
      await Promise.resolve();
    });
  };

  it("waits for the username claim instead of stacking the flow on it", async () => {
    mockUser = { id: 1, name: "Test", email: "t@t.com", username: null, role: "user" };
    mockOnboarding = { completed: true, source: null, useCase: null, experience: null, country: null, needsCountry: false };
    await mount();
    expect(container?.textContent).toContain("username prompt");
    expect(container?.textContent).not.toContain("first-run flow");
  });

  it("opens the flow once the account has a username", async () => {
    mockUser = { id: 1, name: "Test", email: "t@t.com", username: "test", role: "user" };
    mockOnboarding = { completed: true, source: null, useCase: null, experience: null, country: null, needsCountry: false };
    await mount();
    expect(container?.textContent).toContain("first-run flow");
    expect(container?.textContent).not.toContain("username prompt");
  });

  it("opens the flow when the username prompt was skipped this session", async () => {
    window.sessionStorage.setItem("nova.username.prompt.skipped", "1");
    mockUser = { id: 1, name: "Test", email: "t@t.com", username: null, role: "user" };
    mockOnboarding = { completed: true, source: null, useCase: null, experience: null, country: null, needsCountry: false };
    await mount();
    expect(container?.textContent).toContain("first-run flow");
    expect(container?.textContent).not.toContain("username prompt");
  });

  it("never stacks the flow on the profile questionnaire or the country prompt", async () => {
    mockUser = { id: 1, name: "Test", email: "t@t.com", username: "test", role: "user" };
    mockOnboarding = { completed: false, source: null, useCase: null, experience: null, country: null, needsCountry: false };
    await mount();
    expect(container?.textContent).toContain("onboarding modal");
    expect(container?.textContent).not.toContain("first-run flow");

    window.localStorage.clear();
    mockOnboarding = { completed: true, source: null, useCase: null, experience: null, country: null, needsCountry: true };
    await act(async () => {
      root?.render(
        <DashboardLayout>
          <div>content</div>
        </DashboardLayout>
      );
    });
    expect(container?.textContent).toContain("country prompt");
    expect(container?.textContent).not.toContain("first-run flow");
  });
});
