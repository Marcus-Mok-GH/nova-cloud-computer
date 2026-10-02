import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import BillingCard, { formatPriorityRemaining } from "./BillingCard";

const { expiresAt, purchasedAt } = vi.hoisted(() => {
  const now = Date.now();
  return {
    expiresAt: new Date(now + 45 * 60 * 1000),
    purchasedAt: new Date(now - 15 * 60 * 1000),
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    billing: {
      status: {
        useQuery: () => ({
          data: {
            priority: true,
            armed: false,
            purchasedAt,
            activatedAt: purchasedAt,
            expiresAt,
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      purchasePriority: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ billing: { status: { invalidate: vi.fn() } } }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("formatPriorityRemaining", () => {
  it("formats sub-hour time as MM:SS", () => {
    expect(formatPriorityRemaining(0)).toBe("00:00");
    expect(formatPriorityRemaining(59_000)).toBe("00:59");
    expect(formatPriorityRemaining(60_000)).toBe("01:00");
    expect(formatPriorityRemaining(59 * 60_000 + 59_000)).toBe("59:59");
  });

  it("formats an hour or more as H:MM:SS", () => {
    expect(formatPriorityRemaining(60 * 60_000)).toBe("1:00:00");
    expect(formatPriorityRemaining(61 * 60_000 + 1000)).toBe("1:01:01");
  });

  it("clamps negative time to zero", () => {
    expect(formatPriorityRemaining(-5000)).toBe("00:00");
  });
});

describe("BillingCard countdown", () => {
  it("shows a live remaining-time countdown while priority is active", () => {
    const markup = renderToStaticMarkup(<BillingCard />);
    expect(markup).toContain("Priority active for another");
    expect(markup).toContain("priority-countdown");
    expect(markup).toMatch(/\d{2}:\d{2}/);
    // An active window never offers the buy button.
    expect(markup).not.toContain("Buy 1 hour of priority");
  });
});
