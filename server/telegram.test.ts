import { describe, expect, it, vi } from "vitest";
import { configureTelegramWebhook, discoverTelegramChat, getTelegramWebhookInfo, presentTelegramFile, sendTelegramMessage, validateTelegramBotToken } from "./telegram";

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

  it("registers an HTTPS callback that embeds the bot token without exposing it in the result", async () => {
    const fetchImpl = vi.fn(async () => telegramResponse({ ok: true, result: true }));
    const result = await configureTelegramWebhook("123:secret", "https://nova.example.com", fetchImpl);
    expect(result.webhookUrl).toBe("https://nova.example.com/api/telegram/webhook/123%3Asecret");
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/setWebhook"), expect.objectContaining({ body: expect.stringContaining("webhook/123%3Asecret") }));
  });

  it("rejects a non-HTTPS callback target like Telegram would", async () => {
    const fetchImpl = vi.fn(async () => telegramResponse({ ok: true, result: true }));
    await expect(configureTelegramWebhook("123:secret", "http://nova.example.com", fetchImpl)).rejects.toThrow("public HTTPS URL");
  });

  it("presents a text file as a downloadable document", async () => {
    const fetchImpl = vi.fn(async () => telegramResponse({ ok: true, result: { message_id: 31 } }));
    const result = await presentTelegramFile("token", "42", { name: "notes.txt", content: "hello world", mimeType: "text/plain" }, "Your notes", fetchImpl);
    expect(result).toEqual({ messageId: 31, as: "document" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/sendDocument");
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("chat_id")).toBe("42");
    expect(body.get("caption")).toBe("Your notes");
    const document = body.get("document") as File;
    expect(document.name).toBe("notes.txt");
  });

  it("shows inline images for viewing, decoding data URIs", async () => {
    const fetchImpl = vi.fn(async () => telegramResponse({ ok: true, result: { message_id: 32 } }));
    const result = await presentTelegramFile("token", "42", { name: "chart.png", content: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" }, undefined, fetchImpl);
    expect(result).toEqual({ messageId: 32, as: "photo" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/sendPhoto");
    const photo = (init.body as FormData).get("photo") as File;
    expect(photo.name).toBe("chart.png");
    expect(photo.type).toBe("image/png");
  });

  it("passes hosted image URLs straight to Telegram", async () => {
    const fetchImpl = vi.fn(async () => telegramResponse({ ok: true, result: { message_id: 33 } }));
    const result = await presentTelegramFile("token", "42", { name: "logo.png", content: "https://example.com/logo.png", mimeType: "image/png" }, undefined, fetchImpl);
    expect(result).toEqual({ messageId: 33, as: "photo" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/sendPhoto");
    expect(String(init.body)).toContain("https://example.com/logo.png");
  });

  it("falls back to a document when image content is not decodable", async () => {
    const fetchImpl = vi.fn(async () => telegramResponse({ ok: true, result: { message_id: 34 } }));
    const result = await presentTelegramFile("token", "42", { name: "odd.png", content: "this is not base64 image data!!", mimeType: "image/png" }, undefined, fetchImpl);
    expect(result).toEqual({ messageId: 34, as: "document" });
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toContain("/sendDocument");
  });

  it("reports Telegram failures when presenting a file", async () => {
    const failureFetch = vi.fn(async () => telegramResponse({ ok: false, description: "Bad Request: file is too big" }, 400));
    await expect(presentTelegramFile("token", "42", { name: "big.txt", content: "x".repeat(100), mimeType: "text/plain" }, undefined, failureFetch)).rejects.toThrow("file is too big");
  });

  it("reports whether Telegram has a registered callback and how many updates are pending", async () => {
    const linkedFetch = vi.fn(async () => telegramResponse({ ok: true, result: { url: "https://nova.example.com/api/telegram/webhook/x", pending_update_count: 3 } }));
    await expect(getTelegramWebhookInfo("token", linkedFetch)).resolves.toEqual({ url: "https://nova.example.com/api/telegram/webhook/x", linked: true, pendingUpdateCount: 3 });
    const detachedFetch = vi.fn(async () => telegramResponse({ ok: true, result: { url: "", pending_update_count: 0 } }));
    await expect(getTelegramWebhookInfo("token", detachedFetch)).resolves.toEqual({ url: "", linked: false, pendingUpdateCount: 0 });
  });
});
