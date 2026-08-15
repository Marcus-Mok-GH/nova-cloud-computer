# No-Credit-Card Agent VM Strategy for Nova

Research date: 2026-08-15. Nova requires a Linux environment that the **AI agent itself** can use for file processing, command execution, and generated artifacts. It is not sufficient to give only the user a browser IDE.

## Decision

> Use a **GitHub-hosted Ubuntu Actions runner** as Nova’s no-credit-card, short-lived agent VM. It is an execution job, not a permanent personal computer.

GitHub documents that hosted runners are virtual machines that execute workflow jobs and are available on Ubuntu Linux. A GitHub Free account includes 2,000 Actions minutes per month for private repositories; when an account has no payment method, use is blocked at the allowance rather than billed. This provides an agent-executable Linux VM with a firm, zero-cost ceiling.

## Why not a permanent free VM

No mainstream provider offers a reliable, always-on public Linux VM with root-level flexibility under both requirements: no credit card and no paid-account path. Oracle does offer Always Free compute capacity but its official documentation says most users need a credit card at sign-up. Google Cloud Shell is free but its VM is discarded after one hour of inactivity. GitHub Codespaces is useful for interactive development but does not provide a safe agent-command backplane by itself.

## Recommended architecture

| Layer | Responsibility | Persistence and security boundary |
| --- | --- | --- |
| **Nova (Vercel + Neon)** | Authenticates the user, approves a requested agent task, records run status, and remains the source of truth for workspace metadata | No credentials or original files are stored only on the VM |
| **Per-user private GitHub runtime repository** | Holds a pinned Nova runner workflow; the user’s personal GitHub account owns the Actions quota | Requires explicit user connection to GitHub and a private repository; do not use Nova’s public repository for private workspace jobs |
| **GitHub-hosted Ubuntu Actions runner** | Starts a fresh VM, retrieves a scoped job bundle, executes only the approved task, and uploads a result bundle/diff | Destroyed after the workflow; no long-lived user shell or VM disk |
| **Nova job API and object storage** | Issues an opaque one-time run identifier and short-lived scoped download/upload URLs | Return only declared outputs; redact logs and never put workspace content, API keys, or tokens into workflow inputs or public logs |

## Execution flow

1. The user asks Nova to perform an execution task, such as analyzing a folder, converting files, or creating a generated project.
2. Nova displays the planned command scope and requires an explicit approval boundary for external network access or destructive operations.
3. Nova creates a run record and dispatches the private repository’s pinned workflow with an opaque run ID only.
4. A fresh Ubuntu runner obtains a short-lived, task-scoped workspace bundle, runs the Nova worker, and returns only the requested artifact and an operation manifest.
5. Nova validates the returned manifest, stores accepted results in the user’s workspace, and shows the run log and outputs in the Workspace tab.

## Product limits to expose

| Constraint | Product treatment |
| --- | --- |
| **2,000 GitHub Free minutes per month for private repositories** | Display remaining execution allowance and block dispatch before a task would exceed it |
| **No payment method** | GitHub blocks additional usage; Nova must never prompt the user to add a card or silently retry |
| **Ephemeral disk** | Persist only explicitly returned output bundles to Nova storage; never treat runner disk as user storage |
| **No inbound interactive VM** | Offer task runs and downloadable artifacts, not an always-on remote desktop or shell |
| **Private data** | Use a user-owned private runtime repository and short-lived URLs; prohibit private payloads in public workflows and logs |

## Implementation choice

This is the viable path for agent execution **without a credit card**, but it requires a user-authorized GitHub connection so each account uses its own private repo and quota. It is suitable for bounded agent jobs, not continuous background agents or a live desktop. Those latter requirements need a paid VM or a user-owned computer that stays online.

## Sources

1. GitHub, [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners): hosted virtual machines execute workflow jobs and provide Ubuntu Linux runners.
2. GitHub, [GitHub Actions billing](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions): 2,000 GitHub Free minutes per month and usage blocking with no payment method after quota exhaustion.
3. GitHub, [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces): the separate personal Codespaces allowance and no-payment-method blocking behavior.
4. Google Cloud, [How Cloud Shell works](https://docs.cloud.google.com/shell/docs/how-cloud-shell-works): temporary VM lifecycle and one-hour inactivity termination.
5. Oracle, [OCI Cloud Free Tier](https://docs.oracle.com/iaas/Content/FreeTier/freetier.htm): most users need a mobile number and credit card to create an account.
