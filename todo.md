# Dark Theme Update

- [x] Define the theme preference model and controls.
- [x] Add a persistent light/dark switcher to the navigation.
- [x] Create Nova-specific dark color, surface, and typography treatments.
- [x] Verify desktop and mobile renderings in both themes.

# Full-Stack Backend

- [x] Enable the authenticated full-stack project foundation.
- [x] Define workspace, project, and task storage models.
- [x] Add authenticated API routes and client data flows.
- [x] Verify persistence and permission boundaries.
- [x] Add a workspace-loading error state with retry guidance.
- [x] Add authenticated CRUD and cross-user tenancy tests for workspace data.
- [x] Verify project and task mutations against the live database.
- [x] Add authenticated router CRUD tests for project and task operations.
- [x] Extend cross-user tests to cover read, update, and project isolation.

# Zo Computer Product Alignment

- [x] Research Zo Computer’s current capabilities, operating model, and positioning from primary sources.
- [x] Translate the findings into Nova-specific product requirements and messaging changes.
- [x] Update the landing page and authenticated workspace to reflect the new product model.
- [x] Verify the research-informed product experience and changed flows.

# Workspace-First Model Settings

- [x] Add persistent workspace preferences and active-model selection.
- [x] Add private, encrypted custom-model configuration storage.
- [x] Add authenticated APIs for provider and custom-model management.
- [x] Build model selection and custom-provider configuration screens.
- [x] Verify model configuration privacy and user-scoped access.
- [x] Browser-verify the updated personal-cloud landing page.
- [x] Browser-verify the workspace settings layout and model configuration controls; defer signed-in interaction at the user’s request.
- [x] Record that optional signed-in browser interaction testing was deferred at the user’s request.

# GitHub Export

- [x] Create a private GitHub repository for the Nova workspace.
- [x] Push the complete project source, migrations, tests, and documentation.
- [x] Verify the remote repository contains the exported workspace.

# GitHub Visibility

- [x] Change the Nova repository visibility to public.
- [x] Verify the public repository URL and visibility.

# External Deployment and Authentication

- [x] Verify whether the Manus OAuth application can serve an external Vercel domain.
- [x] Define the Vercel-managed Neon architecture, including passwordless email login.
- [x] Replace Manus authentication with the selected compatible auth flow.
- [x] Configure Vercel deployment and required production environment variables.
- [x] Verify the external deployment and passwordless sign-in journey.
- [x] Provision and connect the Neon database through Vercel’s marketplace integration.
- [x] Fix the Vercel-managed Neon connection path and prove an external database connection.
- [x] Apply Nova’s Postgres schema and verify workspace persistence on Vercel-managed Neon.
- [x] Browser-verify the deployed Neon magic-link session and protected workspace route.
- [x] Use a disposable inbox to request, receive, and complete a one-time Nova magic-link sign-in test.
- [x] Add a Vercel SPA fallback so direct passwordless routes resolve instead of returning a platform 404.
- [x] Diagnose and resolve the deployed magic-link request that remains pending instead of confirming delivery.
- [x] Preserve Vercel serverless API routes while applying the static SPA fallback.
- [x] Directly enable the Neon Managed Better Auth Magic Link plugin and complete the disposable-inbox sign-in verification.
- [x] Verify and record the GitHub-to-Vercel automatic deployment linkage for the public Nova repository.
- [x] Diagnose and fix the reported production email-login "Load failed" error, then repeat the magic-link verification.
- [x] Audit Vercel production environment variables and fix the remaining deployed email-login failure only after reproducing it on the affected domain.
- [x] Run and document a fresh end-to-end production test: email request, delivered magic link, callback, authenticated workspace, and API connection—before any further push.
- [x] Repeat the complete magic-link flow from a clean Neon session and verify the authenticated workspace email matches the requested fresh mailbox.
- [x] Replace opaque Neon session-token forwarding with the documented JWT token API, then rerun the clean-session production magic-link test before any push.
- [x] Record that the completed clean-session production test covered the exact deployed JWT-token code state before any subsequent documentation push.
- [x] Include the Neon JWT client regression test in Vitest discovery and rerun the complete automated suite.
- [x] Add an explicit deployment-and-commit record for the clean-session success to the external-auth verification document before saving the checkpoint.
- [x] Reproduce, diagnose, and resolve the newly reported canonical-domain magic-link “Load failed” regression using current Vercel and browser evidence.
- [x] Proxy Neon Auth through Nova’s canonical Vercel origin so browser sessions do not depend on third-party-cookie availability.
- [x] Replace the invalid-hostname external rewrite with a serverless Neon Auth proxy that forwards request bodies, cookies, and upstream response headers safely.
- [x] Retire the public static Vercel function endpoint after nested routing proved unreliable; dispatch Neon Auth through the proven API catch-all instead.
- [x] Preserve Neon Auth callback query parameters through the API catch-all so `neon_auth_session_verifier` reaches the session exchange endpoint.
- [x] Use a same-origin dynamic Neon Auth base path because the installed Neon adapter bypasses caller-supplied custom fetch implementations.
- [x] Rewrite proxied Neon Auth session-cookie domains for Nova’s same-origin host so the browser retains the callback session.
- [x] Include the static Neon Auth proxy-cookie regression test in Vitest discovery and rerun the complete suite.
- [x] Replace the query-injected proxy route because it drops the callback verifier before the upstream Neon session exchange.
- [x] Dispatch Neon Auth proxy requests inside the proven Vercel catch-all API function instead of relying on unresolved nested function routing.
- [x] Derive the Neon Auth endpoint from the original request URL when Vercel omits the catch-all route parameter.
- [x] Preserve Neon’s signed-session response header through the catch-all proxy so the browser client forwards a JWT to Nova’s API.
- [x] Use the verified same-origin Neon token endpoint as the workspace bearer-token fallback when the installed adapter does not surface the signed session header.
- [x] Replace the logged-in project dashboard with a chat-first personal cloud workspace.
- [x] Add tenant-scoped folders and files that users and Nova’s AI agent can create, organize, rename, and remove.
- [x] Persist chats and messages and present conversations as a dedicated lower-navigation destination.
- [x] Add a lower authenticated navigation for Deployments, Chats, and Settings.
- [x] Wire agent chat requests to safe workspace file and folder actions.
- [x] Verify the redesigned authenticated workspace with tests and browser checks.
- [x] Load persisted chat history after navigation or reload and let users open conversations from the Chats destination.
- [x] Add user and agent support for file and folder rename, move, and delete actions in the chat-first workspace.
- [x] Add regression and browser coverage for workspace item CRUD and persisted conversation history.
- [x] Add complete user and agent folder/file move support, including folder rename and move behavior.
- [x] Verify workspace file and folder rename, move, and delete flows end to end in the browser.
- [x] Add regression coverage for agent-driven and folder-management rename, move, and delete actions.
- [x] Add hosted-model tool support for file move and folder rename, move, and delete actions.
- [x] Add regression coverage for agent file moves, folder moves, and file/folder deletion paths.
- [x] Expose direct user controls and verify agent-driven file and folder delete flows in the production browser.
- [x] Add encrypted per-user Telegram Bot token and chat configuration storage.
- [x] Add tenant-scoped Telegram token validation, configuration, and message-sending APIs.
- [x] Add Telegram setup and test-message controls to Nova Settings.
- [x] Allow Nova’s workspace agent to send explicit user-requested Telegram messages.
- [x] Test Telegram encryption, validation, tenant boundaries, and outbound messaging behavior with mocked official Bot API responses; real delivery awaits a user-provided BotFather token.
- [x] Add Telegram-specific regression coverage for encrypted persistence and safe non-disclosure of bot credentials.
- [x] Add protected Telegram router tests for configuration, chat discovery, test delivery, removal, and tenant isolation.
- [x] Defer real BotFather-token entry and live delivery verification to the authenticated end user inside Nova Settings; no credential is requested or accepted in chat.
- [x] Add a Telegram database-layer regression test for encrypted storage, owner-only credential retrieval, and safe settings responses.
- [x] Prove Telegram database reads cannot return bot credentials or settings across workspace owners.
- [x] Confirm the deployed Settings flow keeps BotFather token entry in the authenticated UI and scopes encrypted credentials to the active workspace account.
- [x] Browser-verify the authenticated production Telegram Settings card: BotFather token entry is a password-only field with no displayed value, and the initial safe state exposes no credential; live credential entry remains an authenticated end-user action.
- [x] Make the Workspace tab render the active workspace’s persisted files and folders with practical empty, loading, and error states.
- [x] Add regression coverage for the Workspace tab’s rendered folders and files.
- [x] Add rendered-UI regression coverage for Workspace folders, files, loading, empty, and error states.
- [x] Diagnose and repair the surfaced production deployment startup failure without regressing the external Vercel deployment; the Vercel production build for commit e74feb4 is READY and `/app` loads successfully.
- [x] Research viable free cloud-VM providers for Nova’s workspace model and recommend one based on practical product constraints; documented the Oracle Always Free proof-of-concept recommendation and alternatives.
- [x] Re-evaluate Nova’s cloud-runtime recommendation against the strict requirement of no credit card and no paid-account conversion.
- [x] Document the best genuinely free no-credit-card alternative and its operational limitations for the workspace model: GitHub Codespaces for quota-bounded interactive compute, not an always-on VM.
- [x] Define an agent-executable Linux VM strategy for Nova under the no-credit-card constraint, including scoped workspace bundles, an ephemeral GitHub-hosted Ubuntu Actions runner, and durable result persistence outside the VM.
- [x] Clarify the product and infrastructure limitation: no reliable always-on third-party VM satisfies both zero-cost and no-credit-card requirements, so GitHub Actions is limited to bounded agent jobs.
- [x] Evaluate Daytona as Nova’s agent-VM and sandbox platform, including lifecycle, isolation, control APIs, persistence, pricing, and security boundaries.
- [x] Decide to replace the GitHub Actions agent-VM proposal with Daytona for Nova’s constrained agent-compute rollout; document the server-side API-key boundary, scoped workspace transfer, lifecycle controls, and post-credit cost decision.
- [x] Decide Nova’s post-Daytona-trial cost policy: disable new agent runs at credit exhaustion; never collect a card, convert to paid usage, or silently fall back to a paid route.
- [x] Define Daytona sandbox concurrency, resource, TTL, and network-limit requirements that enforce Nova’s selected zero-spend policy.
- [x] Compare Daytona and E2B for Nova’s agent VM across isolation, lifecycle, persistence, API control, observability, commercial model, and no-card safeguards.
- [x] Select Daytona as the preferred Nova agent-VM platform; retain E2B as the self-hosting contingency and retain the zero-spend feature-disablement policy at credit exhaustion.
- [x] Define tenant-scoped Daytona sandbox-run persistence, API contracts, and a secure workspace bundle model.
- [x] Add a server-only Daytona client that creates, labels, executes in, and deletes bounded agent sandboxes without exposing the provider key.
- [x] Add safe agent tools for creating a run, executing allowlisted workspace commands, streaming sanitized status, importing declared artifacts, and cancelling active work.
- [x] Enforce Daytona zero-spend controls: one active run per owner, resource limits, default-deny egress, timeout/TTL, and credit-exhaustion disablement.
- [x] Build authenticated Workspace controls and run-status history for Daytona agent execution.
- [x] Add unit, router, persistence, and rendered-UI tests for Daytona agent VM behavior and tenant isolation.
- [x] Implement verified polling-based Daytona run progress updates and surface sanitized status changes in Workspace.
- [x] Add tracked zero-spend allowance enforcement that blocks new Daytona runs when Nova’s configured trial allowance is exhausted.
- [x] Add a Daytona database-layer persistence test for run creation, state transitions, cancellation, artifact linkage, and owner isolation.
- [x] Add a rendered-Workspace regression test proving polling observes an active Daytona run transition to completion.
- [x] Rename Daytona zero-spend allowance messaging to the accurate Nova-configured run-cap policy unless and until Daytona credit telemetry is integrated.
- [x] Configure the Daytona API credential only after the integration is tested and deploy the verified production integration.
- [x] Add the validated `DAYTONA_API_KEY` to the linked Vercel project’s Production environment as a sensitive variable.
- [x] Use the authorized Vercel CLI to set Nova’s existing validated `DAYTONA_API_KEY` for Production; production Workspace now reports Daytona as Ready.
- [x] Authenticate the local Vercel CLI through the user-authorized device-login link and configure Nova’s Production `DAYTONA_API_KEY` without printing the value.
- [x] Repair the Vercel Daytona deployment by making the already-applied Neon migration replay-safe, then verify the GitHub-triggered production build is READY.
- [x] Evaluate Freebuff’s framework for use by Nova’s AI agent, including its runtime model, licensing, supported tools, security posture, and Daytona compatibility.
- [x] Decide not to make Freebuff the default agent runtime; document Codebuff SDK as a future opt-in, explicit-consent provider with Daytona retaining command execution and isolation.
- [x] Verify that a user-provided Codebuff API key works with Nova’s proposed Codebuff SDK integration and distinguish it from Freebuff CLI’s separate no-key mode.
- [x] Define the required encrypted per-workspace credential storage and server-only execution boundary if Codebuff is added.
- [x] Define the Codebuff planner request, consent, bundle, and return contract without exposing workspace credentials or Daytona access.
- [x] Add replay-safe owner-scoped encrypted Codebuff credential persistence and protected status, configure, remove, and planner-run procedures.
- [x] Implement the server-only Codebuff SDK adapter with bounded planning and sanitized structured output.
- [x] Add a Settings card for authenticated password-only Codebuff key entry and safe connection metadata.
- [x] Add opt-in Agent VM planner controls with selected-file consent and a third-party data warning.
- [x] Add credential-isolation, persistence, router, adapter, and rendered-UI regression tests for Codebuff planning.
- [x] Verify TypeScript, the full test suite, production build, GitHub push, and deployed production behavior before publishing the Codebuff planner.
- [x] Browser-verify the deployed production Settings page shows the password-only Codebuff API key card with no credential disclosure.
- [x] Browser-verify the deployed production Workspace shows the default-off Codebuff planner controls, selected-file consent flow, and provider-aware activity UI.
- [x] Repair the production serverless bundle so Codebuff’s SDK dependency does not break Neon Auth requests, then repeat authenticated production verification.
