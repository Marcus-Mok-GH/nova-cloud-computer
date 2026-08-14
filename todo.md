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
- [ ] Verify the external deployment and passwordless sign-in journey.
- [x] Provision and connect the Neon database through Vercel’s marketplace integration.
- [ ] Fix the Vercel-managed Neon connection path and prove an external database connection.
- [ ] Apply Nova’s Postgres schema and verify workspace persistence on Vercel-managed Neon.
- [ ] Browser-verify the deployed Neon magic-link session and protected workspace route.
- [ ] Use a disposable inbox to request, receive, and complete a one-time Nova magic-link sign-in test.
- [ ] Add a Vercel SPA fallback so direct passwordless routes resolve instead of returning a platform 404.
- [ ] Diagnose and resolve the deployed magic-link request that remains pending instead of confirming delivery.
- [ ] Preserve Vercel serverless API routes while applying the static SPA fallback.
