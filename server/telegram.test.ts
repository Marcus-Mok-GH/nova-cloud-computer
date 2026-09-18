import { describe, expect, it, vi } from "vitest";
import { configureTelegramWebhook, discoverTelegramChat, getTelegramWebhookInfo, downloadTelegramUpload, presentTelegramFile, sendTelegramMessage, stripMarkdownEmphasis, telegramUploadFromMessage, validateTelegramBotToken } from "./telegram";

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

  it("strips markdown emphasis so raw asterisks never reach the Telegram chat", async () => {
    expect(stripMarkdownEmphasis("Got it - expect a reply in **under a minute**")).toBe("Got it - expect a reply in under a minute");
    expect(stripMarkdownEmphasis("**Bold** start and *light* middle")).toBe("Bold start and light middle");
    expect(stripMarkdownEmphasis("__dunder__ is unwrapped too")).toBe("dunder is unwrapped too");
    // Single underscores are identifiers, never emphasis: they must survive.
    expect(stripMarkdownEmphasis("open nova_app_link and file_2")).toBe("open nova_app_link and file_2");
    expect(stripMarkdownEmphasis("3 * 4 and 2*3 stay math")).toBe("3 * 4 and 2*3 stay math");
    // Nested emphasis needs repeated passes to strip the outer pair too.
    expect(stripMarkdownEmphasis("**bold *light* text**")).toBe("bold light text");
    expect(stripMarkdownEmphasis("__dunder and *star* mix__")).toBe("dunder and star mix");
    const fetchImpl = vi.fn(async () => telegramResponse({ ok: true, result: { message_id: 9 } }));
    await sendTelegramMessage("token", "42", "expect a reply in **under a minute**", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/sendMessage"),
      expect.objectContaining({ body: expect.stringContaining("under a minute") })
    );
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: expect.stringContaining("**") })
    );
  });

  it("sends a bounded message to the configured chat and reports Telegram failures", async () => {
    const successFetch = vi.fn(async () => telegramResponse({ ok: true, result: { message_id: 9 } }));
    await expect(sendTelegramMessage("token", "42", "Hello from Nova", successFetch)).resolves.toEqual({ message_id: 9 });
    expect(successFetch).toHaveBeenCalledWith(expect.stringContaining("/sendMessage"), expect.objectContaining({ body: expect.stringContaining('"chat_id":"42"') }));
    const failureFetch = vi.fn(async () => telegramResponse({ ok: false, description: "Bad Request: chat not found" }, 400));
    await expect(sendTelegramMessage("token", "42", "Hello", failureFetch)).rejects.toThrow("chat not found");
  });

  it("attaches inline keyboards with URL buttons to the message payload", async () => {
    const fetchImpl = vi.fn(async () => telegramResponse({ ok: true, result: { message_id: 11 } }));
    await sendTelegramMessage("token", "42", "Here is your answer", fetchImpl, {
      inlineKeyboard: [[{ text: "🪐 View this run in Nova", url: "https://nova-cloud-computer.vercel.app/app?chatId=3" }]],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/sendMessage"),
      expect.objectContaining({
        body: expect.stringContaining('"reply_markup":{"inline_keyboard":[[{"text":"🪐 View this run in Nova","url":"https://nova-cloud-computer.vercel.app/app?chatId=3"}]]}'),
      })
    );
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

  it("extracts the upload from a message, preferring the largest photo", () => {
    const photo = telegramUploadFromMessage({ photo: [{ file_id: "small", file_size: 100 }, { file_id: "large", file_size: 800 }] });
    expect(photo).toEqual({ kind: "photo", fileId: "large", fileName: null, mimeType: "image/jpeg" });
    const document = telegramUploadFromMessage({ document: { file_id: "doc1", file_name: "report.pdf", mime_type: "application/pdf" } });
    expect(document).toEqual({ kind: "document", fileId: "doc1", fileName: "report.pdf", mimeType: "application/pdf" });
    const voice = telegramUploadFromMessage({ voice: { file_id: "v1", mime_type: "audio/ogg" } });
    expect(voice).toEqual({ kind: "voice", fileId: "v1", fileName: null, mimeType: "audio/ogg" });
    const video = telegramUploadFromMessage({ video: { file_id: "vid1" } });
    expect(video).toEqual({ kind: "video", fileId: "vid1", fileName: null, mimeType: "video/mp4" });
    expect(telegramUploadFromMessage({ text: "just chatting" })).toBeUndefined();
    expect(telegramUploadFromMessage({ photo: [] })).toBeUndefined();
  });

  it("downloads a text upload as readable content", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/getFile")
        ? telegramResponse({ ok: true, result: { file_path: "documents/notes.txt" } })
        : new Response("hello from telegram", { status: 200 })
    );
    const payload = await downloadTelegramUpload("token", { kind: "document", fileId: "doc1", fileName: "notes.txt", mimeType: "text/plain" }, fetchImpl);
    expect(payload).toEqual({ name: "notes.txt", content: "hello from telegram", mimeType: "text/plain" });
  });

  it("stores binary uploads as data URIs and names unnamed photos", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/getFile")
        ? telegramResponse({ ok: true, result: { file_path: "photos/photo.jpg" } })
        : new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    );
    const payload = await downloadTelegramUpload("token", { kind: "photo", fileId: "p1", fileName: null, mimeType: "image/jpeg" }, fetchImpl);
    expect(payload.name).toMatch(/^photo-\d+\.jpg$/);
    expect(payload.content).toBe("data:image/jpeg;base64," + Buffer.from([1, 2, 3]).toString("base64"));
    expect(String(fetchImpl.mock.calls[1][0])).toContain("/file/bottoken/photos/photo.jpg");
  });

  it("treats code and config files as text even with an octet-stream mime", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/getFile")
        ? telegramResponse({ ok: true, result: { file_path: "documents/script.py" } })
        : new Response("print('hi')", { status: 200 })
    );
    const payload = await downloadTelegramUpload("token", { kind: "document", fileId: "d1", fileName: "script.py", mimeType: "application/octet-stream" }, fetchImpl);
    expect(payload.content).toBe("print('hi')");
  });

  it("surfaces Telegram failures when downloading an upload", async () => {
    const failureFetch = vi.fn(async () => telegramResponse({ ok: false, description: "Bad Request: file is too big" }, 400));
    await expect(downloadTelegramUpload("token", { kind: "document", fileId: "d1", fileName: "big.zip", mimeType: "application/zip" }, failureFetch)).rejects.toThrow("file is too big");
    const noPathFetch = vi.fn(async () => telegramResponse({ ok: true, result: {} }));
    await expect(downloadTelegramUpload("token", { kind: "document", fileId: "d1", fileName: "x.bin", mimeType: null }, noPathFetch)).rejects.toThrow("did not return a download path");
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
