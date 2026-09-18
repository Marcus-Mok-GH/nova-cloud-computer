# Mistral Gateway Contract

## Purpose

The gateway is a narrowly scoped, server-to-server Mistral AI chat client inside Nova’s own server (`server/mistralGateway.ts`). The original design routed through a separate `Marcus-Mok-GH/API-server` deployment; that hop has since been folded into Nova, which calls Mistral AI’s hosted API directly. Nova’s browser never calls Mistral directly. Nova’s authenticated server verifies the end user, enforces its own workspace-level allowance, and calls Mistral with the service credential.

## Provider contract

Mistral documents an OpenAI-compatible chat-completions endpoint at `https://api.mistral.ai/v1/chat/completions`, authenticated with an `Authorization: Bearer $MISTRAL_API_KEY` header. The default model is `mistral-medium-3-5`, the frontier multimodal replacement for the deprecated Pixtral Large (with `mistral-small-latest` as the text-only fallback); Mistral’s reference lists available models and their supported chat completion request fields. [1]

## Gateway contract

| Concern | Decision |
| --- | --- |
| Caller authentication | Every request sends `Authorization: Bearer <MISTRAL_API_KEY>`; `NOVA_MISTRAL_GATEWAY_TOKEN` remains a legacy fallback credential when the primary key is unset. |
| Provider credential | Read `MISTRAL_API_KEY` only in the API-server runtime. Never return, log, or expose it to the client. |
| Request surface | `POST /api/mistral/chat` accepts a single text prompt. The gateway controls model, token ceiling, temperature, and streaming behavior. |
| Bounds | Reject oversized prompts, cap output at 1,024 tokens, disable streaming, and impose an upstream timeout. |
| Error handling | Normalize provider failures; do not forward provider credentials, raw headers, or opaque upstream bodies. |
| User allowance | Nova, not the gateway, tracks the authenticated workspace’s request allowance before calling the gateway. |
| Deployment | Nova’s Vercel project stores `MISTRAL_API_KEY` (and the optional `MISTRAL_GATEWAY_URL` / `NOVA_MISTRAL_GATEWAY_TOKEN` overrides) as sensitive Production variables. |

> Mistral applies per-tier rate limits (requests per second plus token budgets) on its La Plateforme APIs. Nova therefore uses a lower application-level allowance rather than treating provider capacity as an entitlement. [2]

## Non-goals

The initial gateway does not proxy arbitrary Mistral paths, accept arbitrary model identifiers, stream tokens, forward uploaded files, provide a public OpenAI-compatible endpoint, or let Nova users supply provider keys.

## References

[1]: https://docs.mistral.ai/api/ "Mistral AI API reference (chat completions, models)"
[2]: https://docs.mistral.ai/getting-started/rate-limits/ "Mistral AI rate limits"
