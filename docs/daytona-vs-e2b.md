# Daytona vs. E2B for Nova’s Agent VM

Research date: 2026-08-15. The decision criteria are Nova’s actual needs: a server-controlled Linux agent computer, strong per-user isolation, durable workspace state, safe secrets, cost controls, and an initial no-credit-card / zero-spend policy.

> **Implementation status (2026-09-05):** Nova now uses E2B Sandbox. The provider comparison below is retained as historical research; the live integration follows the E2B lifecycle, command, and filesystem APIs documented in the repository’s `server/e2b.ts` adapter.

## Executive decision

**Historical decision: choose Daytona Cloud for Nova’s first agent-VM integration.** It was the stronger overall fit for a multi-user workspace product because its documented organization isolation, scoped/managed API keys, volume subpaths, outbound-network controls, and secret proxy give Nova more first-class tenant and credential boundaries. Daytona also offers a $200 no-card trial, versus E2B’s $100 Hobby credit. Both become usage-based after their credits; Nova must retain the existing feature-disablement policy at credit exhaustion.

E2B is an excellent alternative and has two material strengths: a simpler JavaScript integration surface and an actively maintained Apache-2.0 open-source infrastructure project with a documented self-hosting route. It should remain Nova’s contingency option if self-hosting becomes a required strategic capability.

## Capability comparison

| Criterion | Daytona | E2B | Nova implication |
| --- | --- | --- | --- |
| Agent execution API | TypeScript SDK/API for sandbox lifecycle, filesystem, process/code execution, PTY, logs, Git, MCP, and computer-use tooling | TypeScript/Python SDK creates a secure Linux VM, runs commands, and supports files/templates | Both are suitable for a server-side agent worker; Daytona has a broader documented tool surface |
| VM model | Containers by default; dedicated Linux VM, Windows, and GPU sandbox classes | Secure Linux VM on demand | Daytona supports a useful default-container / VM-only escalation model |
| State persistence | Filesystem persistence by default; VM pause/resume preserves memory; snapshots, forks, S3-backed volumes, and external mounts | Pause/resume preserves filesystem and memory; paused sandboxes are retained indefinitely; snapshots/templates available | Both support a workspace-style agent computer; Nova must still keep its own database/storage as source of truth |
| Tenant isolation | Dedicated runtime/network boundary, scoped and managed API keys, organization-scoped resources, volume subpaths | Secure sandbox controller access is enabled by default and uses access tokens | Daytona documents more multi-tenant controls that Nova can directly map to user/workspace isolation |
| Secret handling | Encrypted organization secrets; opaque placeholders substituted only by outbound proxy to approved hosts; sandbox never sees plaintext | API key-based sandbox access plus secured controller tokens; no equivalent documented host-constrained secret proxy in reviewed pages | Daytona is safer for Nova’s later provider/connector credentials |
| Network control | Per-sandbox block-all, CIDR allowlist, domain allowlist, proxy options, authenticated previews | Secure controller access documented; network controls should be validated separately before using untrusted egress | Daytona is the safer default for agent-generated commands |
| Human supervision | Web terminal, SSH, VNC, preview, and computer-use capabilities documented | Interactive terminal, SSH, and desktop-oriented use cases documented | Both can support future supervised execution; defer it in the first release |
| No-card entry | $200 free compute trial, no credit card required | $100 one-time Hobby credit, no credit card required; 1-hour sessions and 20 concurrent sandboxes | Daytona has the larger initial runway; neither is permanently free |
| After credit | Pay-as-you-go | Account blocked until a payment method is added | Nova’s zero-spend policy should proactively disable new work before either provider can bill |
| Self-hosting option | Public repository is no longer maintained; do not treat it as Nova’s supported self-hosting route | Active Apache-2.0 project with documented Terraform-based self-hosting | E2B is stronger if Nova later chooses a paid, user-owned, or self-managed compute plane |

## Current E2B design

Nova creates a short-lived E2B Sandbox for bounded tasks and a per-workspace persistent E2B Sandbox for chat and scheduled automation. Each sandbox is tagged with Nova owner/workspace/run metadata. The adapter transfers only a scoped workspace bundle, persists file changes back to Nova’s database and S3, and keeps the E2B API key server-side.

The E2B key must remain server-only. Persistent sandboxes use a one-hour timeout with pause/automatic resume, while bounded task sandboxes use a 20-minute timeout and are killed after completion. Nova must never give a sandbox a Neon database connection string or long-lived provider credentials; workspace files are explicitly scoped and synchronized through the adapter.

## Cost and product boundary

E2B’s Hobby credit and one-hour sandbox limit are not a free permanent VM. To honor the user’s no-card requirement, Nova blocks new sandbox creation at the configured `E2B_MAX_SANDBOX_CREATIONS` threshold (50 creations by default), before any workspace upload or task execution. It explains that execution is paused and leaves files unchanged. Nova must not request a card, switch plans, or retry work through a paid path without a future explicit product decision.

## When E2B would win instead

E2B is now the selected provider because its current JavaScript SDK supplies the required sandbox lifecycle, command, filesystem, and pause/resume primitives with a small server-side adapter. The comparison’s remaining Daytona preference is historical and does not describe the live deployment.

## References

1. Daytona, [Sandboxes](https://www.daytona.io/docs/en/sandboxes/): isolated containers, Linux VM sandboxes, resources, and lifecycle.
2. Daytona, [Persistence](https://www.daytona.io/docs/en/persistence/): filesystem/memory persistence, snapshots, volumes, and retention.
3. Daytona, [Isolation](https://www.daytona.io/docs/en/isolation/): runtime, network, organization isolation, scoped keys, and tenant volume subpaths.
4. Daytona, [Secrets](https://www.daytona.io/docs/en/secrets/): encrypted host-allowlisted secret substitution without exposing plaintext to sandboxes.
5. Daytona, [Pricing](https://www.daytona.io/pricing): $200 included compute and no-credit-card trial.
6. E2B, [Documentation](https://docs.e2b.dev/): secure Linux VMs and SDK control.
7. E2B, [Sandbox lifecycle](https://docs.e2b.dev/sandbox) and [persistence](https://docs.e2b.dev/sandbox/persistence): timeouts, pause/resume, and state preservation.
8. E2B, [Secured access](https://docs.e2b.dev/sandbox/secured-access): default SDK-authenticated access to sandbox controller APIs.
9. E2B, [Pricing and limits](https://e2b.dev/pricing) and [billing](https://docs.e2b.dev/billing): $100 no-card Hobby credit, session/concurrency limits, usage billing, and account blocking at credit exhaustion.
10. E2B, [open-source infrastructure](https://github.com/e2b-dev/E2B): Apache-2.0 repository and documented Terraform-based self-hosting path.
