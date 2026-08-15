# No-Credit-Card Runtime Options for Nova Workspaces

Research date: 2026-08-15. This assessment applies the strict requirement that the user must not supply a credit card and must not be exposed to an automatic paid-account conversion.

## Decision

> **There is no mainstream, reliable, permanently running public Linux VM with root access that I can honestly recommend under both constraints.**

The previous Oracle recommendation does **not** meet this requirement: Oracle’s official documentation says most users need a credit card at sign-up. Google Compute Engine and AWS VM routes also depend on billing or trial structures, so they are not suitable defaults for this constraint.

## Best no-credit-card option: GitHub Codespaces

Use **GitHub Codespaces** as Nova’s optional *interactive execution workspace* for a proof of concept. A GitHub Free personal account includes 120 compute hours and 15 GB-month of Codespaces storage each month. Without a payment method, GitHub blocks further use after this allowance rather than charging the account. This is the clearest no-credit-card option for launching a Linux development environment against Nova’s existing public GitHub repository.

It is intentionally **not** a permanent per-user VM: its capacity is monthly limited, it is best treated as an on-demand development or agent-run environment, and durable workspace records must remain in Nova’s database and storage layer. Nova should sync a disposable working copy into Codespaces, never store the only copy of a user’s files there.

## Secondary option: Google Cloud Shell

Google Cloud Shell is free for users with a Google Cloud account and supplies a temporary Debian Linux VM with root privileges and 5 GB of persistent `$HOME` storage. However, the VM is discarded after one hour of inactivity, and the home directory is deleted after 120 days without access. It is appropriate for a temporary maintenance shell, not for a user-facing always-on Nova computer.

| Option | Credit card / automatic paid conversion | What it is suitable for | Hard limitation |
| --- | --- | --- | --- |
| **GitHub Codespaces** | No payment method is required for included personal-account use; usage stops once the quota is exhausted | Best fit for on-demand Nova tool runs and development workspaces | 120 included core-hours and 15 GB-month storage per month |
| **Google Cloud Shell** | Free for Google Cloud users | Temporary maintenance and CLI tasks | VM ends after one inactive hour; 5 GB home storage |
| Oracle Always Free / Google Compute / AWS EC2 | Not recommended under this requirement | None for this decision | Require or depend on card/billing/trial flows |
| User-owned computer | No cloud account or card | The only unbounded no-cost execution path | The user device must stay available |

## Product recommendation

Keep Nova’s file/folder workspace on Vercel and Neon. Add a **“Run in Codespaces”** action only when we are ready to support an optional, quota-bounded development environment. Display the remaining allowance and make all work exportable to the workspace before a Codespace stops. Do not market this as an always-on cloud VM.

For an unlimited, genuinely no-cost execution environment, Nova needs to use the user’s own computer rather than a third-party cloud provider.

## Sources

1. GitHub, [GitHub Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces): 120 compute hours and 15 GB-month for personal GitHub Free; use is blocked without a payment method after the quota.
2. Google Cloud, [How Cloud Shell works](https://docs.cloud.google.com/shell/docs/how-cloud-shell-works): temporary VM lifecycle, 5 GB home storage, and inactivity deletion behavior.
3. Google Cloud, [Cloud Shell pricing](https://cloud.google.com/shell/pricing): Cloud Shell is free for users with a Google Cloud account.
4. Oracle, [OCI Cloud Free Tier](https://docs.oracle.com/iaas/Content/FreeTier/freetier.htm): most users need a mobile phone number and credit card at account creation.
