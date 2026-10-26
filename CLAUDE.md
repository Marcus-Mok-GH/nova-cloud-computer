# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Nova Cloud Computer

Full-stack AI-agent cloud computer. Each user gets a persistent workspace with an AI agent that chats, manages files, runs scheduled automations, and executes in isolated E2B sandboxes. Monorepo: React SPA + Express/tRPC server + Neon Postgres (Drizzle ORM) + AI gateway. Production deploys exclusively to **Vercel** (`nova-cloud-computer`, `main` branch); never deploy elsewhere.

## Commands

Package manager: **pnpm** (`pnpm@10.4.1`).

```bash
pnpm install            # install deps
pnpm dev                # dev server (tsx watch server/_core/index.ts), Vite middleware
pnpm check              # check:spa-cache + tsc --noEmit
pnpm check:spa-cache    # verify the SPA shell stays uncached (reads vercel.json + api/spa.ts)
pnpm test               # vitest run (all tests)
pnpm build              # vite SPA + esbuild server bundles + copy migrations
pnpm start              # run production build (NODE_ENV=production node dist/index.js)
pnpm db:push            # drizzle-kit generate && drizzle-kit migrate
pnpm db:migrate         # drizzle-kit migrate only
pnpm db:migrate:deploy  # migrate if a database URL is present, skip otherwise (CI-safe)
pnpm i18n:translate     # regenerate non-English locales from en.ts
pnpm format             # prettier --write .
```

Single test file:

```bash
pnpm exec vitest run server/peakQueue.test.ts
pnpm exec vitest run client/src/lib/chatMessages.test.ts
```

Gotchas that will bite you:

- `tsconfig.json` **excludes `**/\*.test.ts`**, so `pnpm check` never type-checks test files — a type error that exists only in a test passes CI.
- CI (`.github/workflows/pr-validation.yml`) runs `check` → `build` → `test`, then boots `dist/index.js` on `PORT=4176` and curls `/api/health`. **The build must precede the tests**: `api/[...path].ts` lazily `require`s the bundled `dist/server/app.cjs`, and the tests that exercise the real request-dispatch path need that artifact on disk.
- Migrations live in `drizzle/neon/` (schema `drizzle/schema.ts`, config `drizzle.config.ts`, which prefers `DATABASE_URL_UNPOOLED` over `DATABASE_URL` because drizzle-kit holds a dedicated DDL connection).
- Vitest runs with `environment: "node"` (no jsdom anywhere) and `NOVA_PEAK_QUEUE=off` for determinism.

## Project Structure

```
api/[...path].ts        Vercel serverless entry: Neon Auth proxy, co-deployed API, else optional remote API
api/spa.ts              SPA shell handler — serves dist/public/index.html with no-store
client/src/             React 19 SPA (Vite 7, Tailwind 4, Radix UI, wouter, TanStack Query, tRPC client)
  App.tsx / appTree.tsx Route table + the tree both browser and SSR entries mount
  pages/                Home, SignIn, Workspace, Files, Chats, Agents, Skills, Deployments, Terminal, …
  components/           DashboardLayout, ui/ (shadcn/Radix), workspaceChat (presentation)
  hooks/                useWorkspaceChat (chat behaviour), useAuth
  lib/                  trpc client, neonAuth, chatMessages, attachments, awayChats, supportBot
  i18n/                 en (base) + de/es/fr/ja/pt/zh, manifest.json for the translation script
server/                 Express + tRPC v11 backend
  _core/                env, context, trpc, cookies, sdk, heartbeat, supportBotPath, vite
  app.ts                Express app + route mounting
  index.ts              HTTP bootstrap + static SPA fallback (long-running / self-hosted)
  routers.ts            Main tRPC appRouter
  db/                   Data-access layer split by domain (agentRuns, automations, chats, credits, …)
  workspace/            Agent execution against a workspace (workspaceAgent, tools, security, sync)
  workspaceTools/       Individual agent tools (browser, codec, files, folders, research, vm, …)
  agentVm.ts / e2b.ts   E2B sandbox orchestration
  aiGateway.ts          Built-in AI gateway client (TokenHarbor)
shared/                 Modules both sides import: const, skills, agentMode, followUps, text, timing, speech
drizzle/                schema.ts, relations.ts, neon/ migrations
docs/                   Research/design notes (AI gateway contract, autonomous agent, VM selection, i18n)
vercel.json             Build command, rewrites, headers, function config
vite.config.ts          Aliases @/@shared/@assets, dev server, Manus debug collector plugin
vitest.config.ts        Test env + include globs
```

## Architecture

### Two client→server paths

The SPA talks to the backend over **both** tRPC and plain Express routes, and it sends **both** a cookie and a Bearer token:

- **tRPC** at `/api/trpc` (`appTree.tsx`): `httpBatchLink` with `transformer: superjson`, `credentials: "include"`, and an async `headers()` that adds `Authorization: Bearer <token>` when one resolves.
- **Plain HTTP routes** in `server/app.ts`, which is where everything streaming or webhook-shaped lives. These are easy to miss because they are not in the router:
  - `POST /api/chat/stream` — SSE chat turn (the real delivery path; see below).
  - `POST /api/chat/delete`
  - `POST /api/agent/continue`, `POST /api/agent/process/resume`, `POST /api/agent/queue/advance` — resume/continuation hooks for work the platform interrupted.
  - `POST /api/v1/...` (`server/inferenceApi.ts`) — OpenAI-compatible inference API for external clients, authenticated with a Nova API key (`Authorization: Bearer nova_sk_...`) instead of a session. It exposes exactly two models: the built-in one under the public alias `nova-pro` (`NOVA_PRO_MODEL_ID`, which deliberately never reveals the underlying gateway model id) and the workspace's own BYOK model when one is selected.
  - `GET /api/health`, `GET /api/status`, `GET /api/speech`
  - `GET|POST /api/user-automations`, `POST /api/user-automations/:id`
  - `POST /api/telegram/webhook/default` and `/api/telegram/webhook/:token`
  - `POST /api/agentmail/webhook` (raw body — required for the Svix signature)
  - `POST /api/scheduled/automation`, `POST /api/scheduled/user-automation` (cron callbacks; rejected unless `sdk.authenticateRequest` reports `isCron`)

`api/[...path].ts` decides what serves each of those. `/api/neon-auth/*` is proxied to `NEON_AUTH_BASE_URL` (stripping upstream `Domain`/`Partitioned` attributes so the CHIPS cookie works first-party). `isCoDeployedApiPath` is the allowlist of namespaces that must be handled in-process — `trpc`, `chat`, `telegram`, `agent`, `agentmail`, `health`, `status`, `speech`, `v1`, `user-automations`, `scheduled` — because they depend on Nova's own session or server-only credentials. Everything else is proxied to `API_SERVICE_URL` when that variable is set, and otherwise falls through to the co-deployed app.

### tRPC router and data model

`server/routers.ts` exports one `appRouter` mounting `system`, `admin`, `auth`, `credits`, `billing`, `apiKeys`, `workspace`, `composio`, `telegram`, `ai`, `support`, `deployments`, `terminal`, `agentVm`, `automations`, `folders`, `files`, `skills`, `chats`, `agents`, `models`, `projects`, `tasks` (plus `server/adminRouter.ts` and `server/_core/systemRouter.ts` for the admin/system namespaces).

Data access is a **separate layer** in `server/db/`, split by domain (chats, credits, automations, workspaceFiles, inferenceQueue, processes, priority, …). Routers validate with zod and delegate — a new query belongs in `server/db/`, not inline in the router body.

Notable tables in `drizzle/schema.ts`: `users` / `workspaces` / `workspace_settings`; `chats` / `chat_messages` / `conversation_memories`; `workspace_folders` / `workspace_files`; `agent_profiles` / `chat_agents` / `agent_approvals` / `agent_emails`; `automations` / `automation_runs` / `user_automations`; `projects` / `tasks`; `workspace_skills`; `custom_models` / `workspace_env_vars` / `env_var_requests` (BYOK and secrets); `api_keys` (the `nova_sk_...` keys that authenticate `/api/v1`); `agent_runs` / `agent_vm_runs`; `inference_queue` / `priority_purchases` (peak admission); `running_processes` (the resumable-work ledger); `daily_credits` / `mistral_inference_allowances` (billing); `telegram_bot_settings` / `telegram_update_log`; `site_deployments`; `nova_api_error_logs`.

### Auth

`server/_core/context.ts` builds the per-request `TrpcContext` (`user`, `banned`). Two credentials are accepted: the `app_session_id` cookie, and a Neon-issued JWT verified against the remote JWKS with `NEON_AUTH_ISSUER`/`NEON_AUTH_AUDIENCE`. A successful Bearer auth `upsertUser`s on every request, and a banned account is refused even with a valid token. `server/_core/trpc.ts` derives `publicProcedure` / `protectedProcedure` / `adminProcedure`; the `developer` role supersedes `admin`.

Client side: `lib/neonAuth.ts` prefers a cached JWT in `localStorage["nova_neon_access_token"]`, then `getSession()`, then `GET /api/neon-auth/token`. The cookie session remains the source of truth; the JWT is only forwarded. Sessions expire after 7 days of inactivity (`SEVEN_DAYS_MS`), tracked client-side with a throttled activity listener.

### A chat turn

1. `hooks/useWorkspaceChat.ts` `sendMessage` does `fetch POST /api/chat/stream` with an `AbortController` — **not** `EventSource` — then reads `response.body.getReader()` and splits on `\n`, handling `data: ` lines with `[DONE]` as the terminator.
2. Event shapes: `{type:"queued"}` / `{type:"priority"}` (peak-hours admission), `{type:"tool"}` (a `ToolActivity`), otherwise OpenAI-style `choices[0].delta.content`.
3. The transcript is **polled as a fallback, not used for delivery**: `chats.runStatus` every 3s while active else 30s; `chats.messages` every 5s while a run is active or streaming else 30s. On stream close the hook refetches the ledger and invalidates `workspace.computer`, `workspace.chats`, and `credits.status`.
4. The server persists internal bookkeeping as **ledger rows distinguished by a byte-for-byte prefix** declared in `shared/const.ts`: `__nova_tool_activity__:`, `__nova_specialist_acceptance__:`, `__nova_agent_mode__:`, `__nova_follow_ups__:`. The client filters these out of the visible transcript. Changing a prefix breaks already-persisted rows, so they are effectively frozen.

### The agent run

Every channel converges on one runner. Web SSE (`POST /api/chat/stream`), tRPC `chats.send`, the Telegram webhook, and the public `/api/v1` inference API all end up in `executeWebAgentRun` (`server/agentRuns.ts`), which opens an `agent_runs` ledger row, resolves the chat route, then calls `runWorkspaceAgent` (`server/workspace/workspaceAgent.ts`) — the actual loop.

The loop's shape is worth knowing before you change it:

- Tool calls come from the model in OpenAI form and are dispatched by a single `switch` in `workspace/workspaceToolExecutor.ts`. The JSON schemas live separately in `workspace/workspaceToolSchemas.ts` (~40 tools) — **to add a tool you edit the schema file and the dispatch switch, then implement the family in `server/workspaceTools/`**, where each module owns one family (`files`, `folders`, `plans`, `deploy`, `editor`, `vm`, `browser`, `research`, `thinker`, `memories`, `envvars`, `connectors`, `personalisation`, `telegram`, `progress`, …). Every family takes one `ToolCtx` and returns one `ToolExecution` — that is the only shared contract.
- **A turn ends only when the model calls `end_turn`.** A round that produces text without it is kept as a draft and the model is nudged, so "it replied" does not mean the loop is finished.
- Two safety gates are easy to break: `workspace/paths.ts` (`safeRelativePath`, `cleanPath`) is the _single_ path-traversal guard shared across sandboxes — never re-implement it locally. `OwnCodingGate` + `SPECIALIST_DOWN_BLOCK_RESULT` (`workspaceTools/types.ts`) _block_ non-trivial file writes when the coding specialist is down until the user accepts own-coding in a **later** turn.
- `/ultraplan` is a mode of this same loop (`server/ultraplan.ts`), not a separate agent, and its tool allowlist is read-only apart from plan writes.

**Subagents come in two unrelated families — there is no single spawn contract:**

- _Hosted single calls, no sandbox, exposed as tools_: `server/thinker.ts` (NIM reasoning), `server/researcher.ts` (Exa deep research), `server/coder.ts`.
- _Sandbox subagents_: these share `server/subagentRuntime.ts`, the real common contract (`subagentSandboxTools`, `compactContext`, `CONTEXT_CHAR_BUDGET`, `SUBAGENT_MAX_TOKENS`). Consumers are the coder's autonomous mode and `server/agentsInit.ts`, which maintains `AGENTS.md` and is launched at the end of a file-mutating web run via `launchPreparingNextTurn`.

### Durable work on Vercel

Vercel kills a function at `maxDuration` (300 s) with no cleanup, and this shapes several modules that otherwise look over-engineered. `MAX_RUN_BUDGET_MS` is 285 000 — deliberately just under the ceiling. The rule the whole design follows: **register durable state before starting, then self-heal via a signed call into a fresh invocation, and dead-letter after a bounded attempt count.**

- `server/selfCall.ts` is the HMAC contract (`x-nova-signature`) for all three internal endpoints. `/api/agent/continue`, `/api/agent/process/resume`, and `/api/agent/queue/advance` all **404 when `AGENT_CONTINUE_SECRET` is unset** — so a local repro of a continuation bug needs that variable set.
- A segment with work left chains to `/api/agent/continue`; team chats are deliberately excluded from chaining.
- `server/runningProcesses.ts` is the durable ledger (`running_processes`): rows registered before work, heartbeats every 20 s, considered stale at 60 s, bounded to 2 resume attempts. `kickRunningProcessRecovery()` is called opportunistically from `api/[...path].ts` on any request that needs the database, throttled to once a minute per instance.
- `server/backgroundWork.ts` `trackBackgroundWork` wraps Vercel's `waitUntil` (degrading to fire-and-forget elsewhere). It is why Telegram replies that take minutes still arrive.

### Peak-hours admission

`server/peakQueue.ts` is pure policy with no I/O. Its window defaults to 14:00–18:00 UTC (`NOVA_PEAK_HOURS_UTC`, e.g. `"14-18"`); `NOVA_PEAK_QUEUE=off|false|0|disabled` turns it off (tests rely on `off`). During the window a message is **queued, not rejected**: it is written to `inference_queue`, a `{type:"queued"}` event goes back, and the reply is polled from the ledger.

Exactly one item runs at a time, and that invariant is enforced in SQL rather than in the worker — `claimNextInferenceQueueItem` (`server/db/inferenceQueue.ts`) is a conditional `UPDATE` over `ORDER BY priority DESC, id`, so ordering is **priority before FIFO**. `priority_purchases` arms a one-hour window that starts on the first message after purchase, not at purchase time.

### Model routing

`server/aiGateway.ts` owns model selection and walks a fixed chain: `deepseek-v4.1-flash:free` → `mimo-v2.6-flash:free` → an optional `glm-5.3-flash` on a _different_ provider so it survives a Token Harbor outage. A caller-supplied model id is **deliberately ignored** — the free-tier contract cannot be bypassed — so don't "fix" that by threading the id through. Read `docs/ai-gateway-contract.md` before touching this file.

BYOK is a full bypass, not a hop: a workspace with an active custom model routes through `server/byokGateway.ts` from `workspace/workspaceRetry.ts` (`customModel ? chatWithCustomModel : chatWithAiGateway`), skipping gateway credits, the sanitized error copy, and admin error logging. `server/nim.ts` is a _separate_ client for the thinker and sandbox subagents and is not part of the fallback chain.

### E2B sandboxes

`server/e2b.ts` is the thin SDK wrapper and configs; `server/sandboxWorkspace.ts` owns the per-run lifecycle around the **persistent per-workspace sandbox** (wake → restore → work → persist → pause, with `prepareAgentSandbox` returning `undefined` on failure so a run degrades to database-only tools rather than throwing).

There are two separate sandboxes and they are not interchangeable: the persistent workspace VM (`persistentSandboxId`, `base` template) and the desktop browser (`browserSandboxId`, `desktop` template) — separate because the `base` template has no display server. Both pause on timeout with `autoResume`, so a paused machine wakes on the next `connect`. The `editor` tool's autonomous mode is the only _resumable_ subagent, and it reconnects the same sandbox rather than provisioning a new one.

The Terminal page attaches a PTY inside the persistent sandbox via in-memory, owner-scoped tRPC sessions (`server/terminal.ts`) — one live terminal per workspace, with bounded scrollback so a closed tab can reattach.

### Scheduled automations

Two distinct paths that are easy to confuse: `server/automations.ts` + `runAutomationForScheduleTask` is the **built-in** automation (workspace digest) behind `/api/scheduled/automation`, while `server/userAutomations.ts` + `server/autonomousMission.ts` is the **user-authored** mission path behind `/api/scheduled/user-automation`, which wraps the instruction in an observe → plan → act → verify → report prompt. Scheduling itself goes through `server/_core/heartbeat.ts`, which registers external cron jobs whose callback URLs must start with `/api/scheduled/`.

### Deployment

`vercel.json`: build `pnpm exec tsx server/migrate-deploy.ts && pnpm run build`; output `dist/public`; serverless `api/[...path].ts` (maxDuration 300, `includeFiles: dist/server/**`). Rewrites send `/api/*` to the function and everything else to `api/spa.ts`. `server/migrate-deploy.ts` is best-effort — it deploys even when the database is unreachable, because the runtime retries pending migrations on the first database-backed request (`server/migrate.ts` `ensureDatabaseSchema`, which runs from the deploy build, `pnpm start`, the dev server, and the Vercel function).

The support-bot Q&A route is the one exception: `needsDatabaseBootstrap` in `api/[...path].ts` skips both the schema check and the recovery sweep for `support.ask` so the public widget keeps answering while the database is unavailable.

## Cross-cutting conventions

**`shared/` is the anti-drift layer.** Anything both the server and the browser must agree on exactly — the ledger prefixes and attachment caps in `shared/const.ts`, agent modes (`shared/agentMode.ts`), follow-up chips (`shared/followUps.ts`), skill validation (`shared/skills.ts`), speech chunking (`shared/speech.ts`), the `/api/status` report shape (`shared/serviceStatus.ts`), text/timing helpers — is defined once there. Put a new shared rule there rather than duplicating it in a page and a router.

**i18n.** `en.ts` is the base (flat dotted keys, e.g. `"common.save"`); the other sixteen locales are typed as `{ [K in keyof typeof en]: string }`, so **TypeScript enforces key parity** — a missing key fails `pnpm check`, there is no separate parity test. Edit only `en.ts`, then run `pnpm i18n:translate`, which is incremental via `i18n/manifest.json`. Never hand-edit a non-English locale file.

**The SPA shell must never be cached.** Browser routes are served by `api/spa.ts` with `no-store`; only content-hashed `/assets/*` are immutable. `pnpm check:spa-cache` enforces the specific mechanics (no rewrite to `/index.html`, the SPA rewrite must exclude `/api/` and `/assets/`, the required markers must survive in `api/spa.ts`). See `CONTRIBUTING.md`.

**Client render tests** (`client/src/**/*.render.test.tsx`, 16 files) run in the node environment with no DOM: they `vi.mock` `@/components/DashboardLayout`, `@/lib/trpc`, `wouter`, and `sonner`, hold state in a `vi.hoisted` object, then assert on `renderToStaticMarkup(<Component />)` output. No events, no interaction — match that pattern instead of reaching for jsdom.

## Path Aliases & Config

- `@` → `client/src` and `@shared` → `shared` (in `vite.config.ts`, `vitest.config.ts`, and `tsconfig.json` paths).
- `@assets` → `attached_assets`, but **only in `vite.config.ts` and `vitest.config.ts`** — it is absent from `tsconfig.json`, so `tsc` cannot resolve it.
- `tsconfig.json`: `bundler` resolution, `allowImportingTsExtensions`, `jsx: preserve`, `strict`.
- Formatting: Prettier (`.prettierrc`, `.prettierignore`).

## Environment (see `server/_core/env.ts`)

Database: `DATABASE_URL` (and `DATABASE_URL_UNPOOLED` for DDL). Sandboxes: `E2B_API_KEY`, `E2B_MAX_SANDBOX_CREATIONS`. AI: `TOKENHARBOR_API_KEY` / `TOKENHARBOR_GATEWAY_URL`, `SEEKAI_API_KEY` (last-resort hop, skipped when unset), the NIM family — `NVIDIA_NIM_API_URL`, plus `resolveNimApiKey` falling back through `NVIDIA_NIM_API_KEY` → `NVIDIA_NIM_GATEWAY_TOKEN` → `NVIDIA_API_KEY`, and the optional `NVIDIA_NIM_CODER_*` endpoint overrides. Auth: `OAUTH_SERVER_URL`, `NEON_AUTH_BASE_URL` (+ `NEON_AUTH_ISSUER` / `NEON_AUTH_AUDIENCE` / `NEON_AUTH_JWKS_URL`), `NOVA_SESSION_SECRET` (which itself falls back through `JWT_SECRET` → `MODEL_CREDENTIAL_SECRET` → `POSTGRES_PASSWORD` → `DATABASE_URL`). Integrations: `AGENTMAIL_API_KEY` + `AGENTMAIL_WEBHOOK_SECRET`, `DEFAULT_TELEGRAM_BOT_TOKEN`, `COMPOSIO_API_KEY`, `EXA_API_KEY`, `NETLIFY_API_TOKEN`, `TRANSCRIPTION_API_KEY` / `TRANSCRIPTION_API_BASE_URL` / `TRANSCRIPTION_MODEL`. Webhooks: `NOVA_PUBLIC_BASE_URL` / `PUBLIC_APP_URL`. Optional remote-API escape hatch: `API_SERVICE_URL`.

Secrets are server-only — never expose them to the browser. Client-visible values must be `VITE_`-prefixed.

## Git Workflow (per AGENTS.md)

- **Minor** (typo, one-liner, docs, formatting): commit and push directly to `main`.
- **Everything else** (features, refactors, behavior changes, multi-file): create a branch, open a PR with `main` as the base. Never push directly for CI/CD, deps, auth, or production behavior changes.
- Push directly only if the change is one sentence and low-risk; when in doubt, open a PR.
- Follow the existing commit style (`git log` — conventional-commit prefixes like `feat(chat):`, `fix(support):`, `perf(i18n):`). Do not add author/co-author or `Generated with ...` footers.
- After fixing coderabbit reviews, do not re-trigger review. If AI reviewers are rate-limited, do not poll.
