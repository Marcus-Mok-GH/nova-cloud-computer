import { beforeEach, describe, expect, it, vi } from "vitest";

const complete = vi.fn();

class MockNvidiaGatewayClientError extends Error {
  kind: "configuration" | "unavailable" | "rate_limit" | "invalid_response";
  constructor(
    message: string,
    kind: "configuration" | "unavailable" | "rate_limit" | "invalid_response"
  ) {
    super(message);
    this.kind = kind;
  }
}

vi.mock("./nvidiaGateway", () => ({
  completeWithNvidiaGateway: complete,
  NvidiaGatewayClientError: MockNvidiaGatewayClientError,
}));

const { planAutomation } = await import("./automationPlanner");

const validPlan = {
  name: "Daily report",
  frequency: "daily",
  scheduleCron: "0 0 9 * * *",
  scheduleTimezone: "Asia/Singapore",
  scheduleHuman: "Every day at 9am",
  executionPrompt: "Summarize the workspace.",
  args: {},
  definition: {},
  confidence: 0.9,
  needsClarification: false,
  clarificationQuestion: null,
};

describe("planAutomation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("propagates gateway failures immediately without retrying", async () => {
    complete.mockRejectedValue(
      new MockNvidiaGatewayClientError("gateway down", "unavailable")
    );

    await expect(
      planAutomation(7, "Run a daily report at 9am", "Asia/Singapore")
    ).rejects.toThrow("gateway down");

    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("retries only when the returned plan fails to parse", async () => {
    complete
      .mockResolvedValueOnce({ text: "not json at all" })
      .mockResolvedValueOnce({
        text: "still not valid plan structure",
      })
      .mockResolvedValueOnce({ text: JSON.stringify(validPlan) });

    await expect(
      planAutomation(7, "Run a daily report at 9am", "Asia/Singapore")
    ).resolves.toMatchObject({ name: "Daily report" });

    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("does not retry a successful parse", async () => {
    complete.mockResolvedValue({ text: JSON.stringify(validPlan) });

    await expect(
      planAutomation(7, "Run a daily report at 9am", "Asia/Singapore")
    ).resolves.toMatchObject({ name: "Daily report" });

    expect(complete).toHaveBeenCalledTimes(1);
  });
});
