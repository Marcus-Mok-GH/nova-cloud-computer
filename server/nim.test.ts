import { beforeEach, describe, expect, it, vi } from "vitest";
import { isNimConfigured, NimToolsUnsupportedError, runNimChat, runNimAgentChat } from "./nim";

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
    // 429 is retried; stub both attempts so the final error carries the status.
    fetchStub.mockResolvedValue(
      new Response(JSON.stringify({ error: { detail: "rate limited" } }), { status: 429, headers: { "retry-after": "0" } })
    );
    await expect(runNimChat({ prompt: "p", systemPrompt: "s" })).rejects.toThrow(
      "NVIDIA NIM responded with status 429"
    );
    expect(fetchStub).toHaveBeenCalledTimes(4);
  });

  it("rejects when the model returns no text", async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "" } }] }));
    await expect(runNimChat({ prompt: "p", systemPrompt: "s" })).rejects.toThrow(
      "NVIDIA NIM finished without a reply."
    );
  });
});

describe("NIM transient-failure retries", () => {
  it("retries a 429 with Retry-After: 0 and succeeds on the next attempt", async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429, headers: { "retry-after": "0" } }));
    fetchStub.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    await expect(runNimChat({ systemPrompt: "s", prompt: "p" })).resolves.toBe("ok");
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("retries transient 5xx responses and succeeds once the pool recovers", async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ error: "overloaded" }, { status: 503, headers: { "retry-after": "0" } }));
    fetchStub.mockResolvedValueOnce(jsonResponse({ error: "overloaded" }, { status: 503, headers: { "retry-after": "0" } }));
    fetchStub.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "done" } }] }));
    await expect(runNimChat({ systemPrompt: "s", prompt: "p" })).resolves.toBe("done");
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it("gives up after four failed attempts instead of exiting on the first rate limit", async () => {
    for (let i = 0; i < 4; i += 1) {
      fetchStub.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429, headers: { "retry-after": "0" } }));
    }
    await expect(runNimChat({ systemPrompt: "s", prompt: "p" })).rejects.toThrow(/status 429/);
    expect(fetchStub).toHaveBeenCalledTimes(4);
  });

  it("gives a timed-out request exactly one second chance", async () => {
    fetchStub.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
    fetchStub.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "recovered" } }] }));
    await expect(runNimChat({ systemPrompt: "s", prompt: "p" })).resolves.toBe("recovered");
    expect(fetchStub).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 4; i += 1) {
      fetchStub.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
    }
    await expect(runNimAgentChat({ messages: [{ role: "user", content: "p" }], tools: [] })).rejects.toThrow("aborted");
    expect(fetchStub).toHaveBeenCalledTimes(6);
  }, 15_000);

  it("does not retry tools-rejection statuses so the single-shot fallback still triggers", async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ error: "no tools" }, { status: 400 }));
    await expect(runNimAgentChat({ messages: [{ role: "user", content: "p" }], tools: [] })).rejects.toBeInstanceOf(NimToolsUnsupportedError);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
