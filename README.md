# Nova Cloud Computer

A full-stack, AI-agent-powered cloud computer. Nova gives each user a persistent personal workspace with an AI agent that can chat, run tasks, manage files, and spin up sandboxed execution environments.

> **Deployment note:** The production deployment is **Vercel** — live at [https://nova-cloud-computer.vercel.app](https://nova-cloud-computer.vercel.app). This repository is deployed via the Vercel project linked in `.vercel/`. Do **not** deploy this repo as a Zo service or any other hosting platform; Vercel is the single source of truth for production.

---

## Overview

Nova is a personal cloud computer platform. Users sign in, get a persistent workspace, and interact with an AI agent that operates on their files, runs scheduled automations, manages projects and tasks, and can execute work in isolated sandboxed VMs (via E2B Sandbox) or GitHub-hosted runners.

The stack is a single monorepo with a React client, an Express + tRPC server, a Neon (Postgres) database via Drizzle ORM, and an OpenAI-compatible NVIDIA NIM LLM backend.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React SPA, Vite)                                  │
│  /  /sign-in  /app  /app/files  /app/chats  /app/deployments │
└───────────────┬─────────────────────────────────────────────┘
                │  /api/trpc (tRPC, superjson) + Bearer auth
┌───────────────▼─────────────────────────────────────────────┐
│  Express server (server/app.ts → server/index.ts)           │
│  • tRPC router (server/routers.ts)                          │
│  • Telegram webhook (/api/telegram/webhook/:token)           │
│  • Scheduled automation callback (/api/scheduled/automation)│
│  • Static SPA fallback                                      │
└───────┬──────────────────────────────┬──────────────────────┘
        │                              │
┌───────▼──────────┐          ┌────────▼─────────────────────┐
│  Neon Postgres    │          │  LLM / agent backends       │
│  (Drizzle ORM)    │          │  • NVIDIA NIM (OpenAI-compat)│
│  workspaces,      │          │  • E2B Sandbox VMs           │
│  chats, files,    │          │  • GitHub Actions runners    │
│  automations,     │          └────────────────────────────┘
│  projects, tasks   │
└───────────────────┘

        Object storage:
        • S3 (workspace files, exports)
```

- **Client** — React 19 SPA built with Vite, Tailwind CSS 4, Radix UI, tRPC + TanStack Query, wouter routing.
- **Server** — Express + tRPC (v11), session auth via Neon, scheduled automation callbacks, and an inbound Telegram webhook that lets users message their Nova agent from Telegram.
- **Database** — Neon serverless Postgres, Drizzle ORM, migrations in `drizzle/neon/`.
- **LLM** — OpenAI-compatible chat completions against NVIDIA NIM (`nvidia/nemotron-3-nano-30b-a3b`), configured per workspace.
- **Agent VMs** — E2B Sandboxes for server-side agent execution; per-workspace persistent sandbox support with automatic pause/resume.

---

## Repository layout

```
.
├── api/                  # Vercel serverless entry (api/[...path].ts) — mounts the Express app
├── client/src/           # React SPA
│   ├── pages/            # Home, SignIn, Workspace, Files, Chats, Deployments, Settings
│   ├── components/       # DashboardLayout, NovaMark, ui/ (Radix + shadcn)
│   ├── contexts/         # ThemeContext
│   ├── hooks/            # useComposition, useMobile, usePersistFn
│   └── lib/              # trpc client, neonAuth
├── server/               # Express + tRPC backend
│   ├── _core/            # env, context, sdk, llm, oauth, cookies, storage, trpc, etc.
│   ├── app.ts            # Express app, route mounting
│   ├── index.ts          # HTTP server bootstrap + static SPA fallback
│   ├── routers.ts        # tRPC router (auth, workspace, telegram, nvidia, agentVm, automations, files, chats, models, projects, tasks)
│   ├── db.ts             # Data-access layer
│   ├── telegram.ts       # Telegram bot helpers
│   ├── agentVm.ts        # E2B agent VM orchestration
│   ├── automations.ts    # Scheduled automation runner
│   ├── e2b.ts            # E2B SDK wrapper
│   ├── modelSecrets.ts   # Per-workspace model credentials
│   ├── nvidiaGateway.ts  # NVIDIA NIM gateway client
│   ├── storage.ts        # S3 object storage
│   └── workspaceAgent.ts # Runs the agent against a workspace
├── shared/               # Shared types & constants (client + server)
├── drizzle/              # Drizzle schema + Neon migrations
├── docs/                 # Research & design notes (agent VMs, NVIDIA gateway)
├── dist/                 # Build output (server bundle + public SPA)
└── vercel.json           # Vercel build/routing config
```

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 7, Tailwind CSS 4, Radix UI, wouter, TanStack Query, tRPC client |
| Backend | Node/Express, tRPC v11, superjson |
| Database | Neon (Postgres), Drizzle ORM |
| LLM | NVIDIA NIM (OpenAI-compatible chat completions) |
| Agent VMs | E2B Sandbox SDK |
| Object storage | AWS S3 (presigned URLs) |
| Deployment | Vercel |

---

## Data model

Core Drizzle tables (see `drizzle/schema.ts`):
- **workspaces** — one per user; holds model settings, persistent sandbox ID, Telegram settings.
- **users / sessions** — authentication.
- **chats / chat_messages** — conversations with the AI agent.
- **folders / files** — the user's workspace file tree.
- **automations / automation_runs** — scheduled tasks.
- **projects / tasks** — project & task management.
- **model_provider / model_secrets** — per-workspace LLM configuration.

---

## Environment variables

Key configuration (see `server/_core/env.ts`). Set these as Vercel Production variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection string |
| `NVIDIA_NIM_API_KEY` | NVIDIA NIM credential for the agent LLM |
| `NVIDIA_NIM_API_URL` | NVIDIA NIM endpoint URL (defaults to `https://integrate.api.nvidia.com/v1`) |
| `E2B_API_KEY` | Server-only E2B Sandbox API key; never expose it to the browser |
| `E2B_MAX_SANDBOX_CREATIONS` | Optional server-only no-card safety cap for sandbox creations; defaults to `50` |
| `OAUTH_SERVER_URL` | Neon auth / OAuth server URL |
| `NEON_AUTH_BASE_URL` | Neon auth base URL |
| `DEFAULT_TELEGRAM_BOT_TOKEN` | Default Telegram bot token for inbound webhooks |
| `POSTGRES_PASSWORD` | Postgres password |
| AWS S3 vars | Object storage access keys |

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

- Build command: `pnpm drizzle-kit migrate && pnpm run build`
- Output directory: `dist/public`
- Serverless entry: `api/[...path].ts` (mounts the Express app)
- Routing: `/api/*` → `api/[...path].ts`, everything else → SPA `index.html`

Deploy with:

```bash
vercel --prod
```

> **Important:** Keep Vercel as the only production host. Do not create a Zo service or other deployment for this repo.
