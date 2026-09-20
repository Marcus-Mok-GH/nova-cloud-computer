import { beforeEach, describe, expect, it, vi } from "vitest";
import { isNimConfigured, runNimChat } from "./nim";

const state = vi.hoisted(() => ({
  nimKey: "test-nim-key",
  nimUrl: "https://integrate.api.nvidia.com/v1",
  nimModel: "moonshotai/kimi-k3",
}));
vi.mock("./_core/env", () => ({
  ENV: {
    get nimApiKey() { return state.nimKey; },
    get nimApiUrl() { return state.nimUrl; },
    get nimCoderModel() { return state.nimModel; },
  },
}));

function jsonResponse(payload: unknown, init?: { status?: number } & Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const fetchStub = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchStub);
  fetchStub.mockReset();
  state.nimKey = "test-nim-key";
  state.nimUrl = "https://integrate.api.nvidia.com/v1";
  state.nimModel = "moonshotai/kimi-k3";
});

describe("isNimConfigured", () => {
  it("tracks whether the NIM API key is present", () => {
    expect(isNimConfigured()).toBe(true);
    state.nimKey = " ";
    expect(isNimConfigured()).toBe(false);
  });
});

describe("runNimChat", () => {
  it("sends the system prompt, task prompt, model and key to the chat completions endpoint", async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: "print('hi')" } }] })
    );

    const text = await runNimChat({
      prompt: "Write a hello world",
      systemPrompt: "You are a coder.",
      model: "deepseek-ai/deepseek-v4-flash",
      maxTokens: 1234,
    });

    expect(text).toBe("print('hi')");
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect(url.href).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer test-nim-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("deepseek-ai/deepseek-v4-flash");
    expect(body.max_tokens).toBe(1234);
    expect(body.messages).toEqual([
      { role: "system", content: "You are a coder." },
      { role: "user", content: "Write a hello world" },
    ]);
  });

  it("defaults to the configured NIM coder model", async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    await runNimChat({ prompt: "p", systemPrompt: "s" });
    expect(JSON.parse(fetchStub.mock.calls[0][1].body).model).toBe("moonshotai/kimi-k3");
  });

  it("works against a self-hosted NIM base URL with or without a trailing slash", async () => {
    state.nimUrl = "http://localhost:8000/v1/";
    fetchStub.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    await runNimChat({ prompt: "p", systemPrompt: "s" });
    expect(fetchStub.mock.calls[0][0].href).toBe("http://localhost:8000/v1/chat/completions");
  });

  it("allows a custom HTTPS endpoint", async () => {
    state.nimUrl = "https://nim.internal.example.com/v1";
    fetchStub.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    await runNimChat({ prompt: "p", systemPrompt: "s" });
    expect(fetchStub.mock.calls[0][0].href).toBe("https://nim.internal.example.com/v1/chat/completions");
  });

  it("joins OpenAI-style content part arrays into one text", async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] })
    );
    expect(await runNimChat({ prompt: "p", systemPrompt: "s" })).toBe("ab");
  });

  it("rejects an empty resolved model with the self-hosted operator hint", async () => {
    state.nimUrl = "http://gpu-box.internal:8000/v1";
    state.nimModel = ""; // custom endpoint without NVIDIA_NIM_CODER_MODEL set
    await expect(runNimChat({ prompt: "p", systemPrompt: "s" })).rejects.toThrow(
      "NVIDIA_NIM_CODER_MODEL is required when NVIDIA_NIM_API_URL points to a self-hosted or custom endpoint"
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses to send the API key over plain HTTP to a non-loopback host", async () => {
    state.nimUrl = "http://gpu-box.internal:8000/v1";
    await expect(runNimChat({ prompt: "p", systemPrompt: "s" })).rejects.toThrow(
      "Refusing to send the NVIDIA NIM API key over http://gpu-box.internal"
    );
    // The key never left the process: no request was made at all.
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("rejects when the key is missing, before any request is sent", async () => {
    state.nimKey = "";
    await expect(runNimChat({ prompt: "p", systemPrompt: "s" })).rejects.toThrow(
      "NVIDIA NIM is not configured - set NVIDIA_NIM_API_KEY (or the legacy NVIDIA_API_KEY) to enable it."
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("surfaces the HTTP status and a trimmed error detail", async () => {
    fetchStub.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { detail: "rate limited" } }), { status: 429 })
    );
    await expect(runNimChat({ prompt: "p", systemPrompt: "s" })).rejects.toThrow(
      "NVIDIA NIM responded with status 429"
    );
  });

  it("rejects when the model returns no text", async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "" } }] }));
    await expect(runNimChat({ prompt: "p", systemPrompt: "s" })).rejects.toThrow(
      "NVIDIA NIM finished without a reply."
    );
  });
});
