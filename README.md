# Nova Cloud Computer

A full-stack, AI-agent-powered cloud computer. Nova gives each user a persistent personal workspace with an AI agent that can chat, run tasks, manage files, and spin up sandboxed execution environments.

> **Deployment note:** The production deployment is **Vercel** - live at [https://nova-cloud-computer.vercel.app](https://nova-cloud-computer.vercel.app). This repository is deployed via the Vercel project linked in `.vercel/`. Do **not** deploy this repo as a Zo service or any other hosting platform; Vercel is the single source of truth for production.

---

## Overview

Nova is a personal cloud computer platform. Users sign in, get a persistent workspace, and interact with an AI agent that operates on their files, runs scheduled automations, manages projects and tasks, and can execute work in isolated E2B sandboxes.

The stack is a single monorepo with a React client, an Express + tRPC server, a Neon (Postgres) database via Drizzle ORM, and an AI-powered agent. A server-to-server AI gateway powers AI-agent inference, while E2B sandboxes handle autonomous task execution.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React SPA, Vite)                                  │
│  /  /sign-in  /app  /app/files  /app/chats  /app/agents  /app/deployments │
└───────────────┬─────────────────────────────────────────────┘
                │  /api/trpc (tRPC, superjson) + Bearer auth
┌───────────────▼─────────────────────────────────────────────┐
│  Express server (server/app.ts → server/index.ts)           ││   • tRPC router (server/routers.ts)                          │
│     (auth, workspace, telegram, ai, agentVm, automations,    │
│      files, chats, agents, models, projects, tasks)          │
│  • Telegram webhook (/api/telegram/webhook/:token)           │
│  • Scheduled automation callback (/api/scheduled/automation)│
│  • Static SPA fallback                                      │
└───────┬──────────────────────────────┬──────────────────────┘
        │                              │
┌───────▼──────────┐          ┌────────▼─────────────────────┐
│  Neon Postgres    │          │  Agent / inference backends │
│  (Drizzle ORM)    │          │  • AI gateway (AI agent)    │
│  workspaces,      │          │  • E2B Sandbox (task exec)  │
│  chats, files,    │          │  • Server-only credentials    │
│  automations,     │          └────────────────────────────┘
│  projects, tasks   │
└───────────────────┘

        Workspace files:
        • Neon Postgres
```

- **Client** - React 19 SPA built with Vite, Tailwind CSS 4, Radix UI, tRPC + TanStack Query, wouter routing.
- **Server** - Express + tRPC (v11), session auth via Neon, scheduled automation callbacks, an inbound Telegram webhook that lets users message their Nova agent from Telegram, and an inbound AgentMail webhook that opens a new chat for a mail sent to the agent's inbox and answers it in the same email thread.
- **Database** - Neon serverless Postgres, Drizzle ORM, migrations in `drizzle/neon/`.
- **Agent** - Conversational workspace work and automation planning run through the AI gateway.
- **Inference** - A server-to-server AI gateway provides AI-agent inference.
- **Agent VMs** - E2B Sandboxes for server-side agent execution; per-workspace persistent sandbox support with automatic pause/resume.

---

## Repository layout

```
.
├── api/                  # Vercel serverless entry (api/[...path].ts) - mounts the Express app
├── client/src/           # React SPA
│   ├── pages/            # Home, SignIn, Workspace, Files, Chats, Deployments, Skills, Settings
│   ├── components/       # DashboardLayout, NovaMark, ui/ (Radix + shadcn)
│   ├── contexts/         # ThemeContext
│   ├── hooks/            # useComposition, usePersistFn
│   └── lib/              # trpc client, neonAuth
├── server/               # Express + tRPC backend
│   ├── _core/            # env, context, sdk, llm, cookies, trpc, etc.
│   ├── app.ts            # Express app, route mounting
│   ├── index.ts          # HTTP server bootstrap + static SPA fallback
│   ├── routers.ts        # tRPC router (auth, workspace, telegram, ai, agentVm, automations, files, chats, models, projects, tasks, skills)
│   ├── db.ts             # Data-access layer
│   ├── telegram.ts       # Telegram bot helpers
│   ├── agentVm.ts        # E2B agent VM orchestration
│   ├── automations.ts    # Scheduled automation runner
│   ├── e2b.ts            # E2B SDK wrapper
│   ├── modelSecrets.ts   # Per-workspace model credentials
│   ├── aiGateway.ts       # Built-in AI gateway client
│   └── workspaceAgent.ts # Runs the agent against a workspace
├── shared/               # Shared types & constants (client + server)
├── drizzle/              # Drizzle schema + Neon migrations
├── docs/                 # Research & design notes (agent VMs, AI gateway)
├── dist/                 # Build output (server bundle + public SPA)
└── vercel.json           # Vercel build/routing config
```

---

## Tech stack

| Layer          | Technology                                                                      |
| -------------- | ------------------------------------------------------------------------------- |
| Frontend       | React 19, Vite 7, Tailwind CSS 4, Radix UI, wouter, TanStack Query, tRPC client |
| Backend        | Node/Express, tRPC v11, superjson                                               |
| Database       | Neon (Postgres), Drizzle ORM                                                    |
| Agent          | AI gateway (server-to-server)                                                   |
| Agent VMs      | E2B Sandbox SDK                                                                 |
| Deployment     | Vercel                                                                          |

---

## Data model

Core Drizzle tables (see `drizzle/schema.ts`):

- **workspaces** - one per user; holds model settings, persistent sandbox ID, Telegram settings.
- **users / sessions** - authentication.
- **chats / chat_messages** - conversations with the AI agent. A chat opened by inbound mail carries its email thread id (`emailThreadId`, unique per agent), which is what keeps one email conversation in one chat even when two of its messages arrive together.
- **agent_profiles / chat_agents / agent_approvals / agent_emails** - personal agents with an identity (a real AgentMail inbox when `AGENTMAIL_API_KEY` is set, plus a virtual phone handle), a spending wallet, team chats, and approval-gated actions (purchases, outbound email). Inbound mail is stored with its AgentMail thread id and the chat that answered it, so one email conversation is one chat.
- **folders / files** - the user's workspace file tree.
- **automations / automation_runs** - scheduled tasks.
- **projects / tasks** - project & task management.
- **workspace_skills** - per-user agent skills in the Agent Skills format (name, description, instructions); the agent sees each skill's name and description in its prompt and loads one skill's instructions on demand.
- **model_provider / model_secrets** - per-workspace LLM configuration.

---

## Environment variables

Key configuration (see `server/_core/env.ts`). Set these as Vercel Production variables:

| Variable                     | Purpose                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`               | Neon Postgres connection string                                                 |
| `E2B_API_KEY`                | Server-only E2B Sandbox API key; never expose it to the browser                 |
| `E2B_MAX_SANDBOX_CREATIONS`  | Optional server-only no-card safety cap for sandbox creations; defaults to `50` |
| `TOKENHARBOR_API_KEY`         | Server-only Token Harbor key (`thk_live_...`) powering the built-in AI gateway    |
| `TOKENHARBOR_GATEWAY_URL`     | Optional HTTPS override for the Token Harbor base URL (defaults to `https://tokenharbor.ai/v1`) |
| `TOKENHARBOR_MAX_REQUESTS_PER_WORKSPACE` | Optional per-workspace gateway request cap; unset means no cap        |
| `TOKENHARBOR_FALLBACK_MODEL` | Optional override for the built-in gateway fallback model (defaults to `mimo-v2.6-flash:free`); set to `none`/`disabled` to disable |
| `SEEKAI_API_KEY`             | Optional server-only SeekAI key; when present it enables a last-resort `glm-5.3-flash` fallback on `https://seekai.cc` after the Token Harbor fallback fails |
| `SEEKAI_GATEWAY_URL`         | Optional HTTPS override for the SeekAI base URL (defaults to `https://seekai.cc/v1`) |
| `SEEKAI_FALLBACK_MODEL`      | Optional override for the SeekAI last-resort model (defaults to `glm-5.3-flash`); set to `none`/`disabled` to disable |
| `OAUTH_SERVER_URL`           | Neon auth / OAuth server URL                                                    |
| `NEON_AUTH_BASE_URL`         | Neon auth base URL                                                              |
| `DEFAULT_TELEGRAM_BOT_TOKEN` | Default Telegram bot token for inbound webhooks                                 |
| `POSTGRES_PASSWORD`          | Postgres password                                                               |

The built-in gateway serves Token Harbor's free
`deepseek-v4.1-flash:free` with `mimo-v2.6-flash:free` (Xiaomi MiMo) as the
fallback for transient failures. See
[`docs/ai-gateway-contract.md`](docs/ai-gateway-contract.md) for the transport
details.

---

## Development

```bash
# Install dependencies
pnpm install

# Run the dev server (tsx watch)
pnpm dev

# Type-check
pnpm check

# Run tests (Vitest)
pnpm test

# Build (Vite SPA + esbuild server bundles)
pnpm build

# Start the production build locally
pnpm start

# Generate + apply DB migrations
pnpm db:push
```

---

## Deployment (Vercel)

The repo is linked to the Vercel project `nova-cloud-computer` (see `.vercel/repo.json`). Production is deployed from the `main` branch.

- Build command: `pnpm run db:migrate:deploy && pnpm run build` (applies pending migrations automatically whenever a database URL is configured; skips cleanly when none is present, e.g. CI)
- The standalone server also migrates at boot (`pnpm start`), so a self-hosted run creates any missing tables automatically
- Output directory: `dist/public`
- Serverless entry: `api/[...path].ts` (mounts the Express app)
- Routing: `/api/*` → `api/[...path].ts`, everything else → SPA `index.html`

Deploy with:

```bash
vercel --prod
```

> **Important:** Keep Vercel as the only production host. Do not create a Zo service or other deployment for this repo.
