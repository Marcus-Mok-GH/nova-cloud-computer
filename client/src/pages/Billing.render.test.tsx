import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Billing from "./Billing";

const mutation = { mutate: vi.fn(), isPending: false };

/** Swapped per test so both the free and paid views can be rendered. */
const state = vi.hoisted(() => ({
  subscription: {
    data: {
      plan: "free" as "free" | "paid",
      status: "inactive",
      currentPeriodEnd: null as Date | null,
      cancelAtPeriodEnd: false,
      configured: true,
      priceCents: 799,
      currency: "sgd",
      monthlyCredits: {
        plan: "free",
        creditMonth: "2026-11",
        monthlyAllocation: 0,
        balanceCredits: 0,
        usedCreditsThisMonth: 0,
        carriedOverCredits: 0,
        carryOverMonths: 12,
        inputTokens: 0,
        outputTokens: 0,
        creditValueCents: 1,
      },
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
  state.subscription.data.monthlyCredits.monthlyAllocation = 0;
  state.subscription.data.monthlyCredits.balanceCredits = 0;
  state.subscription.data.monthlyCredits.usedCreditsThisMonth = 0;
}

function paidAccount() {
  state.subscription.data.plan = "paid";
  state.subscription.data.currentPeriodEnd = new Date("2026-12-10T00:00:00Z");
  state.subscription.data.monthlyCredits.monthlyAllocation = 10_000;
  state.subscription.data.monthlyCredits.balanceCredits = 7_500;
  state.subscription.data.monthlyCredits.usedCreditsThisMonth = 2_500;
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
    expect(markup).toContain("Nova Pro");
    expect(markup).toContain("Priority");
    expect(markup).toContain("S$7.99");
    expect(markup).toContain("S$4.99");
    // A free account is offered the upgrade rather than a "your plan" chip.
    expect(markup).toContain("Upgrade to Pro");
    expect(markup).toContain("Buy priority");
    expect(markup).not.toContain("Manage subscription");
  });

  it("shows the current plan, credit balance, and manage button for a paid account", () => {
    paidAccount();
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).toContain("Nova Pro");
    expect(markup).toContain("7,500 credits available");
    expect(markup).toContain("2,500 of 10,000 used this month");
    expect(markup).toContain("Manage subscription");
    // The Pro card is now marked as the active plan, not an upgrade.
    expect(markup).toContain("Your plan");
    expect(markup).not.toContain("Upgrade to Pro");
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
