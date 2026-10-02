# AI Gateway Contract

## Purpose

The gateway is a narrowly scoped, server-to-server chat client inside Nova’s own server (`server/aiGateway.ts`). The original design routed through a separate `Marcus-Mok-GH/API-server` deployment; that hop has since been folded into Nova, which calls the upstream provider’s hosted API directly. Nova’s browser never calls a model provider directly: Nova’s authenticated server verifies the end user, enforces its own workspace-level allowance and daily credits, and calls the provider with the service credential.

Every supported provider speaks the OpenAI-compatible chat-completions dialect, so the gateway targets that one protocol rather than any single vendor SDK.

## Transport modes

The gateway picks its mode from whichever credential is configured. Credential and companion variables are always read from the same mode, so a half-configured deployment can never pair one provider's URL with another's key.

| Mode | Selected by | Base URL variable (default) | Model variables |
| --- | --- | --- | --- |
| Z.ai (Zhipu GLM) | `ZAI_API_KEY` / `NOVA_ZAI_GATEWAY_TOKEN` | `ZAI_GATEWAY_URL` (`https://api.z.ai/api/paas/v4`) | `ZAI_DEFAULT_MODEL`, `ZAI_VISION_MODEL`, `ZAI_FALLBACK_MODEL`, `ZAI_LAST_RESORT_MODEL` |
| Default provider | `MISTRAL_API_KEY` / `NOVA_MISTRAL_GATEWAY_TOKEN` | `MISTRAL_GATEWAY_URL` (`https://api.mistral.ai/v1`) | `MISTRAL_DEFAULT_MODEL`, `MISTRAL_FALLBACK_MODEL` |

The `MISTRAL_*` names are the legacy variable names for the default provider mode and are kept for deployment compatibility. The database also stores this mode's `model_provider` enum value as the legacy identifier `mistral`.

A credential must be at least 32 characters to count as configured, and a gateway URL must be `https:` or the mode is treated as unconfigured.

## Model resolution

The configured default model is authoritative whenever the gateway actually serves it. Otherwise discovery (`GET /models`, cached 5 minutes) degrades to a vision-capable model, then to a discovered text model, then to the configured text fallback. Z.ai overrides skip the served-check because Z.ai's `/models` response omits the free flash models it nonetheless serves.

On an upstream pool overload (HTTP 429), one request retries down a chain: resolved model, configured text fallback, then (Z.ai only) the last-resort model. Later requests skip the congested primary for a 5-minute degradation window. When the whole chain is congested, Z.ai deployments make a final attempt on the zero-credential Kilo anonymous tier (`KILO_GATEWAY_URL`, default `https://api.kilo.ai/api/gateway`), which serves `:free` models without any key. Fallback attempts reuse the run's allowance claim and are never double-charged.

## Gateway contract

| Concern | Decision |
| --- | --- |
| Caller authentication | Every request sends `Authorization: Bearer <credential>` for the active mode. The Kilo anonymous tier deliberately sends no credential. |
| Provider credential | Read server-side only. Never returned, logged, or exposed to the client; `Bearer` tokens are scrubbed from error text. |
| Request surface | The tRPC `ai` router: `ai.status`, `ai.models`, and `ai.complete` (a single text prompt, capped at 12,000 characters). The gateway controls model selection, tool definitions, and streaming behavior. |
| Streaming | Supported. Text and reasoning deltas are read from the SSE body; a gateway that ignores the `stream` flag is handled by falling back to the buffered JSON body. |
| Bounds | 25s metadata timeout, 120s chat timeout, 120s stream-stall timeout, and one automatic retry for an empty 200 completion. |
| Error handling | Provider failures are normalized to a small set of error kinds; permanent 4xx request problems are never retried. Raw headers, credentials, and opaque upstream bodies are not forwarded. |
| User allowance | Nova tracks the authenticated workspace's request allowance and daily credits before calling the provider. `MISTRAL_MAX_REQUESTS_PER_WORKSPACE` caps daily requests per workspace; unset, `0`, `none`, or `unlimited` all mean no cap. |
| Deployment | Nova's Vercel project stores the active mode's credential (and any optional URL/model overrides) as sensitive Production variables. |

> Providers apply per-tier rate limits (requests per second plus token budgets), and a 429 lockout can persist. Nova therefore uses a lower application-level allowance rather than treating provider capacity as an entitlement, and gives upstream rate limits one patient retry instead of a fast retry loop. [1]

## Non-goals

The gateway does not proxy arbitrary upstream paths, forward uploaded files verbatim, provide a public OpenAI-compatible endpoint, or let Nova users supply provider keys. Users who want their own provider use the separate BYOK path (`server/byokGateway.ts`), which bypasses the built-in allowance.

## References

[1]: https://docs.mistral.ai/getting-started/rate-limits/ "Provider rate limits (default provider mode)"
