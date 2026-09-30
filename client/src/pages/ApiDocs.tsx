import React, { useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Copy, KeyRound, LoaderCircle, MessageSquare, Moon, Play, ShieldCheck, Sun, Terminal, Zap } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";

const curlExample = [
  "curl https://your-nova-domain.com/api/v1/chat/completions \\",
  "  -H 'Authorization: Bearer nova_sk_your_key' \\",
  "  -H 'Content-Type: application/json' \\",
  '  -d \'{"model":"nova-pro","messages":[{"role":"user","content":"Give me three names for a coffee shop."}]}\'',
].join("\n");

const javascriptExample = [
  "const response = await fetch(\"https://your-nova-domain.com/api/v1/chat/completions\", {",
  '  method: "POST",',
  "  headers: {",
  '    Authorization: "Bearer nova_sk_your_key",',
  '    "Content-Type": "application/json",',
  "  },",
  "  body: JSON.stringify({",
  '    model: "nova-pro",',
  '    messages: [{ role: "user", content: "Hello from my app." }],',
  "  }),",
  "});",
  "const data = await response.json();",
].join("\n");

const responseExample = [
  "{",
  '  "id": "chatcmpl-nova-...",',
  '  "object": "chat.completion",',
  '  "model": "nova-pro",',
  '  "choices": [{',
  '    "message": {"role": "assistant", "content": "..."},',
  '    "finish_reason": "stop"',
  "  }],",
  '  "usage": {"prompt_tokens": 12, "completion_tokens": 24, "total_tokens": 36}',
  "}",
].join("\n");

const modelsExample = [
  "{",
  '  "object": "list",',
  '  "data": [',
  '    {"id": "nova-pro", "object": "model", "owned_by": "nova"},',
  '    {"id": "gpt-4o", "object": "model", "owned_by": "byok"}',
  '  ]',
  "}",
].join("\n");

const streamExample = [
  "curl -N https://your-nova-domain.com/api/v1/chat/completions \\",
  "  -H 'Authorization: Bearer nova_sk_your_key' \\",
  "  -H 'Content-Type: application/json' \\",
  '  -d \'{"model":"nova-pro","stream":true,"messages":[{"role":"user","content":"Count to three."}]}\'',
].join("\n");

const streamResponseExample = [
  'data: {"id":"chatcmpl-nova-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-nova-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"One"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-nova-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  "data: [DONE]",
].join("\n");

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[#303b3d] bg-[#202a2c] text-[#e8ece7] shadow-[0_16px_40px_rgba(31,37,41,0.12)] dark:border-white/10 dark:bg-[#0f1515]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#9fa9a4]">{label}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#cbd3ce] transition hover:bg-white/10 hover:text-white" aria-label={copied ? "Copied" : "Copy code"}>
          {copied ? <Check className="size-3.5 text-[#a4c89d]" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 text-[12px] leading-6 sm:text-[13px]"><code>{code}</code></pre>
    </div>
  );
}

function MethodPill({ children, tone = "orange" }: { children: string; tone?: "orange" | "green" }) {
  return <span className={tone === "green" ? "rounded-md bg-[#dcebdc] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#4f7656] dark:bg-[#7ca981]/15 dark:text-[#a8d5a8]" : "rounded-md bg-[#f0ddd4] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#a65331] dark:bg-[#a5674c]/20 dark:text-[#f0ad89]"}>{children}</span>;
}

function TryApiConsole() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("nova-pro");
  const [prompt, setPrompt] = useState("Give me one practical idea for using Nova in my workflow.");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  const runRequest = async () => {
    if (!apiKey.trim()) {
      setError("Add an API key from Settings before running the request.");
      setResult("");
      return;
    }
    if (!prompt.trim()) {
      setError("Add a prompt before running the request.");
      setResult("");
      return;
    }
    setRunning(true);
    setError("");
    setResult("");
    try {
      const response = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey.trim(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.trim() || undefined,
          messages: [{ role: "user", content: prompt.trim() }],
          stream: true,
        }),
      });

      // Failures before the stream opens (bad key, rejected model, quota) come
      // back as a normal JSON error envelope rather than as SSE.
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        setError(data?.error?.message || "Request failed (" + response.status + ").");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let streamedError = "";

      // Every SSE frame is a `data: <json>` line, frames separated by a blank
      // line; the stream closes with `data: [DONE]`.
      const handleFrame = (frame: string) => {
        const line = frame.split("\n").find(part => part.startsWith("data:"));
        if (!line) return;
        const payload = line.slice("data:".length).trim();
        if (!payload || payload === "[DONE]") return;
        let event: { error?: { message?: string }; choices?: Array<{ delta?: { content?: string } }> };
        try {
          event = JSON.parse(payload);
        } catch {
          return;
        }
        if (event.error?.message) {
          streamedError = event.error.message;
          return;
        }
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          setResult(text);
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        frames.forEach(handleFrame);
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleFrame(buffer);

      if (streamedError) {
        setError(streamedError);
        return;
      }
      if (!text) setResult("(The model returned an empty completion.)");
    } catch {
      setError("The request could not reach this Nova deployment. Try again in a moment.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-8 overflow-hidden rounded-3xl border border-[#cfc9bd] bg-[#efede7] dark:border-white/10 dark:bg-[#202623]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d9d6ce] px-5 py-5 dark:border-white/10 sm:px-7">
        <div>
          <div className="flex items-center gap-2"><Play className="size-4 text-[#b65f38] dark:text-[#e59468]" /><p className="text-sm font-semibold">Try it from here</p></div>
          <p className="mt-1 text-xs leading-5 text-[#70736d] dark:text-[#adb1a9]">This streams a request to the current Nova deployment and prints tokens as they arrive.</p>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[#dcebdc] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#4f7656] dark:bg-[#7ca981]/15 dark:text-[#a8d5a8]"><ShieldCheck className="size-3.5" />Key stays in memory</div>
      </div>
      <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-4">
          <label className="block"><span className="text-xs font-semibold text-[#4f5553] dark:text-[#d6d8d2]">API key</span><input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="nova_sk_..." autoComplete="off" className="mt-2 w-full rounded-xl border border-[#d2cec4] bg-[#faf9f6] px-3.5 py-2.5 text-sm outline-none transition placeholder:text-[#a3a49d] focus:border-[#b65f38] focus:ring-2 focus:ring-[#b65f38]/15 dark:border-white/10 dark:bg-[#151a19] dark:text-white dark:focus:border-[#e59468]" /></label>
          <label className="block"><span className="text-xs font-semibold text-[#4f5553] dark:text-[#d6d8d2]">Model <span className="font-normal text-[#858780]">(optional)</span></span><input value={model} onChange={event => setModel(event.target.value)} placeholder="nova-pro" className="mt-2 w-full rounded-xl border border-[#d2cec4] bg-[#faf9f6] px-3.5 py-2.5 text-sm outline-none transition placeholder:text-[#a3a49d] focus:border-[#b65f38] focus:ring-2 focus:ring-[#b65f38]/15 dark:border-white/10 dark:bg-[#151a19] dark:text-white dark:focus:border-[#e59468]" /></label>
          <label className="block"><span className="text-xs font-semibold text-[#4f5553] dark:text-[#d6d8d2]">Prompt</span><textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={5} className="mt-2 w-full resize-y rounded-xl border border-[#d2cec4] bg-[#faf9f6] px-3.5 py-2.5 text-sm leading-6 outline-none transition placeholder:text-[#a3a49d] focus:border-[#b65f38] focus:ring-2 focus:ring-[#b65f38]/15 dark:border-white/10 dark:bg-[#151a19] dark:text-white dark:focus:border-[#e59468]" /></label>
          <button type="button" onClick={runRequest} disabled={running} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#b65f38] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#9f4f2d] disabled:cursor-wait disabled:opacity-60 dark:bg-[#d17b52] dark:hover:bg-[#e59468]">{running ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}{running ? "Running request..." : "Run request"}</button>
          <p className="text-[11px] leading-5 text-[#858780]">Your key is sent only to this deployment for this request and is not saved by the docs page.</p>
        </div>
        <div className="min-h-[280px] rounded-2xl border border-[#303b3d] bg-[#202a2c] p-5 text-[#e8ece7] dark:bg-[#0f1515]">
          <div className="flex items-center justify-between gap-3"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#9fa9a4]">Response</p>{result && <span className="text-[11px] font-semibold text-[#a4c89d]">200 OK</span>}</div>
          {error ? <div className="mt-6 rounded-xl border border-[#d98e6b]/30 bg-[#d98e6b]/10 p-4 text-sm leading-6 text-[#f0b195]">{error}</div> : result ? <pre className="mt-5 max-h-[360px] overflow-auto whitespace-pre-wrap text-[13px] leading-6"><code>{result}</code></pre> : <div className="mt-16 text-center text-sm leading-6 text-[#9fa9a4]"><p>Your response will appear here.</p><p className="mt-1 text-xs text-[#76817b]">Add your key and run a prompt to test the connection.</p></div>}
        </div>
      </div>
    </div>
  );
}

export default function ApiDocs() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <main className="min-h-screen bg-[#f7f5f1] text-[#1f2529] dark:bg-[#121514] dark:text-[#f4f0e8]">
      <header className="sticky top-0 z-40 border-b border-[#dfdcd4]/90 bg-[#f7f5f1]/95 backdrop-blur dark:border-white/10 dark:bg-[#121514]/95">
        <div className="mx-auto flex h-[70px] max-w-6xl items-center justify-between gap-5 px-5 sm:px-8">
          <a href="/" className="flex items-center gap-2.5" aria-label="Nova home">
            <img src="/logo-96.png" alt="" width="27" height="27" className="rounded-[7px]" />
            <span className="text-[17px] font-bold tracking-[-0.02em]">Nova</span>
            <span className="hidden border-l border-[#d6d2c9] pl-2.5 text-[11px] font-medium text-[#77766f] sm:inline dark:border-white/15 dark:text-[#a7aaa4]">API documentation</span>
          </a>
          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleTheme} className="grid size-9 place-items-center rounded-full border border-[#d9d6ce] text-[#686a65] transition hover:bg-[#ece9e2] hover:text-[#1f2529] dark:border-white/15 dark:text-[#a7aaa4] dark:hover:bg-white/8 dark:hover:text-white" aria-label={theme === "light" ? "Use dark theme" : "Use light theme"}>
              {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </button>
            <button type="button" onClick={() => setLocation(isAuthenticated ? "/app" : "/sign-in")} className="inline-flex items-center gap-2 rounded-full bg-[#26343a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#34474f] dark:bg-[#e9e5db] dark:text-[#1f2529] dark:hover:bg-white">
              {isAuthenticated ? "Open workspace" : "Get started"}<ArrowUpRight className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-20">
        <div>
          <a href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#77766f] transition hover:text-[#b65f38] dark:text-[#a7aaa4] dark:hover:text-[#e59468]"><ArrowLeft className="size-4" />Back to Nova</a>
          <div className="mt-10 max-w-3xl">
            <p className="text-sm font-semibold tracking-[0.04em] text-[#b65f38] dark:text-[#e59468]">Nova API / v1</p>
            <h1 className="mt-5 text-[clamp(2.8rem,6vw,5rem)] font-semibold leading-[0.98] tracking-[-0.065em]">Put Nova inside the work you already do.</h1>
            <p className="mt-6 max-w-2xl text-[17px] leading-8 text-[#626660] dark:text-[#b5b8b0]">The Nova API is an OpenAI-compatible interface for calling your workspace's configured model from your own scripts, products, and automations.</p>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#d9d6ce] bg-[#faf9f6] p-5 dark:border-white/10 dark:bg-[#1b211f]"><KeyRound className="size-5 text-[#b65f38] dark:text-[#e59468]" /><p className="mt-5 text-sm font-semibold">Bearer auth</p><p className="mt-1 text-xs leading-5 text-[#777a73] dark:text-[#aeb3aa]">Use a key from Settings.</p></div>
            <div className="rounded-2xl border border-[#d9d6ce] bg-[#faf9f6] p-5 dark:border-white/10 dark:bg-[#1b211f]"><MessageSquare className="size-5 text-[#b65f38] dark:text-[#e59468]" /><p className="mt-5 text-sm font-semibold">Chat completions</p><p className="mt-1 text-xs leading-5 text-[#777a73] dark:text-[#aeb3aa]">Familiar OpenAI shape.</p></div>
            <div className="rounded-2xl border border-[#d9d6ce] bg-[#faf9f6] p-5 dark:border-white/10 dark:bg-[#1b211f]"><Zap className="size-5 text-[#b65f38] dark:text-[#e59468]" /><p className="mt-5 text-sm font-semibold">Streaming</p><p className="mt-1 text-xs leading-5 text-[#777a73] dark:text-[#aeb3aa]">Set <code className="rounded bg-[#ece9e2] px-1 py-0.5 text-[11px] dark:bg-white/10">stream: true</code>.</p></div>
          </div>

          <section id="quickstart" className="scroll-mt-28 pt-20">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#b65f38] dark:text-[#e59468]">01 / Quickstart</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">Make your first request.</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#70736d] dark:text-[#adb1a9]">Create an API key in your Nova workspace, add it as a bearer token, and send standard chat messages to the v1 endpoint.</p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-[#d9d6ce] bg-[#faf9f6] p-5 dark:border-white/10 dark:bg-[#1b211f]"><span className="text-sm font-semibold text-[#b65f38] dark:text-[#e59468]">01</span><h3 className="mt-4 font-semibold">Create a key</h3><p className="mt-2 text-sm leading-6 text-[#70736d] dark:text-[#adb1a9]">Open Settings → API keys in your Nova workspace. The secret is shown once.</p></div>
              <div className="rounded-2xl border border-[#d9d6ce] bg-[#faf9f6] p-5 dark:border-white/10 dark:bg-[#1b211f]"><span className="text-sm font-semibold text-[#b65f38] dark:text-[#e59468]">02</span><h3 className="mt-4 font-semibold">Set the base URL</h3><p className="mt-2 text-sm leading-6 text-[#70736d] dark:text-[#adb1a9]">Use your deployed Nova URL followed by <code className="rounded bg-[#ece9e2] px-1 py-0.5 text-[11px] dark:bg-white/10">/api/v1</code>.</p></div>
              <div className="rounded-2xl border border-[#d9d6ce] bg-[#faf9f6] p-5 dark:border-white/10 dark:bg-[#1b211f]"><span className="text-sm font-semibold text-[#b65f38] dark:text-[#e59468]">03</span><h3 className="mt-4 font-semibold">Send messages</h3><p className="mt-2 text-sm leading-6 text-[#70736d] dark:text-[#adb1a9]">Pass system, user, and assistant messages in the request body.</p></div>
            </div>
            <div className="mt-8"><CodeBlock code={curlExample} label="curl" /></div>
          </section>

          <section id="authentication" className="scroll-mt-28 pt-20">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#b65f38] dark:text-[#e59468]">02 / Authentication</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">One key, two accepted headers.</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#70736d] dark:text-[#adb1a9]">Nova API keys start with <code className="rounded bg-[#ece9e2] px-1.5 py-0.5 text-sm dark:bg-white/10">nova_sk_</code>. Keep them on your server and never ship them in browser code.</p>
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#d9d6ce] bg-[#faf9f6] p-5 dark:border-white/10 dark:bg-[#1b211f]"><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#858780]">Preferred</p><code className="mt-4 block break-all text-sm text-[#26343a] dark:text-[#e8ece7]">Authorization: Bearer nova_sk_your_key</code></div>
              <div className="rounded-2xl border border-[#d9d6ce] bg-[#faf9f6] p-5 dark:border-white/10 dark:bg-[#1b211f]"><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#858780]">Alternative</p><code className="mt-4 block break-all text-sm text-[#26343a] dark:text-[#e8ece7]">x-api-key: nova_sk_your_key</code></div>
            </div>
          </section>

          <section id="endpoints" className="scroll-mt-28 pt-20">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#b65f38] dark:text-[#e59468]">03 / Endpoints</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">Small surface, familiar shapes.</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#70736d] dark:text-[#adb1a9]">All endpoints live under your deployment's <code className="rounded bg-[#ece9e2] px-1.5 py-0.5 text-sm dark:bg-white/10">/api/v1</code> path and return JSON unless streaming is enabled.</p>

            <article id="models" className="mt-8 scroll-mt-28 rounded-3xl border border-[#d9d6ce] bg-[#faf9f6] p-6 dark:border-white/10 dark:bg-[#1b211f] sm:p-8">
              <div className="flex flex-wrap items-center gap-3"><MethodPill tone="green">GET</MethodPill><code className="text-sm font-semibold">/models</code></div>
              <p className="mt-5 text-sm leading-6 text-[#70736d] dark:text-[#adb1a9]">List the models available to your Nova workspace. <code className="rounded bg-[#ece9e2] px-1 py-0.5 text-[11px] dark:bg-white/10">nova-pro</code> is Nova's built-in model; connect your own provider in Settings and its model id appears here as a second choice. Use a returned <code className="rounded bg-[#ece9e2] px-1 py-0.5 text-[11px] dark:bg-white/10">id</code> in chat completion requests.</p>
              <div className="mt-6"><CodeBlock code={modelsExample} label="response" /></div>
            </article>

            <article id="me" className="mt-4 scroll-mt-28 rounded-3xl border border-[#d9d6ce] bg-[#faf9f6] p-6 dark:border-white/10 dark:bg-[#1b211f] sm:p-8">
              <div className="flex flex-wrap items-center gap-3"><MethodPill tone="green">GET</MethodPill><code className="text-sm font-semibold">/me</code></div>
              <p className="mt-5 text-sm leading-6 text-[#70736d] dark:text-[#adb1a9]">Check that a key is valid and read the current daily credit status for its owner.</p>
              <div className="mt-5 rounded-xl border border-[#e1ded6] bg-[#f0eee8] p-4 text-xs leading-6 text-[#626660] dark:border-white/10 dark:bg-white/5 dark:text-[#c2c8c2]"><span className="font-semibold text-[#26343a] dark:text-white">Returns:</span> <code>{"{ authenticated: true, credits: ... }"}</code></div>
            </article>

            <article id="chat-completions" className="mt-4 scroll-mt-28 rounded-3xl border border-[#d9d6ce] bg-[#faf9f6] p-6 dark:border-white/10 dark:bg-[#1b211f] sm:p-8">
              <div className="flex flex-wrap items-center gap-3"><MethodPill>POST</MethodPill><code className="text-sm font-semibold">/chat/completions</code></div>
              <p className="mt-5 text-sm leading-6 text-[#70736d] dark:text-[#adb1a9]">Generate a response from your configured Nova model. The request follows the OpenAI chat completions shape.</p>
              <div className="mt-6"><CodeBlock code={javascriptExample} label="javascript" /></div>
              <div className="mt-4"><CodeBlock code={responseExample} label="response · stream false" /></div>
              <div className="mt-4"><CodeBlock code={streamExample} label="curl · stream true" /></div>
              <div className="mt-4"><CodeBlock code={streamResponseExample} label="stream response" /></div>
              <TryApiConsole />
              <div className="mt-6 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-xl border border-[#e1ded6] p-4 dark:border-white/10"><p className="font-semibold">messages</p><p className="mt-1 text-xs leading-5 text-[#70736d] dark:text-[#adb1a9]">Required. Up to 40 messages with system, user, or assistant roles.</p></div><div className="rounded-xl border border-[#e1ded6] p-4 dark:border-white/10"><p className="font-semibold">stream</p><p className="mt-1 text-xs leading-5 text-[#70736d] dark:text-[#adb1a9]">Optional boolean. Set true for Server-Sent Events and finish with [DONE].</p></div><div className="rounded-xl border border-[#e1ded6] p-4 dark:border-white/10"><p className="font-semibold">model</p><p className="mt-1 text-xs leading-5 text-[#70736d] dark:text-[#adb1a9]">Optional. One of the ids from /models; defaults to <code>nova-pro</code> when omitted. Other ids are rejected.</p></div><div className="rounded-xl border border-[#e1ded6] p-4 dark:border-white/10"><p className="font-semibold">content</p><p className="mt-1 text-xs leading-5 text-[#70736d] dark:text-[#adb1a9]">Strings or arrays of text parts. Total prompt content is limited to 100,000 characters.</p></div></div>
            </article>
          </section>

          <section id="limits" className="scroll-mt-28 pt-20">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#b65f38] dark:text-[#e59468]">04 / Limits</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">A few boundaries to know.</h2>
            <div className="mt-7 divide-y divide-[#dfdcd4] rounded-2xl border border-[#d9d6ce] bg-[#faf9f6] dark:divide-white/10 dark:border-white/10 dark:bg-[#1b211f]">
              <div className="flex gap-4 p-5"><Terminal className="mt-0.5 size-4 shrink-0 text-[#b65f38] dark:text-[#e59468]" /><p className="text-sm leading-6"><span className="font-semibold">Text only for now.</span> Tools and function calling are not supported by the v1 inference API.</p></div>
              <div className="flex gap-4 p-5"><BookOpen className="mt-0.5 size-4 shrink-0 text-[#b65f38] dark:text-[#e59468]" /><p className="text-sm leading-6"><span className="font-semibold">40 messages per request.</span> The combined prompt content limit is 100,000 characters.</p></div>
              <div className="flex gap-4 p-5"><KeyRound className="mt-0.5 size-4 shrink-0 text-[#b65f38] dark:text-[#e59468]" /><p className="text-sm leading-6"><span className="font-semibold">Usage follows your workspace.</span> Requests to <code>nova-pro</code> use the owner's daily Nova credits and inference allowance; a BYOK model runs on your own provider and claims none.</p></div>
            </div>
          </section>

          <section id="errors" className="scroll-mt-28 pt-20">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#b65f38] dark:text-[#e59468]">05 / Errors</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">Errors stay predictable.</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#70736d] dark:text-[#adb1a9]">Failures use an OpenAI-style envelope so your existing client error handling can keep working.</p>
            <div className="mt-7"><CodeBlock code={'{\n  "error": {\n    "message": "That API key has been revoked or no longer exists.",\n    "type": "invalid_request_error",\n    "code": "invalid_api_key"\n  }\n}'} label="error response" /></div>
          </section>

          <div className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t border-[#dfdcd4] pt-7 text-sm dark:border-white/10"><a href="/" className="inline-flex items-center gap-2 font-semibold text-[#77766f] hover:text-[#b65f38] dark:text-[#a7aaa4] dark:hover:text-[#e59468]"><ArrowLeft className="size-4" />Back to Nova</a><button type="button" onClick={() => setLocation(isAuthenticated ? "/app/settings" : "/sign-in")} className="inline-flex items-center gap-2 font-semibold text-[#b65f38] hover:text-[#9f4f2d] dark:text-[#e59468]">Get an API key<ArrowUpRight className="size-4" /></button></div>
        </div>

        <aside className="hidden lg:block"><div className="sticky top-28 border-l border-[#d9d6ce] pl-6 dark:border-white/10"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#9a9c94]">On this page</p><nav className="mt-4 space-y-3 text-sm"><a href="#quickstart" className="block text-[#626660] transition hover:text-[#b65f38] dark:text-[#aeb3aa] dark:hover:text-[#e59468]">Quickstart</a><a href="#authentication" className="block text-[#626660] transition hover:text-[#b65f38] dark:text-[#aeb3aa] dark:hover:text-[#e59468]">Authentication</a><a href="#endpoints" className="block text-[#626660] transition hover:text-[#b65f38] dark:text-[#aeb3aa] dark:hover:text-[#e59468]">Endpoints</a><a href="#limits" className="block text-[#626660] transition hover:text-[#b65f38] dark:text-[#aeb3aa] dark:hover:text-[#e59468]">Limits</a><a href="#errors" className="block text-[#626660] transition hover:text-[#b65f38] dark:text-[#aeb3aa] dark:hover:text-[#e59468]">Errors</a></nav><div className="mt-8 rounded-2xl bg-[#26343a] p-4 text-[#f4f0e8]"><p className="text-xs font-semibold">Ready to connect Nova?</p><p className="mt-2 text-xs leading-5 text-[#c2c8c2]">Create a key and make your first request in minutes.</p><button type="button" onClick={() => setLocation(isAuthenticated ? "/app/settings" : "/sign-in")} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#e9a17b]">Get started<ArrowUpRight className="size-3.5" /></button></div></div></aside>
      </div>
    </main>
  );
}
