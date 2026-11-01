# AI Gateway Contract

## Purpose

The gateway is a narrowly scoped, server-to-server chat client inside Nova's own server (`server/aiGateway.ts`). Nova's browser never calls a model provider directly: Nova's authenticated server verifies the end user, enforces its own workspace-level allowance and daily credits, and calls the provider with the service credential.

## Transport

The gateway targets **NextAPI** (`https://nextapi.online`, served from `api.nextapi.online`), an OpenAI-compatible gateway, and serves a **primary model with a free fallback** plus an optional last resort on a second provider:

| Concern | Value |
| --- | --- |
| Base URL | `https://api.nextapi.online/v1` (override with `NEXTAPI_GATEWAY_URL`) |
| Credential | `NEXTAPI_API_KEY` (the deployment's existing `NEXTROUTER_API_KEY` name is accepted too) — read server-side only |
| Primary model | `deepseek-4.1-flash` (listed free and unlimited on the provider's catalogue) |
| Fallback model | `deepseek-4.1-flash-free-01` (free 1M-context route; override with `NEXTAPI_FALLBACK_MODEL`, or set it to `none`/`disabled` to turn all fallbacks off) |

A third, last-resort fallback lives on a **separate provider**, so it keeps working when NextAPI itself is down:

| Concern | Value |
| --- | --- |
| Base URL | `https://seekai.cc/v1` (override with `SEEKAI_GATEWAY_URL`) |
| Credential | `SEEKAI_API_KEY` — read server-side only; the hop is skipped entirely when unset |
| Third fallback model | `glm-5.3-flash` (Zhipu GLM-family reasoning model with tool calling; override with `SEEKAI_FALLBACK_MODEL`, or set it to `none`/`disabled` to turn the hop off) |

A credential must be at least 32 characters to count as configured, and the base URL must be `https:` or the gateway is treated as unconfigured. There is no provider mode: the primary transport is NextAPI, with SeekAI reachable only as the last-resort hop above, and there is no daily-credit allowance configured on either provider side.

## Model resolution

Every chat turn - text, tool-calling, or with image attachments - first tries the primary `deepseek-4.1-flash` model (tool calling verified against the endpoint; 1M-token context). When the primary fails transiently (rate-limited/overloaded, unreachable/timeout, or an empty completion), the same request is retried against the `deepseek-4.1-flash-free-01` fallback, which serves the same model family on the provider's 1M-context free route and also supports tool calling. If that also fails transiently and the `SEEKAI_API_KEY` credential is configured, the request makes one last attempt against SeekAI's `glm-5.3-flash` - the only hop that leaves NextAPI, so it survives a NextAPI outage. Permanent failures (bad request, bad credential, exhausted allowance/credits, user stop) surface as-is without a fallback attempt. One inference-allowance claim and one daily-credit claim cover all attempts.

## Gateway contract

| Concern | Decision |
| --- | --- |
| Caller authentication | Every request sends `Authorization: Bearer <NEXTAPI_API_KEY>`; only the SeekAI last-resort hop sends `Bearer <SEEKAI_API_KEY>` instead. |
| Provider credential | Read server-side only. Never returned, logged, or exposed to the client; `Bearer` tokens are scrubbed from error text. |
| Request surface | The tRPC `ai` router: `ai.status`, `ai.models`, and `ai.complete` (a single text prompt, capped at 12,000 characters). The gateway controls model selection, tool definitions, and streaming behavior. |
| Model catalogue | `ai.models` reports the primary plus the fallback, so the picker and the settings validation accept both. SeekAI's `glm-5.3-flash` is listed as a third, text-only entry while `SEEKAI_API_KEY` is configured (an unconfigured hop is never attempted, so it is not advertised). |
| Streaming | Supported. Text and reasoning deltas are read from the SSE body; a gateway that ignores the `stream` flag is handled by falling back to the buffered JSON body. |
| Bounds | 25s metadata timeout, 120s chat timeout, 120s stream-stall timeout, one automatic retry for an empty 200 completion, and one fallback attempt on the fallback model for transient failures. |
| Error handling | Provider failures are normalized to a small set of error kinds; only transient kinds (`unavailable`, `rate_limit`, `invalid_response`) trigger the fallback. Permanent 4xx request problems are never retried. Raw headers, credentials, and opaque upstream bodies are not forwarded. |
| Failure disclosure | When the model call itself fails, the chat reply (and the Telegram message, which renders the same text) carries an `Error details (nova-pro, <kind>):` block with the provider's own error text, credential-redacted and capped at 600 characters (`server/modelFailureDetail.ts`). Deployment-internal failures - a missing or rejected credential (`configuration`), a user stop, and errors that never came from the model call - keep the curated generic notice instead. |
| User allowance | Nova tracks the authenticated workspace's request allowance and daily credits before calling the provider. `NEXTAPI_MAX_REQUESTS_PER_WORKSPACE` caps daily requests per workspace; unset, `0`, `none`, or `unlimited` all mean no cap. |
| Deployment | Nova's Vercel project stores the NextAPI key as a sensitive Production variable under `NEXTAPI_API_KEY` (the legacy `NEXTROUTER_API_KEY` name continues to work as a fallback). The optional `NEXTAPI_GATEWAY_URL` / `NEXTAPI_MAX_REQUESTS_PER_WORKSPACE` are stored alongside it. `SEEKAI_API_KEY` (plus the optional `SEEKAI_GATEWAY_URL` / `SEEKAI_FALLBACK_MODEL`) enables the last-resort hop and stays optional: without it the chain ends at the NextAPI fallback. |

> NextAPI's free routes require an account and an API key, and the provider's privacy terms apply to requests served through them. The route is never billed to the deployment. Image input over the NextAPI route is unverified as of this swap: a probe received intermittent upstream 502s ("Empty response from DeepSeek"), which are transient availability errors rather than a capability rejection, so text, tool calling, and streaming are the only verified capabilities. [1]

## Audio input (planned)

Today the gateway's request content parts are `text` and `image_url` only: audio reaches the model as text. Telegram speech is transcribed by `server/transcription.ts` (Whisper-compatible `/audio/transcriptions`, Pollinations by default) and the transcript becomes the user's turn, so the agent acts on what was said but never hears tone, pauses, or non-speech sound.

The native-audio path - an audio decoder rather than an STT step - is designed but not built. The pieces:

| Concern | Decision |
| --- | --- |
| Content part | Add `{ type: "input_audio", input_audio: { data, format } }` to `GatewayChatMessageContentPart` (OpenAI-compatible shape), alongside the existing text and image parts. |
| Capability routing | The chain is not uniformly audio-capable: both NextAPI DeepSeek hops and SeekAI's GLM take text and images only. `AvailableGatewayModel.kind` (`"text" \| "vision"`) gains `"audio"`, and an audio-bearing turn is routed to a hop flagged `audio`, skipping the rest. |
| Degrade path | A transient failure on the audio-capable hop cannot retry the same body against a text-only hop, so the retry degrades to the existing STT transcript - the transcript is the universal fallback content, which keeps the primary-first chain's semantics intact. One allowance and one credit claim per attempt, as today. |
| Bounds | Telegram uploads cap at 20 MB; audio parts are capped (roughly 48 s / ~1 MB base64) and longer recordings go straight to STT, which already carries a 60-second provider timeout. |
| Rollout | STT stays the default because it is provider-agnostic and already wired; native audio is opt-in once a hop is verified to accept `input_audio` on the free-tier route. |

## Non-goals

The gateway does not proxy arbitrary upstream paths, forward uploaded files verbatim, provide a public OpenAI-compatible endpoint, or let Nova users supply provider keys. Users who want their own provider use the separate BYOK path (`server/byokGateway.ts`), which bypasses the built-in allowance.

## References

[1]: https://api.nextapi.online/v1/models "NextAPI model catalogue"
