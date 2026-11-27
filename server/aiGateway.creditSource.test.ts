import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which ledger a request is charged to.
 *
 * The bug this pins: a request funded by a BOUGHT bundle used to settle its
 * extra usage against the daily ledger, so the bundle was only charged the
 * one-credit reservation and the rest was billed to an allowance the account
 * was not spending. Bought credits would then last longer than they should.
 *
 * Every tier now spends the same daily ledger (free / plus / pro differ only
 * in the allowance), so there is no monthly branch left to test.
 */
const claimDailyCreditForUser = vi.fn();
const claimPurchasedCreditForUser = vi.fn();
const claimSavingsCreditForUser = vi.fn();
const settleDailyCreditUsageForUser = vi.fn(async () => ({}));
const settleSavingsUsageForUser = vi.fn(async () => ({ charged: 0 }));
const claimInferenceRequestForUser = vi.fn(async () => ({ usedRequests: 1 }));
const getInferenceAllowanceForUser = vi.fn(async () => ({ usedRequests: 0 }));

vi.mock("./db", () => ({
  hasActiveAccessForUser: vi.fn(async () => true),
  claimDailyCreditForUser,
  claimPurchasedCreditForUser,
  claimSavingsCreditForUser,
  settleDailyCreditUsageForUser,
  settleSavingsUsageForUser,
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
  // Savings are the LAST resort, so a mock that returns "a claim" by default
  // would let them pay for a request that the live balances cover.
  claimSavingsCreditForUser.mockResolvedValue(undefined);
  settleSavingsUsageForUser.mockResolvedValue({ charged: 0 });
  // The gateway's readiness probe is a successful /models round-trip, so the
  // fake fetch must answer that as well as the completion.
  process.env.POLLINATIONS_API_KEY = "sk_" + "k".repeat(40);
  process.env.POLLINATIONS_GATEWAY_URL = "";
  global.fetch = vi.fn(async (url: string | URL) =>
    String(url).includes("/models") ? ({ ok: true, json: async () => ({ data: [] }), text: async () => "" } as unknown as Response) : gatewayResponse()
  ) as unknown as typeof fetch;
});

describe("credit funding source", () => {
  it("charges the daily allowance and settles there", async () => {
    claimDailyCreditForUser.mockResolvedValue({ usedCredits: 1, allocatedCredits: 5_000 });
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    expect(settleDailyCreditUsageForUser).toHaveBeenCalled();
    // a bought bundle must not be touched when the allowance can pay
    expect(claimPurchasedCreditForUser).not.toHaveBeenCalled();
  });

  it("falls back to a bought bundle when the daily allowance is empty", async () => {
    claimDailyCreditForUser.mockResolvedValueOnce(undefined);
    claimPurchasedCreditForUser.mockResolvedValue({ purchaseId: 9, remainingCredits: 99 });
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    // the reservation plus the settled remainder come out of bundles (5 - 1 = 4)
    expect(claimPurchasedCreditForUser).toHaveBeenCalledTimes(5);
    // and nothing is billed to the daily ledger it could not pay from
    expect(settleDailyCreditUsageForUser).not.toHaveBeenCalled();
  });

  it("refuses the request when nothing can pay for it", async () => {
    claimDailyCreditForUser.mockResolvedValue(undefined);
    claimPurchasedCreditForUser.mockResolvedValue(undefined);
    await expect(completeWithAiGateway(1, "hello", undefined, undefined, 1_000)).rejects.toMatchObject({
      kind: "credits_exhausted",
    });
  });

  it("stops charging bundles when they run out mid-request", async () => {
    claimDailyCreditForUser.mockResolvedValueOnce(undefined);
    // one credit for the reservation, then the bundle is empty
    claimPurchasedCreditForUser
      .mockResolvedValueOnce({ purchaseId: 1, remainingCredits: 0 })
      .mockResolvedValue(undefined);
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    // it tried the reservation, then gave up rather than looping forever
    expect(claimPurchasedCreditForUser.mock.calls.length).toBeLessThanOrEqual(6);
    expect(settleDailyCreditUsageForUser).not.toHaveBeenCalled();
  });

  it("spends the daily savings only after the daily allowance and the bundles are dry", async () => {
    claimDailyCreditForUser.mockResolvedValue(undefined);
    claimPurchasedCreditForUser.mockResolvedValue(undefined);
    claimSavingsCreditForUser.mockImplementation(async (_ownerId: number, source: string) =>
      source === "daily" ? { remainingCredits: 400 } : undefined
    );
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    expect(claimSavingsCreditForUser).toHaveBeenCalledWith(1, "daily");
    // The paid pot must not be touched while the daily pot still had credits.
    expect(claimSavingsCreditForUser).not.toHaveBeenCalledWith(1, "paid");
  });

  it("spends the paid savings when the daily savings are empty too", async () => {
    claimDailyCreditForUser.mockResolvedValue(undefined);
    claimPurchasedCreditForUser.mockResolvedValue(undefined);
    claimSavingsCreditForUser.mockImplementation(async (_ownerId: number, source: string) =>
      source === "paid" ? { remainingCredits: 400 } : undefined
    );
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    expect(claimSavingsCreditForUser).toHaveBeenCalledWith(1, "daily");
    expect(claimSavingsCreditForUser).toHaveBeenCalledWith(1, "paid");
  });

  it("settles a savings-funded request against the SAME savings balance", async () => {
    claimDailyCreditForUser.mockResolvedValue(undefined);
    claimPurchasedCreditForUser.mockResolvedValue(undefined);
    claimSavingsCreditForUser.mockImplementation(async (_ownerId: number, source: string) =>
      source === "daily" ? { remainingCredits: 400 } : undefined
    );
    settleSavingsUsageForUser.mockResolvedValue({ charged: 4 });
    await completeWithAiGateway(1, "hello", undefined, undefined, 1_000);
    // The reservation took one credit, so 5 - 1 = 4 more come out of savings.
    expect(settleSavingsUsageForUser).toHaveBeenCalledWith(1, "daily", 4);
    // A savings-funded request must not be billed to a ledger that is empty.
    expect(settleDailyCreditUsageForUser).not.toHaveBeenCalled();
  });

  it("refuses the request when the savings are empty as well", async () => {
    claimDailyCreditForUser.mockResolvedValue(undefined);
    claimPurchasedCreditForUser.mockResolvedValue(undefined);
    await expect(completeWithAiGateway(1, "hello", undefined, undefined, 1_000)).rejects.toMatchObject({
      kind: "credits_exhausted",
    });
    expect(claimSavingsCreditForUser).toHaveBeenCalledWith(1, "daily");
    expect(claimSavingsCreditForUser).toHaveBeenCalledWith(1, "paid");
  });
});
