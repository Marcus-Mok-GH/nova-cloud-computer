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
- [ ] Add hosted-model tool support for file move and folder rename, move, and delete actions.
- [ ] Add regression coverage for agent file moves, folder moves, and file/folder deletion paths.
- [ ] Verify direct user controls and agent-driven delete flows for files and folders in the production browser.
