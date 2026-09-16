/** Exa AI Agent API client for Nova's deep research.
 * Docs: https://exa.ai/docs/agent/quickstart
 *
 * POST https://api.exa.ai/agent/runs with `Accept: text/event-stream` starts a
 * deep-research run and follows its server-sent events (keep-alive comments,
 * agent_run.created / started / source events …) until a terminal event:
 * agent_run.completed (full run object) / failed / cancelled. */

import { ENV } from "./_core/env";

export type ExaCitation = { url: string; title: string };

export type ExaAgentGrounding = {
  field: string;
  citations: ExaCitation[];
  confidence?: string | null;
};

export type ExaAgentRun = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  output?: { text?: string; grounding?: ExaAgentGrounding[] };
  usage?: Record<string, number>;
  error?: { code?: string; message?: string };
};

export type ExaAgentEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "auto";

export type ExaAgentRunOptions = {
  /** The research query — the task the deep research agent works on. */
  query: string;
  /** Optional system prompt steering the report style and judgement. */
  systemPrompt?: string;
  /** Cost/reasoning effort. Fixed efforts are predictably priced; `auto` is metered. */
  effort?: ExaAgentEffort;
  /** Hard client-side cap on following the stream (default 270s, Vercel-bound). */
  timeoutMs?: number;
  /** Optional observer for every stream event (progress logging, future UI). */
  onEvent?: (event: string, data: unknown) => void;
};

export function isExaConfigured() {
  return ENV.exaApiKey.trim().length > 0;
}

/** Parses one SSE frame's lines into `{ event, data }`, honoring keep-alive comments. */
function parseSseFrame(rawFrame: string): { event: string; data: string } | null {
  let event = "";
  const dataLines: string[] = [];
  for (const rawLine of rawFrame.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith(":")) continue; // keep-alive comment — ignored by spec
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!event || dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Runs an Exa deep-research agent to completion via its SSE stream.
 * Resolves with the completed run (`output.text` + `output.grounding`);
 * rejects when the run fails, is cancelled, or the stream ends abnormally.
 */
export async function runExaAgentResearch(options: ExaAgentRunOptions): Promise<ExaAgentRun> {
  if (!isExaConfigured()) {
    throw new Error("Exa deep research is not configured — set EXA_API_KEY to enable web research.");
  }
  const response = await fetch("https://api.exa.ai/agent/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      "x-api-key": ENV.exaApiKey,
    },
    body: JSON.stringify({
      query: options.query,
      effort: options.effort ?? "medium",
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 270_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Exa Agent responded with status ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error("Exa Agent stream ended before the research completed.");
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const frame = parseSseFrame(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");
      if (!frame) continue;
      const payload = safeJson(frame.data);
      options.onEvent?.(frame.event, payload);
      // For forward compatibility, ignore unrecognized events and keep reading
      // until a terminal event arrives.
      if (frame.event === "agent_run.completed") {
        const run = payload as unknown as ExaAgentRun | null;
        if (!run || typeof run.id !== "string") {
          throw new Error("Exa Agent completed without a usable run object.");
        }
        return run;
      }
      if (frame.event === "agent_run.failed") {
        const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
        const detail = error?.message ?? error?.code ?? "unknown error";
        throw new Error(`Exa Agent research failed: ${detail}`);
      }
      if (frame.event === "agent_run.cancelled") {
        throw new Error("Exa Agent research was cancelled.");
      }
    }
  }
}
