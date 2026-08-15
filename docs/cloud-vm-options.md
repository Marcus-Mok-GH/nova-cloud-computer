# Cloud VM Options for Nova Workspaces

Research date: 2026-08-15.

## Product framing

Nova currently stores the user workspace in Neon Postgres and serves the interface from Vercel. A cloud VM should therefore be treated as an optional **per-user execution environment** for future OS-level tools, containers, or long-running local processes. It should not become the source of truth for workspace files or credentials.

## Shortlist

| Provider | Ongoing no-cost VM capacity | Main constraint | Fit for Nova |
| --- | --- | --- | --- |
| Oracle Cloud Always Free | Up to 2 AMD micro VMs, or an Arm allocation equivalent to 2 OCPUs and 12 GB RAM; 200 GB block volume total | Free Arm capacity can be unavailable, and idle instances may be reclaimed | Best free proof-of-concept option for one personal workspace |
| Google Cloud Free Tier | One non-preemptible e2-micro VM, 30 GB standard persistent disk, 1 GB monthly outbound transfer | Limited to three US regions and too small for an interactive workspace runtime | Conservative fallback or lightweight relay only |
| AWS Free Tier | Up to $200 in new-customer credits over up to six months on the Free plan | Time-limited credits rather than a durable free VM budget | Trial and portability testing, not the preferred long-lived workspace host |

## Recommendation

Use **Oracle Cloud Always Free Ampere A1** for a single-user Nova workspace proof of concept, subject to successful capacity allocation. The documented 2 OCPU / 12 GB RAM equivalent and 200 GB total block volume offer materially more headroom than Google’s e2-micro free allowance. Keep Neon/Postgres and Vercel as the system of record and web plane, and put only disposable execution state on the VM. Implement encrypted backups, a lightweight health check, and automatic recreation before relying on it because Oracle can reclaim idle Always Free instances.

Do not allocate a VM per Nova user until a paid infrastructure model, lifecycle controls, quotas, abuse prevention, and observability are defined. For the current files/folders product, the hosted app and database remain the appropriate architecture.

## Sources

1. Oracle, [Always Free Resources](https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), updated 2026-06-12.
2. Google Cloud, [Free Google Cloud features and trial offer](https://docs.cloud.google.com/free/docs/free-cloud-features).
3. AWS, [AWS Free Tier](https://aws.amazon.com/free/).
