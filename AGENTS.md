# AGENTS.md

Instructions for AI agents working in this repository.

## Git workflow

- For **minor changes** — typo fixes, small copy tweaks, one-line fixes, doc updates, formatting — commit and **push directly to `main`**. Do not open a PR.
- For **everything else** — new features, refactors, behavior changes, anything touching multiple files or systems — **create a branch and open a pull request against the main branch**. Do not push directly to `main`.
- After fixing coderabbit reviews, **DO NOT** trigger another review.
- If the AI reviewers are rate-limited (even if it is 1 minute), **DO NOT POLL**.

### Rules

- Push directly only if you can describe the change in a single sentence and it is low-risk. Otherwise, open a PR.
- Always use a PR if the change is destructive, touches CI/CD config, dependencies, auth, or production behavior.
- When in doubt, open a PR.
- Open the pull request with `main` as the base branch (the feature branch as the head).
- Follow the existing commit message style (check `git log`).
- Never push directly to `main` on someone else's behalf unless explicitly asked.
- Remember, create a PR for complex changes, including for complicated backend changes, but if it's a simple frontend change, just push it directly.

## Base44 sandbox environment

Run the app in the sandbox with `docker compose -f docker-compose.base44.yml up -d --build`
(`app` on host port 3000, `postgres` on a private network). Notes that aren't obvious from the manifests:

- `app` runs the repo's own `pnpm dev` (`tsx watch server/_core/index.ts`), which serves the Vite SPA and the
  Express/tRPC API from the single port 3000 origin — no separate client build step is needed.
- The database is a local `postgres:16` service. `DATABASE_URL`/`DATABASE_URL_UNPOOLED` point at it with
  `sslmode=disable`, because `server/db/core.ts` treats non-loopback hosts as TLS-required.
- Schema is created at boot by `ensureDatabaseSchema()` from `drizzle/neon`; there is no separate migration step.
- Dependencies are installed into the `nova-node-modules` volume at container start from `pnpm-lock.yaml`
  (pnpm 10.4.1 from `Dockerfile.base44`). Never run a second installer against that volume concurrently.
- Verify with `curl -fsS http://localhost:3000/api/health` (reports DB latency), then the landing page at `/`.
- `/sign-in` needs `NEON_AUTH_BASE_URL` (server JWT verification) and `VITE_NEON_AUTH_URL` (browser email-OTP
  client) — both the same Neon Auth URL; without them the form renders but every sign-in attempt is rejected.
  `NEXTAPI_API_KEY` enables AI replies, `E2B_API_KEY` enables sandbox runs. Secrets come from
  `/run/base44/app.env` (wired via `env_file`), never from a committed file.
- `BASE44_PREVIEW_MODE` is passed through to the container only; no code path reads it, so there are no
  sandbox-only behavior overrides in the application.

## Commit and PR attribution

- Never add author or co-author lines, `Generated with ...` footers, emoji signatures, or any other agent/tool attribution to commit messages or pull request descriptions.
- A commit message (and PR description) should describe the change and nothing else.
