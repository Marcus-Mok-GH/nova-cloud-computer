# AI Gateway Contract

## Purpose

The gateway is a narrowly scoped, server-to-server chat client inside Nova's own server (`server/aiGateway.ts`). Nova's browser never calls a model provider directly: Nova's authenticated server verifies the end user, enforces its own workspace-level allowance and daily credits, and calls the provider with the service credential.

## Transport

The gateway targets **Token Harbor** (`https://tokenharbor.ai`), a unified OpenAI-compatible gateway, and serves exactly **one model**:

| Concern | Value |
| --- | --- |
| Base URL | `https://tokenharbor.ai/v1` (override with `TOKENHARBOR_GATEWAY_URL`) |
| Credential | `TOKENHARBOR_API_KEY` — a `thk_live_...` Universal Key, read server-side only |
| Model | `deepseek-v4.1-flash:free` (free-tier: never billed) |

A credential must be at least 32 characters to count as configured, and the base URL must be `https:` or the gateway is treated as unconfigured. There is no provider mode: Token Harbor is the only transport, and there is no daily-credit allowance configured on the provider side for the `:free` route.

## Model resolution

There is no discovery ladder and no fallback chain. Every chat turn - text, tool-calling, or with image attachments - runs on the single `deepseek-v4.1-flash:free` model, which is multimodal (accepts image input) and supports tool calling with a 1M-token context. A failed call surfaces its error to the caller as-is; nothing is retried on a different model.

## Gateway contract

| Concern | Decision |
| --- | --- |
| Caller authentication | Every request sends `Authorization: Bearer <TOKENHARBOR_API_KEY>`. |
| Provider credential | Read server-side only. Never returned, logged, or exposed to the client; `Bearer` tokens are scrubbed from error text. |
| Request surface | The tRPC `ai` router: `ai.status`, `ai.models`, and `ai.complete` (a single text prompt, capped at 12,000 characters). The gateway controls model selection, tool definitions, and streaming behavior. |
| Model catalogue | `ai.models` reports exactly one entry (the single model), so the picker and the settings validation never expose another choice. |
| Streaming | Supported. Text and reasoning deltas are read from the SSE body; a gateway that ignores the `stream` flag is handled by falling back to the buffered JSON body. |
| Bounds | 25s metadata timeout, 120s chat timeout, 120s stream-stall timeout, and one automatic retry for an empty 200 completion. A 429 is never retried on another model. |
| Error handling | Provider failures are normalized to a small set of error kinds; permanent 4xx request problems are never retried. Raw headers, credentials, and opaque upstream bodies are not forwarded. |
| User allowance | Nova tracks the authenticated workspace's request allowance and daily credits before calling the provider. `TOKENHARBOR_MAX_REQUESTS_PER_WORKSPACE` caps daily requests per workspace; unset, `0`, `none`, or `unlimited` all mean no cap. |
| Deployment | Nova's Vercel project stores `TOKENHARBOR_API_KEY` (and the optional `TOKENHARBOR_GATEWAY_URL` / `TOKENHARBOR_MAX_REQUESTS_PER_WORKSPACE`) as sensitive Production variables. |

> Token Harbor's free-tier route requires an account and a Universal Key, and its free-route privacy terms apply to requests served on `:free`. The route is never billed to the workspace's Token Harbor balance. [1]

## Non-goals

The gateway does not proxy arbitrary upstream paths, forward uploaded files verbatim, provide a public OpenAI-compatible endpoint, or let Nova users supply provider keys. Users who want their own provider use the separate BYOK path (`server/byokGateway.ts`), which bypasses the built-in allowance.

## References

[1]: https://tokenharbor.ai/docs/api/models "Token Harbor model catalogue and billing"
