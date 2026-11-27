import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
  /** The two savings balances - one per credit source. */
  savings: {
    data: {
      daily: { savedCredits: 0, remainingCredits: 0, expiresAt: null as Date | null },
      paid: { savedCredits: 0, remainingCredits: 0, expiresAt: null as Date | null },
      dailyAvailable: 500,
      paidAvailable: 0,
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
      savings: { useQuery: () => state.savings },
      setAside: { useMutation: () => mutation },
    },
    useUtils: () => ({
      billing: { status: { invalidate: vi.fn() } },
      credits: {
        status: { invalidate: vi.fn() },
        savings: { invalidate: vi.fn() },
      },
    }),
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
  state.credits.data.unlimited = false;
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

/** A console operator: the role grants Pro access, so no subscription exists. */
function operatorAccount() {
  state.subscription.data.plan = "free";
  state.subscription.data.currentPeriodEnd = null;
  state.subscription.data.proAccess = true;
  state.credits.data.unlimited = true;
}

describe("Billing hook order", () => {
  it("calls every hook before the loading/error early returns", () => {
    // React error #310 ("Rendered more hooks than during the previous
    // render") shipped to production because the credits.status query was
    // added *after* the early returns: the first paint (loading) skipped it,
    // and the re-render carrying data added it. renderToStaticMarkup builds
    // a fresh instance per call, so it cannot see a hook-count change - this
    // asserts the rule at the source level instead.
    const source = readFileSync(
      new URL("./Billing.tsx", import.meta.url),
      "utf8"
    );
    const body = source.slice(
      source.indexOf("export default function Billing()")
    );
    const firstReturn = body.search(/\breturn\b/);
    expect(firstReturn).toBeGreaterThan(-1);
    const afterFirstReturn = body.slice(firstReturn);
    for (const hook of [
      "useQuery(",
      "useMutation(",
      "useState(",
      "useEffect(",
    ]) {
      expect(
        afterFirstReturn.includes(hook),
        `${hook} is called after an early return in Billing.tsx`
      ).toBe(false);
    }
  });
});

describe("Billing page", () => {
  beforeEach(() => {
    freeAccount();
    state.priority.data.priority = false;
    state.priority.data.armed = false;
    state.savings.data.daily = { savedCredits: 0, remainingCredits: 0, expiresAt: null };
    state.savings.data.paid = { savedCredits: 0, remainingCredits: 0, expiresAt: null };
    state.savings.data.dailyAvailable = 500;
    state.savings.data.paidAvailable = 0;
  });

  it("lists every buyable plan for a free account", () => {
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).toContain("Plans &amp; balance");
    expect(markup).toContain("Nova Plus");
    expect(markup).toContain("Nova Pro");
    expect(markup).toContain("Priority");
    expect(markup).toContain("$7.99");
    expect(markup).toContain("$4.99");
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
    expect(markup).toContain("$8.75 available");
    expect(markup).toContain("Manage subscription");
    // The Pro card is now marked as the active plan, not an upgrade.
    expect(markup).toContain("Your plan");
    expect(markup).not.toContain("Upgrade to Pro");
  });

  it("reads an operator's role grant as the Admin tier with unlimited credits", () => {
    operatorAccount();
    const markup = renderToStaticMarkup(<Billing />);
    // The header badge reads Admin for this account, so this page must too.
    expect(markup).toContain("Admin");
    expect(markup).toContain("Included with your operator access.");
    // A developer's ledger is unlimited - never "Free", and never a zero balance.
    expect(markup).toContain("Unlimited");
    expect(markup).toContain("No daily cap - every premium model is unlocked.");
    expect(markup).not.toContain("You are on the free plan.");
    expect(markup).not.toContain("credits available");
    // There is no Whop membership to manage, and Pro is already held.
    expect(markup).not.toContain("Manage subscription");
    expect(markup).toContain("Your plan");
    expect(markup).toContain("Included");
  });

  it("shows Plus as the current tier with its own management, but not Pro", () => {
    plusAccount();
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).toContain("Nova Plus");
    expect(markup).toContain("$4.25 available");
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

  it("shows the two savings balances separately", () => {
    state.savings.data.daily.remainingCredits = 250;
    state.savings.data.paid.remainingCredits = 5_000;
    state.savings.data.dailyAvailable = 250;
    state.savings.data.paidAvailable = 5_000;
    const markup = renderToStaticMarkup(<Billing />);
    // Two distinct pots, not one blended number.
    expect(markup).toContain("Daily savings");
    expect(markup).toContain("Paid savings");
    expect(markup).toContain("$0.25 set aside");
    expect(markup).toContain("$5.00 set aside");
  });

  it("shows the daily balance's expiry, and never one for the paid pot", () => {
    state.savings.data.daily.remainingCredits = 250;
    state.savings.data.daily.expiresAt = new Date("2026-11-29T00:00:00.000Z");
    state.savings.data.paid.remainingCredits = 5_000;
    const markup = renderToStaticMarkup(<Billing />);
    // The deadline is a 00:00 UTC boundary, so it is rendered in UTC.
    expect(markup).toContain("Expires");
    expect(markup).toContain("00:00 UTC");
    expect(markup).toContain("Nov 29");
    // Bought credits never expire, so the paid pot shows no deadline.
    expect(markup.match(/Expires/g)).toHaveLength(1);
  });

  it("shows no expiry while the daily balance is empty", () => {
    state.savings.data.daily.remainingCredits = 0;
    state.savings.data.daily.expiresAt = null;
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).not.toContain("Expires");
  });

  it("offers the daily set-aside control but not one for an unlimited ledger", () => {
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).toContain("Set aside");
    operatorAccount();
    state.savings.data.dailyAvailable = 0;
    const unlimitedMarkup = renderToStaticMarkup(<Billing />);
    expect(unlimitedMarkup).toContain("no daily allowance to set aside");
  });

  it("renders only a spinner while the subscription query is loading", () => {
    state.subscription.isLoading = true;
    const markup = renderToStaticMarkup(<Billing />);
    expect(markup).not.toContain("Upgrade to Pro");
    expect(markup).not.toContain("Plans &amp; balance");
    state.subscription.isLoading = false;
  });
});
