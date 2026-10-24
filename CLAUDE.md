# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Nova Cloud Computer

Full-stack AI-agent cloud computer. Each user gets a persistent workspace with an AI agent that chats, manages files, runs scheduled automations, and executes in isolated E2B sandboxes. Monorepo: React SPA + Express/tRPC server + Neon Postgres (Drizzle ORM) + AI gateway. Production deploys exclusively to **Vercel** (`nova-cloud-computer`, `main` branch); never deploy elsewhere.

## Commands

Package manager: **pnpm** (`pnpm@10.4.1`).

```bash
pnpm install                    # install deps
pnpm dev                        # dev server (tsx watch server/_core/index.ts)
pnpm check                      # check SPA cache convention + tsc --noEmit
pnpm test                       # vitest run (all tests)
pnpm build                      # vite SPA + esbuild server bundles + copy migrations
pnpm start                      # run production build (NODE_ENV=production node dist/index.js)
pnpm db:push                    # drizzle-kit generate && drizzle-kit migrate
pnpm db:migrate                 # drizzle-kit migrate only
pnpm db:migrate:deploy          # migrate if DATABASE_URL present, skip otherwise (CI-safe)
pnpm format                     # prettier --write .
```

Single test file:
```bash
pnpm exec vitest run server/peakQueue.test.ts
pnpm exec vitest run client/src/lib/chatMessages.test.ts
```

DB migrations live in `drizzle/neon/`; schema in `drizzle/schema.ts`. Config: `drizzle.config.ts`.

## Project Structure

```
api/[...path].ts        Vercel serverless entry (mounts Express app)
api/spa.ts              SPA fallback handler
client/src/             React 19 SPA (Vite 7, Tailwind 4, Radix UI, wouter, TanStack Query, tRPC client)
  pages/                Home, SignIn, Workspace, Files, Chats, Deployments, Skills, etc.
  components/           DashboardLayout, ui/ (shadcn/Radix), workspaceChat, etc.
  lib/                  trpc client, neonAuth, attachments, chatMessages, etc.
  i18n/                 en/de/es/fr/ja/pt/zh translations
server/                 Express + tRPC v11 backend
  _core/                env, context, trpc, cookies, sdk, heartbeat, vite
  app.ts                Express app + route mounting (Telegram/AgentMail webhooks, tRPC, Inference API)
  index.ts              HTTP bootstrap + static SPA fallback
  routers.ts            Main tRPC router (auth, workspace, telegram, ai, agentVm, automations, files, chats, agents, skills, etc.)
  db/                   Data-access layer split by domain (agentRuns, automations, chats, credits, workspaceFiles, etc.)
  workspaceAgent.ts     Agent execution against workspace
  agentVm.ts / e2b.ts   E2B sandbox orchestration
  aiGateway.ts          Built-in AI gateway client (TokenHarbor)
shared/                 Shared types/constants (client+server): const, skills, agentMode, text, timing
drizzle/                Schema + migrations (schema.ts, relations.ts, neon/)
docs/                   Research/design notes (AI gateway contract, agent VMs)
vercel.json             Build command, rewrites, headers, function config
vite.config.ts          Aliases @/@shared/@assets, dev server, Manus debug collector plugin
vitest.config.ts        Test env NOVA_PEAK_QUEUE=off, includes server/api/client globs
```

## Architecture

**Client -> Server:** Browser SPA calls `/api/trpc/*` via tRPC + superjson with Bearer/session auth. `server/_core/context.ts` builds per-request context (user/session/ban status). `server/_core/trpc.ts` defines `publicProcedure` / `protectedProcedure` / `adminProcedure`.

**tRPC Router (`server/routers.ts`):** Single `appRouter` re-exporting `system`, `admin`, `auth`, `workspace`, `composio`, `telegram`, `ai`, `support`, `deployments`, `terminal`, `agentVm`, `automations`, `folders`, `files`, `skills`, `chats`, `agents`, `models`, `projects`, `tasks`. `server/_core/systemRouter.ts` and `server/adminRouter.ts` handle system/admin concerns.

**Database (Neon Postgres + Drizzle):** Core tables in `drizzle/schema.ts`: `users/workspaces`, `chats/chat_messages`, `agent_profiles/chat_agents/agent_approvals/agent_emails`, `folders/files`, `automations/automation_runs`, `user_automations`, `projects/tasks`, `workspace_skills`, `model_provider/model_secrets`, `api_keys`, `inference_queue` (peak-hours FIFO), `running_processes` (durable ledger for resumable work), `priority_purchases`, `agent_runs`. Migrations via `drizzle-kit`.

**Agent & Inference:** Conversational work routes through `server/agentRuns.ts` -> `server/workspace/workspaceAgent.ts` -> `server/aiGateway.ts` (TokenHarbor gateway; fallback to Xiaomi MiMo / SeekAI). Scheduled automations via `server/automations.ts` + heartbeat (`server/_core/heartbeat.ts`) + cron callback `/api/scheduled/automation`. Peak-hours queue (`server/peakQueue.ts`, `server/peakQueueWorker.ts`, `server/peakQueueScheduler.ts`) defers inference when saturated. `server/runningProcesses.ts` resumes work after Vercel kills invocations.

**E2B Sandboxes:** `server/e2b.ts` wraps E2B SDK; `server/agentVm.ts` manages per-workspace persistent + ephemeral sandboxes (pause/resume). Desktop browser sandbox (`browserSandboxId`) is separate from workspace VM.

**Webhooks (Express, `server/app.ts`):** Telegram (`/api/telegram/webhook/:token`), AgentMail inbound (`/api/agentmail/webhook` — raw body for Svix signature), scheduled automation callback.

**Deployment (`vercel.json`):** Build: `pnpm exec tsx server/migrate-deploy.ts && pnpm run build`. Output `dist/public`, serverless `api/[...path].ts` (maxDuration 300, includes `dist/server/**`). Rewrites: `/api/*` -> function, rest -> `api/spa.ts`. `server/migrate-deploy.ts` is best-effort (deploys even if DB unreachable; runtime retries).

## Path Aliases & Config

- `@` -> `client/src`, `@shared` -> `shared`, `@assets` -> `attached_assets` (defined in both `vite.config.ts` and `vitest.config.ts` / `tsconfig.json`).
- `tsconfig.json` uses `bundler` resolution, `allowImportingTsExtensions`, `jsx: preserve`.
- `vitest.config.ts`: `environment: node`, `env: { NOVA_PEAK_QUEUE: "off" }` for deterministic tests. Matches `server/**/*.test.ts`, `api/**/*.test.ts`, `client/src/**/*.test.{ts,tsx}`.
- Formatting: Prettier (`.prettierrc`, `.prettierignore`).

## Environment (see `server/_core/env.ts`)

Key vars: `DATABASE_URL`, `E2B_API_KEY`, `TOKENHARBOR_API_KEY` / `TOKENHARBOR_GATEWAY_URL`, `OAUTH_SERVER_URL` / `NEON_AUTH_BASE_URL`, `AGENTMAIL_API_KEY` (real inbox), `DEFAULT_TELEGRAM_BOT_TOKEN`, `SEEKAI_API_KEY` (last-resort fallback). `NOVA_PUBLIC_BASE_URL` / `PUBLIC_APP_URL` for webhook URLs. Secrets are server-only; never expose to browser.

## Git Workflow (per AGENTS.md)

- **Minor** (typo, one-liner, docs, formatting): commit and push directly to `main`.
- **Everything else** (features, refactors, behavior changes, multi-file): create branch, open PR with `main` as base. Never push directly for CI/CD, deps, auth, or production behavior changes.
- Push directly only if change is one sentence and low-risk; when in doubt, open a PR.
- Follow existing commit style (`git log`). Do not add author/co-author or `Generated with ...` footers.
- After fixing coderabbit reviews, do not re-trigger review. If AI reviewers rate-limited, do not poll.
