# Daytona Evaluation for Nova Agent VMs

Research date: 2026-08-15.

## Current platform facts

Daytona is purpose-built for AI-generated code and agent execution. Its sandboxes are programmatically managed isolated runtime environments with dedicated kernel, filesystem, network stack, allocated vCPU, RAM, and disk. The public TypeScript SDK can create a sandbox and run code or processes directly, matching Nova’s server-side agent-orchestration model.

Daytona supports both default container sandboxes and dedicated Linux VM sandboxes. The documented VM snapshots include 1 vCPU / 1 GiB / 3 GiB, 2 vCPU / 4 GiB / 8 GiB, and 4 vCPU / 8 GiB / 10 GiB options. VM sandboxes support VM-specific operations including forking, pause/resume, and snapshots. Lifecycle APIs cover creation, start/stop, archive, pause/resume, recovery, resize, labels, deletion, auto-stop, auto-pause, archive/delete intervals, and wall-clock TTL.

The documentation exposes agent-facing filesystem, Git, process/code execution, PTY, log streaming, MCP, computer-use, and skills capabilities, as well as human web terminal, SSH, VNC, and preview capabilities. Daytona also documents snapshots, volumes, external storage mounting, network limits, secrets, audit logs, and BYOC as platform concepts.

## Commercial and operational fit

Daytona’s pricing page advertises a **free trial with no credit card required** and **$200 in included compute**, followed by usage-based pricing. This meets a no-card onboarding constraint, but it is not an indefinitely free VM provider. The earlier open-source Daytona repository states that core development moved to a private codebase in June 2026 and that the public repository is no longer maintained; self-hosting that old repository would not be an appropriate supported production plan.

## Initial conclusion

Daytona is a strong technical fit and materially better than GitHub Actions for Nova’s agent VM: it directly gives the agent an API-controlled sandbox/VM with durable state options and isolated execution. However, Nova must treat the $200 trial as a development/onboarding allowance, implement sandbox quotas and auto-stop policies, and decide who pays after the credit is consumed. It cannot honestly be marketed as permanent free compute.

## Nova fit assessment

| Evaluation area | Assessment | Decision |
| --- | --- | --- |
| Agent control | The TypeScript SDK/API can create sandboxes and execute processes and code, with filesystem, PTY, Git, log-streaming, and MCP-adjacent capabilities | **Strong fit** for Nova’s server-side agent orchestration |
| Isolation | Daytona documents dedicated kernel, filesystem, network stack, and allocated compute per sandbox; VM sandboxes offer a dedicated Linux VM | **Strong fit** for running agent-provided commands away from Nova’s web server |
| Workspace durability | Sandboxes, snapshots, volumes, and external storage mounts are available, but Nova must remain the workspace’s source of truth | **Good fit**, provided files are synchronized by scoped bundle or storage mount—not treated as the only copy inside a sandbox |
| Human hand-off | Web terminal, SSH, VNC, preview, and computer-use tools are described | **Useful later** for a supervised workspace/terminal experience, but keep it out of the first agent-only release |
| Operations | Lifecycle controls include auto-stop, auto-pause, archiving, auto-delete, TTL, labels, webhooks, secrets, and audit-related controls | **Strong fit** for quotas, cleanup, and observability |
| Commercial model | The no-card trial includes $200 compute, then is usage-based | **Not a permanent free platform**; enforce a zero-spend policy and visibly exhaust the credit rather than converting users to paid usage |
| Self-hosting escape hatch | The former public open-source repository is no longer maintained | **Do not rely on self-hosting** as Nova’s supported production route |

## Recommended adoption path

Adopt **Daytona Cloud** as Nova’s preferred agent-compute platform for an initial constrained rollout. Use the default container sandbox for ordinary file transforms, code generation, and command tasks; use `daytona-vm-small` only when an agent truly requires VM-only behavior. This keeps the starting resource envelope at 1 vCPU, 1 GiB RAM, and 3 GiB disk while reserving higher-cost VM resources for explicitly marked tasks.

The Nova backend should own a single server-only `DAYTONA_API_KEY` and never expose it to the browser. For each agent execution, create a run record, issue a sandbox with the workspace owner and run ID as labels, obtain a short-lived scoped workspace bundle or mount, execute an allowlisted worker command, stream sanitized progress into the existing chat/run UI, import declared output files, and delete the sandbox on completion or TTL expiry. The agent must not receive Nova database credentials, long-lived model-provider keys, or unrestricted user tokens.

Set auto-stop aggressively for inactive sandboxes, set a maximum wall-clock TTL, cap concurrent sandboxes per user, and block network egress by default except to explicit package and artifact endpoints. Before enabling user-created commands, enforce a user-visible confirmation step for destructive file actions and third-party network access.

## Recommendation

**Adopt Daytona over the GitHub Actions proposal for Nova’s agent VM.** It is designed exactly for programmatic agent sandboxes, offers actual Linux VM sandboxes when needed, and provides the filesystem/process/lifecycle APIs that Nova needs without forcing a GitHub-account workflow. Start with the no-card $200 trial for implementation and controlled early testing. Do not promise a forever-free VM: decide on a paid usage budget, a startup-credit path, or a future bring-your-own-compute offering before broadly enabling persistent agent execution.

## Enforced zero-spend policy

For Nova’s initial release, the post-credit policy is **feature disablement at credit exhaustion**. Nova must not collect a payment method, convert a Daytona account to paid usage, or silently retry a failed sandbox provision on a paid route. When the monitored trial allowance is exhausted or a sandbox request receives a quota/billing error, Nova must mark the run as unavailable, retain the user’s workspace unchanged, and present a clear notice that agent execution is paused pending a future user-approved compute option.

The initial runtime limits are: a maximum of one running sandbox per user, the `daytona-small` container profile by default, a VM profile only for VM-required tools, auto-stop after five minutes of inactivity, a 20-minute wall-clock TTL, auto-delete after output import, default-deny network egress with a narrow allowlist for artifact and approved package endpoints, and a per-user task queue. These limits are product requirements to implement alongside the Daytona integration; they prevent the no-card trial from being depleted by unconstrained agent behavior.

## Sources

1. Daytona, [Sandboxes](https://www.daytona.io/docs/en/sandboxes/): isolated sandbox/VM model, resources, snapshots, and lifecycle controls.
2. Daytona, [Documentation](https://www.daytona.io/docs/en/): SDK and API control surface for filesystem, process, and code execution.
3. Daytona, [Pricing](https://www.daytona.io/pricing): $200 included compute and no-credit-card free trial.
4. Daytona, [public repository](https://github.com/daytonaio/daytona): notice that the public repository is no longer maintained as of June 2026.
