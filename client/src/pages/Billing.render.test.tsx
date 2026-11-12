import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Billing from "./Billing";

const mutation = { mutate: vi.fn(), isPending: false };

/** Swapped per test so every tier's view can be rendered. */
const state = vi.hoisted(() => ({
  subscription: {
    data: {
      plan: "free" as "free" | "plus" | "paid",
      status: "inactive",
      currentPeriodEnd: null as Date | null,
      cancelAtPeriodEnd: false,
      configured: true,
      priceCents: 799,
      currency: "sgd",
      proAccess: false,
      accessActive: true,
      trialEndsAt: null as Date | null,
      creditTopUps: { remainingCredits: 0, activeBundles: 0, purchasedCredits: 0 },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  /** The daily allowance chip - every tier now draws from this ledger. */
  credits: {
    data: {
      region: "global",
      creditDay: "2026-11-12",
      unlimited: false,
      dailyCredits: 500,
      usedCredits: 0,
      inputTokens: 0,
      outputTokens: 0,
      remainingCredits: 500,
      creditValueCents: 1,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  priority: {
    data: {
      priority: false,
      armed: false,
      purchasedAt: null as Date | null,
      activatedAt: null as Date | null,
      expiresAt: null as Date | null,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    billing: {
      subscription: { useQuery: () => state.subscription },
      status: { useQuery: () => state.priority },
      purchasePriority: { useMutation: () => mutation },
      portal: { useMutation: () => mutation },
    },
    credits: {
      status: { useQuery: () => state.credits },
    },
    useUtils: () => ({ billing: { status: { invalidate: vi.fn() } } }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("wouter", () => ({ useLocation: () => ["/app/billing", vi.fn()] }));

function freeAccount() {
  state.subscription.data.plan = "free";
  state.subscription.data.currentPeriodEnd = null;
  state.subscription.data.proAccess = false;
  state.credits.data.dailyCredits = 500;
  state.credits.data.remainingCredits = 500;
}

function plusAccount() {
  state.subscription.data.plan = "plus";
  state.subscription.data.currentPeriodEnd = new Date("2026-12-10T00:00:00Z");
  state.subscription.data.proAccess = false;
  state.credits.data.dailyCredits = 5_000;
  state.credits.data.remainingCredits = 4_250;
}

function paidAccount() {
  state.subscription.data.plan = "paid";
  state.subscription.data.currentPeriodEnd = new Date("2026-12-10T00:00:00Z");
  state.subscription.data.proAccess = true;
  state.credits.data.dailyCredits = 10_000;
  state.credits.data.remainingCredits = 8_750;
}

describe("Billing page", () => {
  beforeEach(() => {
    freeAccount();
    state.priority.data.priority = false;
    state.priority.data.armed = false;
  });

  it("lists every buyable plan for a free account", () => {
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).toContain("Plans &amp; credits");
    expect(markup).toContain("Nova Plus");
    expect(markup).toContain("Nova Pro");
    expect(markup).toContain("Priority");
    expect(markup).toContain("S$7.99");
    expect(markup).toContain("S$4.99");
    // A free account is offered the upgrades rather than "your plan" chips.
    expect(markup).toContain("Upgrade to Plus");
    expect(markup).toContain("Upgrade to Pro");
    expect(markup).toContain("Buy priority");
    expect(markup).not.toContain("Manage subscription");
  });

  it("shows the current plan, today's credit balance, and manage button for a paid account", () => {
    paidAccount();
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).toContain("Nova Pro");
    expect(markup).toContain("8,750 credits available");
    expect(markup).toContain("Manage subscription");
    // The Pro card is now marked as the active plan, not an upgrade.
    expect(markup).toContain("Your plan");
    expect(markup).not.toContain("Upgrade to Pro");
  });

  it("shows Plus as the current tier with its own management, but not Pro", () => {
    plusAccount();
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).toContain("Nova Plus");
    expect(markup).toContain("4,250 credits available");
    // Plus is a subscription, so its own card reads as the active plan...
    expect(markup).toContain("Your plan");
    expect(markup).not.toContain("Upgrade to Plus");
    // ...and its Whop membership can be managed like Pro's.
    expect(markup).toContain("Manage subscription");
    // But it is not Pro: the Pro card stays an upgrade.
    expect(markup).toContain("Upgrade to Pro");
  });

  it("marks an active priority window instead of offering the purchase again", () => {
    state.priority.data.priority = true;
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).toContain("Priority active");
    expect(markup).not.toContain("Buy priority");
  });

  it("renders only a spinner while the subscription query is loading", () => {
    state.subscription.isLoading = true;
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).not.toContain("Upgrade to Pro");
    expect(markup).not.toContain("Plans &amp; credits");
    state.subscription.isLoading = false;
  });
});
