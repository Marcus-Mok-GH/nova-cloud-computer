import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which ledger a request is charged to.
 *
 * The bug this pins: a request funded by a BOUGHT bundle used to settle its
 * extra usage against the daily/monthly ledger, so the bundle was only charged
 * the one-credit reservation and the rest was billed to a pool the account was
 * not spending. Bought credits would then last longer than they should.
 */
const claimDailyCreditForUser = vi.fn();
const claimMonthlyCreditForUser = vi.fn();
const claimPurchasedCreditForUser = vi.fn();
const isPaidPlanForUser = vi.fn();
const settleDailyCreditUsageForUser = vi.fn(async () => ({}));
const settleMonthlyCreditUsageForUser = vi.fn(async () => ({}));
const claimInferenceRequestForUser = vi.fn(async () => ({ usedRequests: 1 }));
const getInferenceAllowanceForUser = vi.fn(async () => ({ usedRequests: 0 }));

vi.mock("./db", () => ({
  hasActiveAccessForUser: vi.fn(async () => true),
  claimDailyCreditForUser,
  claimMonthlyCreditForUser,
  claimPurchasedCreditForUser,
  isPaidPlanForUser,
  settleDailyCreditUsageForUser,
  settleMonthlyCreditUsageForUser,
  claimInferenceRequestForUser,
  getInferenceAllowanceForUser,
  getChatModelForUser: vi.fn(async () => null),
  setChatModelForUser: vi.fn(),
  getUserRole: vi.fn(async () => "user"),
}));

vi.mock("./credits", async () => {
  const actual = await vi.importActual<typeof import("./credits")>("./credits");
  return {
    ...actual,
    calculateInferenceCredits: vi.fn(() => 5),
  };
});

const { completeWithAiGateway } = await import("./aiGateway");

/** A `/models` health probe, then the completion itself. */
function gatewayResponse() {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "hi" } }],
      model: "nova-lite",
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
    text: async () => "",
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  claimInferenceRequestForUser.mockResolvedValue({ usedRequests: 1 });
  // The gateway's readiness probe is a successful /models round-trip, so the
  // fake fetch must answer that as well as the completion.
  process.env.POLLINATIONS_API_KEY = "sk_" + "k".repeat(40);
  process.env.POLLINATIONS_GATEWAY_URL = "";
  global.fetch = vi.fn(async (url: string | URL) =>
    String(url).includes("/models") ? ({ ok: true, json: async () => ({ data: [] }), text: async () => "" } as unknown as Response) : gatewayResponse()
  ) as unknown as typeof fetch;
});

describe("credit funding source", () => {
  it("charges a paid account's monthly pool and settles there", async () => {
    isPaidPlanForUser.mockResolvedValue(true);
    claimMonthlyCreditForUser.mockResolvedValue({ creditMonth: "2026-11", usedCredits: 1, allocatedCredits: 10_000 });
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    expect(settleMonthlyCreditUsageForUser).toHaveBeenCalled();
    expect(settleDailyCreditUsageForUser).not.toHaveBeenCalled();
    // a bought bundle must not be touched when the pool can pay
    expect(claimPurchasedCreditForUser).not.toHaveBeenCalled();
  });

  it("falls back to a bought bundle when the monthly pool is empty", async () => {
    isPaidPlanForUser.mockResolvedValue(true);
    claimMonthlyCreditForUser.mockResolvedValueOnce(undefined);
    claimPurchasedCreditForUser.mockResolvedValue({ purchaseId: 9, remainingCredits: 99 });
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    // the reservation plus the settled remainder come out of bundles (5 - 1 = 4)
    expect(claimPurchasedCreditForUser).toHaveBeenCalledTimes(5);
    // and nothing is billed to the monthly pool it could not pay from
    expect(settleMonthlyCreditUsageForUser).not.toHaveBeenCalled();
    expect(settleDailyCreditUsageForUser).not.toHaveBeenCalled();
  });

  it("charges a free account's daily allowance and settles there", async () => {
    isPaidPlanForUser.mockResolvedValue(false);
    claimDailyCreditForUser.mockResolvedValue({ usedCredits: 1, allocatedCredits: 500 });
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    expect(settleDailyCreditUsageForUser).toHaveBeenCalled();
    expect(settleMonthlyCreditUsageForUser).not.toHaveBeenCalled();
    expect(claimPurchasedCreditForUser).not.toHaveBeenCalled();
  });

  it("falls back to a bought bundle when the daily allowance is empty", async () => {
    isPaidPlanForUser.mockResolvedValue(false);
    claimDailyCreditForUser.mockResolvedValueOnce(undefined);
    claimPurchasedCreditForUser.mockResolvedValue({ purchaseId: 3, remainingCredits: 10 });
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    expect(claimPurchasedCreditForUser).toHaveBeenCalledTimes(5);
    expect(settleDailyCreditUsageForUser).not.toHaveBeenCalled();
  });

  it("refuses the request when nothing can pay for it", async () => {
    isPaidPlanForUser.mockResolvedValue(false);
    claimDailyCreditForUser.mockResolvedValue(undefined);
    claimPurchasedCreditForUser.mockResolvedValue(undefined);
    await expect(completeWithAiGateway(1, "hello", undefined, undefined, 1_000)).rejects.toMatchObject({
      kind: "credits_exhausted",
    });
  });

  it("stops charging bundles when they run out mid-request", async () => {
    isPaidPlanForUser.mockResolvedValue(true);
    claimMonthlyCreditForUser.mockResolvedValueOnce(undefined);
    // one credit for the reservation, then the bundle is empty
    claimPurchasedCreditForUser
      .mockResolvedValueOnce({ purchaseId: 1, remainingCredits: 0 })
      .mockResolvedValue(undefined);
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    // it tried the reservation, then gave up rather than looping forever
    expect(claimPurchasedCreditForUser.mock.calls.length).toBeLessThanOrEqual(6);
    expect(settleMonthlyCreditUsageForUser).not.toHaveBeenCalled();
  });
});