import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatMock, FakeAiGatewayClientError } = vi.hoisted(() => {
  class FakeAiGatewayClientError extends Error {
    constructor(
      message: string,
      public readonly kind:
        | "configuration"
        | "unavailable"
        | "rate_limit"
        | "allowance_reached"
        | "credits_exhausted"
        | "invalid_response"
        | "client_error"
        | "stopped"
    ) {
      super(message);
      this.name = "AiGatewayClientError";
    }
  }
  return {
    chatMock: vi.fn(),
    FakeAiGatewayClientError,
  };
});

vi.mock("./aiGateway", () => ({
  AiGatewayClientError: FakeAiGatewayClientError,
  chatWithPublicAiGateway: chatMock,
}));

const {
  answerSupportQuestion,
  checkSupportBotRateLimit,
  normalizeSupportMessages,
  resetSupportBotRateLimits,
  supportClientKey,
  SupportBotError,
} = await import("./supportBot");

beforeEach(() => {
  vi.clearAllMocks();
  resetSupportBotRateLimits();
  delete process.env.NOVA_SUPPORT_BOT_DAILY_LIMIT;
});

describe("normalizeSupportMessages", () => {
  it("trims turns and keeps only the most recent history", () => {
    const history = Array.from({ length: 14 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `  turn ${index}  `,
    }));
    history.push({ role: "user", content: "  final question  " });

    const normalized = normalizeSupportMessages(history);
    expect(normalized).toHaveLength(12);
    expect(normalized[normalized.length - 1]).toEqual({
      role: "user",
      content: "final question",
    });
    expect(
      normalized.every(message => message.content === message.content.trim())
    ).toBe(true);
  });

  it("requires a final user question and rejects empty or oversized turns", () => {
    expect(() => normalizeSupportMessages([])).toThrow(SupportBotError);
    expect(() =>
      normalizeSupportMessages([{ role: "assistant", content: "Hi" }])
    ).toThrow(/Ask a question/);
    expect(() =>
      normalizeSupportMessages([{ role: "user", content: "   " }])
    ).toThrow(SupportBotError);
    expect(() =>
      normalizeSupportMessages([{ role: "user", content: "x".repeat(2_001) }])
    ).toThrow(/under 2000 characters/);
  });
});

describe("supportClientKey", () => {
  it("hashes the caller identity instead of storing a raw address", () => {
    const key = supportClientKey({
      headers: { "x-real-ip": "203.0.113.7" },
      ip: "127.0.0.1",
    });
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(key).not.toContain("203.0.113.7");
    expect(supportClientKey({ headers: { "x-real-ip": "203.0.113.7" } })).toBe(
      key
    );
    expect(
      supportClientKey({ headers: { "x-real-ip": "203.0.113.8" } })
    ).not.toBe(key);
  });
});

describe("checkSupportBotRateLimit", () => {
  it("allows a short burst, then blocks until the window resets", () => {
    const start = 1_000_000;
    for (let index = 0; index < 12; index += 1) {
      expect(() => checkSupportBotRateLimit("client", start)).not.toThrow();
    }
    expect(() => checkSupportBotRateLimit("client", start)).toThrow(
      /asking faster/
    );
    // A different client is unaffected.
    expect(() => checkSupportBotRateLimit("other", start)).not.toThrow();
    // The bucket expires after ten minutes.
    expect(() =>
      checkSupportBotRateLimit("client", start + 10 * 60_000 + 1)
    ).not.toThrow();
  });

  it("enforces the optional daily ceiling", () => {
    process.env.NOVA_SUPPORT_BOT_DAILY_LIMIT = "1";
    const now = 2_000_000;
    expect(() => checkSupportBotRateLimit("first", now)).not.toThrow();
    expect(() => checkSupportBotRateLimit("second", now)).toThrow(
      /resting for a bit/
    );
  });
});

describe("answerSupportQuestion", () => {
  it("adds the server-owned brief and returns the model answer", async () => {
    chatMock.mockResolvedValue({
      text: "  Nova is a cloud computer.  ",
      model: "test",
    });

    const answer = await answerSupportQuestion(
      [{ role: "user", content: "What is Nova?" }],
      "client"
    );

    expect(answer).toBe("Nova is a cloud computer.");
    expect(chatMock).toHaveBeenCalledTimes(1);
    const [messages, options] = chatMock.mock.calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("persistent cloud computer");
    expect(messages[1]).toEqual({ role: "user", content: "What is Nova?" });
    expect(options).toMatchObject({ maxTokens: 600 });
  });

  it("maps gateway throttling to a retryable public error without leaking details", async () => {
    chatMock.mockRejectedValue(
      new FakeAiGatewayClientError("provider quota secret", "rate_limit")
    );

    await expect(
      answerSupportQuestion([{ role: "user", content: "Hello" }], "client")
    ).rejects.toMatchObject({
      kind: "rate_limit",
      message: "The assistant is busy right now. Please try again in a moment.",
    });
  });

  it("maps unexpected gateway failures to a curated unavailable error", async () => {
    chatMock.mockRejectedValue(
      new FakeAiGatewayClientError("upstream leaked detail", "configuration")
    );

    await expect(
      answerSupportQuestion([{ role: "user", content: "Hello" }], "client")
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
});
