import { describe, expect, it, vi } from "vitest";
import { discoverTelegramChat, sendTelegramMessage, validateTelegramBotToken } from "./telegram";

function telegramResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Telegram Bot API client", () => {
  it("validates a bot token through getMe without exposing it in the result", async () => {
    const fetchImpl = vi.fn(async () => telegramResponse({ ok: true, result: { id: 12, username: "nova_test_bot", first_name: "Nova Test" } }));
    await expect(validateTelegramBotToken("123:secret-token", fetchImpl)).resolves.toEqual({ id: "12", username: "nova_test_bot", displayName: "Nova Test" });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/getMe"), expect.objectContaining({ method: "POST" }));
  });

  it("discovers the most recent private or channel destination from updates", async () => {
    const fetchImpl = vi.fn(async () => telegramResponse({ ok: true, result: [{ message: { chat: { id: 42 } } }, { channel_post: { chat: { id: -10077 } } }] }));
    await expect(discoverTelegramChat("token", fetchImpl)).resolves.toBe("-10077");
  });

  it("sends a bounded message to the configured chat and reports Telegram failures", async () => {
    const successFetch = vi.fn(async () => telegramResponse({ ok: true, result: { message_id: 9 } }));
    await expect(sendTelegramMessage("token", "42", "Hello from Nova", successFetch)).resolves.toEqual({ message_id: 9 });
    expect(successFetch).toHaveBeenCalledWith(expect.stringContaining("/sendMessage"), expect.objectContaining({ body: expect.stringContaining('"chat_id":"42"') }));
    const failureFetch = vi.fn(async () => telegramResponse({ ok: false, description: "Bad Request: chat not found" }, 400));
    await expect(sendTelegramMessage("token", "42", "Hello", failureFetch)).rejects.toThrow("chat not found");
  });
});
