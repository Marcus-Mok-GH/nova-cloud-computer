# Mistral Gateway Contract

## Purpose

`Marcus-Mok-GH/API-server` will provide a narrowly scoped, server-to-server Mistral AI chat gateway for Nova. Nova’s browser never calls Mistral or the gateway directly. Nova’s authenticated server verifies the end user, enforces its own workspace-level allowance, and calls the gateway with a separate service credential.

## Provider contract

Mistral documents an OpenAI-compatible chat-completions endpoint at `https://api.mistral.ai/v1/chat/completions`, authenticated with an `Authorization: Bearer $MISTRAL_API_KEY` header. The default model is `pixtral-large-latest` (vision-capable, with `mistral-large-latest` as the text-only fallback); Mistral’s reference lists available models and their supported chat completion request fields. [1]

## Gateway contract

| Concern | Decision |
| --- | --- |
| Caller authentication | Require `Authorization: Bearer <NOVA_MISTRAL_GATEWAY_TOKEN>` on every route. |
| Provider credential | Read `MISTRAL_API_KEY` only in the API-server runtime. Never return, log, or expose it to the client. |
| Request surface | `POST /api/mistral/chat` accepts a single text prompt. The gateway controls model, token ceiling, temperature, and streaming behavior. |
| Bounds | Reject oversized prompts, cap output at 1,024 tokens, disable streaming, and impose an upstream timeout. |
| Error handling | Normalize provider failures; do not forward provider credentials, raw headers, or opaque upstream bodies. |
| User allowance | Nova, not the gateway, tracks the authenticated workspace’s request allowance before calling the gateway. |
| Deployment | The API-server Vercel project receives `MISTRAL_API_KEY` and `NOVA_MISTRAL_GATEWAY_TOKEN` as sensitive Production variables. Nova receives only its own gateway URL and matching service token as sensitive Production variables. |

> Mistral applies per-tier rate limits (requests per second plus token budgets) on its La Plateforme APIs. Nova therefore uses a lower application-level allowance rather than treating provider capacity as an entitlement. [2]

## Non-goals

The initial gateway does not proxy arbitrary Mistral paths, accept arbitrary model identifiers, stream tokens, forward uploaded files, provide a public OpenAI-compatible endpoint, or let Nova users supply provider keys.

## References

[1]: https://docs.mistral.ai/api/ "Mistral AI API reference (chat completions, models)"
[2]: https://docs.mistral.ai/getting-started/rate-limits/ "Mistral AI rate limits"
