# NVIDIA Gateway Contract

## Purpose

`Marcus-Mok-GH/API-server` will provide a narrowly scoped, server-to-server NVIDIA NIM chat gateway for Nova. Nova’s browser never calls NVIDIA or the gateway directly. Nova’s authenticated server verifies the end user, enforces its own workspace-level allowance, and calls the gateway with a separate service credential.

## Provider contract

NVIDIA documents an OpenAI-compatible chat-completions endpoint at `https://integrate.api.nvidia.com/v1/chat/completions`, authenticated with an `Authorization: Bearer $NVIDIA_API_KEY` header. The initial gateway allowlist contains only `nvidia/nemotron-3-nano-30b-a3b`; NVIDIA’s reference lists this model and its supported chat completion request fields. [1]

## Gateway contract

| Concern | Decision |
| --- | --- |
| Caller authentication | Require `Authorization: Bearer <NOVA_NVIDIA_GATEWAY_TOKEN>` on every route. |
| Provider credential | Read `NVIDIA_API_KEY` only in the API-server runtime. Never return, log, or expose it to the client. |
| Request surface | `POST /api/nvidia/chat` accepts a single text prompt. The gateway controls model, token ceiling, temperature, and streaming behavior. |
| Bounds | Reject oversized prompts, cap output at 1,024 tokens, disable streaming, and impose an upstream timeout. |
| Error handling | Normalize provider failures; do not forward provider credentials, raw headers, or opaque upstream bodies. |
| User allowance | Nova, not the gateway, tracks the authenticated workspace’s request allowance before calling the gateway. |
| Deployment | The API-server Vercel project receives `NVIDIA_API_KEY` and `NOVA_NVIDIA_GATEWAY_TOKEN` as sensitive Production variables. Nova receives only its own gateway URL and matching service token as sensitive Production variables. |

> NVIDIA states that its development serverless APIs are rate-limited, with most models allowing up to 40 requests per minute. Nova therefore uses a much lower application-level allowance rather than treating provider capacity as an entitlement. [2]

## Non-goals

The initial gateway does not proxy arbitrary NVIDIA paths, accept arbitrary model identifiers, stream tokens, forward uploaded files, provide a public OpenAI-compatible endpoint, or let Nova users supply provider keys.

## References

[1]: https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-30b-a3b-infer "NVIDIA NIM: Nemotron 3 Nano chat-completion reference"
[2]: https://build.nvidia.com/settings/api-keys "NVIDIA Build API-key settings and development rate-limit FAQ"
