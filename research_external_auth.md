# External Hosting and Authentication Assessment — August 2026

## Finding

Nova’s present authentication is a **Manus-managed OAuth flow**. It dynamically forms its callback as `<current-origin>/api/oauth/callback`, then relies on the Manus OAuth portal, the Manus callback service, and platform-provided session infrastructure. The official documentation describes authentication as a built-in Website Builder capability within Manus’s managed build-and-host environment; it does not document an externally hosted Vercel callback or a supported way to carry the managed authentication runtime off-platform.[1][2]

The external-domain compatibility question therefore cannot be positively verified from current official material. Nova should not be deployed to Vercel with Manus Auth under an unsupported assumption.

## Recommended external architecture

| Concern | Recommended service | Rationale |
| --- | --- | --- |
| Hosting | Vercel | Hosts the Vite frontend and serverless API routes. |
| Database | Neon Postgres | Replaces the current Manus-managed MySQL database with a Vercel-compatible serverless Postgres connection. |
| Authentication | Email magic links | Passwordless sign-in is compatible with the user’s requirement; tokens are hashed, single-use, and time-limited in Postgres. |
| Email delivery | Resend (or equivalent SMTP provider) | Sends the sign-in link; requires a verified sender domain and provider API key. |

This approach removes reliance on Manus Auth and does not require users to choose or maintain passwords. It will require access to a Neon project, a Vercel project, and an email-delivery credential before production deployment.

## Vercel-managed Neon confirmation

Vercel’s native Neon marketplace integration is the selected database path. It provisions a Postgres database under Vercel billing, injects `DATABASE_URL` and related connection variables into the linked Vercel project, and can inject `NEON_AUTH_BASE_URL` plus `VITE_NEON_AUTH_URL` when Managed Better Auth is enabled.[3] The resource has been provisioned as `nova-neon` on Vercel’s free plan and connected to Nova’s production, preview, and development environments.

Neon Managed Better Auth supports time-limited, passwordless Magic Link sign-in. Auth stores its users and sessions directly in Neon’s `neon_auth` schema, while the application can obtain a short-lived JWT and verify it against Neon’s JWKS endpoint before serving its API.[4][5] Neon documents custom SMTP as a production requirement for reliable magic-link delivery; its default shared SMTP remains suitable only for development and testing.[6]

## Deployment verification finding

The production root route renders successfully on Vercel. Direct navigation to `/sign-in` returned Vercel `404 NOT_FOUND`, confirming that the static Vite application needs an SPA rewrite so client-side routes are served by `index.html`. This must be corrected before testing the magic-link form.

After the SPA rewrite was deployed, the direct `/sign-in` route rendered correctly. A user-approved disposable-inbox request was submitted to the deployed magic-link form; the UI remained in its `Sending secure link…` state rather than reporting a completed request. The next verification step is to inspect the hosted request and Neon Auth configuration before treating email delivery as functional.

The initial catch-all SPA rewrite also intercepted `/api/health`, returning the client application’s own 404 instead of the serverless response. The fallback therefore needs Vercel filesystem handling before the SPA catch-all so function routes stay reachable.

Vercel’s production build successfully applied Nova’s Postgres migration against the Vercel-managed Neon database and built the Vite client. The first serverless bundle reported two TypeScript diagnostics in `server/app.ts` and `server/_core/context.ts`; those were corrected and redeployed. Nova now bundles the API application for Vercel’s Node runtime and routes `/api/*` explicitly before the SPA fallback. The deployed `GET /api/health` endpoint returns `{"ok":true,"service":"nova"}`.

The final production sign-in verification is complete. The Neon Magic Link plugin was enabled on the existing `nova-neon` managed-auth configuration, with the deployed Vercel origin added to the narrow trusted-origin allowlist. A user-approved Guerrilla Mail inbox received a time-limited sign-in link, the link created a Neon session, and the browser reached Nova’s authenticated `/app` workspace. The client now calls Neon Auth `getSession()` when resolving the bearer token; this exchanges the callback verifier and makes the issued JWT available before the first protected API request.

The canonical production domain initially remained absent from the Neon trusted-origin list, causing browser-side passwordless requests from `https://nova-cloud-computer.vercel.app` to fail as **“Load failed.”** The allowlist now includes Nova’s canonical Vercel domain, team-scoped alias, and `main` branch alias. A fresh magic-link request from the canonical domain completed successfully, the email arrived, and the browser reached the authenticated workspace after following the link.

An additional audit verified the deployed environment configuration rather than relying only on local behavior. The active Vercel JavaScript bundle contains the expected `VITE_NEON_AUTH_URL` endpoint, while the protected serverless `auth.me` and workspace requests return `200`, confirming the deployed server can use `NEON_AUTH_BASE_URL` for JWT verification. The remaining issue was reproduced on a deployment-specific Vercel URL as **“Invalid callbackURL”**: dynamic URLs are different on each build and cannot safely be used as long-lived magic-link destinations. Nova now maps every `.vercel.app` sign-in request to the canonical `https://nova-cloud-computer.vercel.app/app` callback, with regression coverage. The latest Vercel deployment accepted a fresh magic-link request from its unique alias and displayed the completed email-sent confirmation.

Production application persistence was also verified. An authenticated test user created the project **“Neon persistence verification”** in the deployed workspace, reloaded `/app`, and the project remained visible with its original description. This confirms Nova’s tenant-scoped workspace data is being persisted through Vercel’s API to the Vercel-managed Neon Postgres database. The shared Neon SMTP sender successfully delivered this disposable-inbox test; production should still use a configured sender domain and dedicated SMTP provider such as Resend for deliverability and operational control.[6]

## GitHub-to-Vercel linkage

Nova’s public repository, [`Marcus-Mok-GH/nova-cloud-computer`](https://github.com/Marcus-Mok-GH/nova-cloud-computer), is already connected to Vercel project `prj_qUEuLpLJndnrWOtVau8HQTteG3c8`. Vercel production deployments are triggered automatically from the repository’s `main` branch. The verified production branch alias is [`nova-cloud-computer-git-main-sjdjdiejdrirhdkjejs-projects.vercel.app`](https://nova-cloud-computer-git-main-sjdjdiejdrirhdkjejs-projects.vercel.app); the latest GitHub-triggered deployment is in the `READY` state.

## Sources

[1] [Manus Website Builder — Getting started](https://manus.im/docs/website-builder/getting-started)

[2] [Manus Website Builder — Access control](https://manus.im/docs/website-builder/access-control)

[3] [Neon — Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration)

[4] [Neon Auth — Magic Link](https://neon.com/docs/auth/guides/plugins/magic-link)

[5] [Neon Auth — JWT](https://neon.com/docs/auth/guides/plugins/jwt)

[6] [Neon Auth — Production checklist](https://neon.com/docs/auth/production-checklist)
