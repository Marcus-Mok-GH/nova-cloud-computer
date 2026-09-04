# Changelog

## 2026-09-04 — Fix optional API key passthrough and update NVIDIA references

- `server/workspaceAgent.ts`: Fixed `agentInvokeOptions` to pass `apiUrl` even when `apiKey` is empty, enabling anonymous opencode CLI access.
- `server/_core/llm.ts`: Made API key optional (defaults to empty string) for providers that allow anonymous access.
- `client/src/pages/Home.tsx`: Renamed "NVIDIA gateway" feature card to "AI gateway".
- `client/src/components/TelegramModelSelector.tsx`: Updated description to remove NVIDIA-specific branding.

## 2026-09-04 — Auto-install opencode CLI + stream big-pickle on the user's VM

- `server/daytona.ts`: When a user's persistent workspace VM is first created, Nova now provisions it with the opencode CLI, writes `~/.config/opencode/opencode.json` targeting the OpenCode Zen provider with the `big-pickle` model (mirroring Zo Computer), and exports `OPENCODE_ZEN_API_KEY` in the shell profile so opencode can authenticate.
- Best-effort and idempotent: skipped if opencode is already present; a provisioning failure never blocks normal VM usage.
- Verified: `tsc --noEmit` clean, all 124 tests pass, Biome clean.

## 2026-09-04 — Switch workspace AI provider from NVIDIA NIM to OpenCode Zen (big-pickle)

- `server/_core/env.ts`: Replaced the `NVIDIA_NIM_API_URL`/`NVIDIA_NIM_API_KEY` config with OpenCode Zen (`OPENCODE_ZEN_API_URL` defaulting to `https://opencode.ai/zen/v1`, `OPENCODE_ZEN_API_KEY`, and `OPENCODE_ZEN_MODEL` defaulting to `big-pickle`).
- `server/workspaceAgent.ts`: The workspace agent now connects to OpenCode Zen instead of NVIDIA NIM. The model falls back to `big-pickle`, and the "not connected" copy now references an OpenCode Zen credential.
- `server/telegramModelSettings.ts`: The Telegram model connection now uses the OpenCode Zen endpoint and key.
- `server/automationPlanner.ts`: Updated the structured-output fallback comment to be provider-neutral.
- `server/workspaceAgent.test.ts`: Mock and assertions updated for the OpenCode Zen env and `https://opencode.ai/zen/v1`.
- Verified: `tsc --noEmit` clean, `workspaceAgent` (13) and `automations` (5) tests pass, Biome clean.
- Note: `OPENCODE_ZEN_API_KEY` must be set as a production secret for the agent connection to go live (not set here — secret change requires explicit approval).

## 2026-09-04 — Redesign UI to a sleek Manus-im-inspired dark aesthetic

- `client/src/index.css`: Replaced the orange accent (`#c2410c`/`#f97316`) with a muted gray-blue (`oklch(0.60 0.02 250)`), darkened the base palette to `#0a0a0a`, and tightened hero typography (`letter-spacing: -0.04em`). Removed decorative CSS (mock windows, phone mockup, ribbon-track, floating animations).
- `client/src/pages/Home.tsx`: Rewrote the hero as a dark, spacious section with a tight white headline; removed `SpaceMockup`/`PhoneMockup` and the ribbon; streamlined feature cards. All routing, auth, and theme logic unchanged.
- `client/src/pages/SignIn.tsx`, `client/src/components/DashboardLayout.tsx`: Sleeker dark-first auth form and app shell with subtle `white/8` borders and the new accent for the bottom nav.
- `client/src/pages/Workspace.tsx`, `Chats.tsx`, `Models.tsx`, `Files.tsx`: All pages converted to the new accent and consistent dark surfaces; zero logic changes.
- Consistency pass: `Profile.tsx`, `NotFound.tsx`, `Deployments.tsx`, `More.tsx`, `WorkspaceSettings.tsx`, `TelegramModelSelector.tsx`, `UserAutomationsCard.tsx`, `NovaMark.tsx`, and `public/favicon.svg` — removed all remaining orange.
- Post-review fixes (AI reviewer): scoped `.section-title`/`.feature-card` landing styles to `.dark` with light-mode defaults (readable in both themes); replaced spaces with underscores in `oklch(0.72_0.015_250)` arbitrary utilities across Deployments/More/NotFound/Profile/WorkspaceSettings/TelegramModelSelector/UserAutomationsCard (Tailwind v4 whitespace breaks utilities).
- Verified: `tsc --noEmit` clean, all 124 tests pass, Biome clean.

## 2026-09-02 — Remove Strix security review from PR validation

- `.github/workflows/pr-validation.yml`: Removed the `strix-security` job (Strix security scan) from the `PR validation` workflow. It depended on the Nara router (`NARA_ROUTER_API_KEY`) which was returning HTTP 402 payment_required (account out of credits), failing every PR's validation. PR validation now runs only `quality-and-smoke` (typecheck, build, tests, production health check).

## 2026-09-02 — Merge main into refactor/codebase-optimization

- Merged `origin/main` (which advanced with mobile-layout optimizations, the branding rename to "Nova", and the NVIDIA model-discovery change) into this branch to make PR #54 mergeable after it went DIRTY.
- Resolved the `DashboardLayout.tsx` and `Workspace.tsx` conflicts by taking `main`'s version, which already carries the sleek minimal styling (orange `#f97316` accent, neutral surfaces, softened shadows) plus the newer responsive nav and "Nova" branding.
- Verified merged tree: `tsc --noEmit` clean and 124 render/integration tests pass.

## 2026-09-02 — Fix drizzle migration numbering

- `drizzle/neon/`: The migration added by “Migrate automations to structured definitions” was committed as `0011_structured_user_automations.sql`, but the journal (`_journal.json`) registered it at idx 12 as `0012_structured_user_automations`. Concurrently, `0012_independent_telegram_model.sql` existed on disk without a journal entry. Because `drizzle-kit migrate` walks the journal and looks up each tag’s matching file, every deploy/CI build failed with “applying migrations” aborting on the missing `0012_structured_user_automations.sql`, so neither the structured-automation columns nor the Telegram model columns ever reached the database.
- Renamed `0011_structured_user_automations.sql` → `0012_structured_user_automations.sql` and `0012_independent_telegram_model.sql` → `0013_independent_telegram_model.sql` to match journal tags, and added the missing idx-13 `0013_independent_telegram_model` entry to `drizzle/neon/meta/_journal.json`. Verified `drizzle-kit migrate` now applies cleanly and the `user_automations` (structured) and `telegram_bot_settings` (model) columns are created.

## 2026-09-02 — Fix CI: Strix security review model selection

- `.github/workflows/pr-validation.yml`: The Strix PR security review hardcoded the `glm-5.3-flash-free` fallback when `NARA_ROUTER_MODEL` was unset, and the Nara router began returning 400 “The requested model is not available” for that free-tier model, failing every pull request’s validation. Added a “Select Nara router model” step that queries the router’s `/v1/models` with the Actions secret and picks the first available Strix-recommended model (deepseek-v4-flash → glm-5.3-flash → qwen3.7-flash → kimi-k2.7-code → glm-5.3-flash-free), so a single deprecated/gated model cannot take down all PR validation.

## 2026-09-02 — Sleek, minimal UI pass across the app

- All pages now share one clean design system. The stone/serif `DM_Serif_Display` and sage-green palette (`#e4f0eb` / `#42665d` / `#638f84` / `#75a79a` / `#3d807a`) that had drifted into the account settings surface is gone. Profile, Settings, Automations, and Telegram-selector screens now use the app's orange accent (`#f97316` / `#c2410c`), neutral white/ink surfaces, and Inter headings instead.
- `client/src/pages/Profile.tsx`: Rewritten as a sleek minimal profile card — orange icon chips, clean neutral surfaces, Inter headings, consistent with the rest of the app. All behavior (email copy, password reveal, sign-in links, sign-out, account deletion) is unchanged.
- `client/src/pages/Files.tsx`: Rewritten as a minimal light explorer and editor. The heavy dark IDE chrome (`#1e1e1e` / `#2b2b2b` / `#3f3f3f`) is replaced with a neutral sidebar + clean editor surface. All behavior (create/rename/save/delete, nested folders, editing, breadcrumbs) is unchanged.
- `client/src/pages/WorkspaceSettings.tsx`: Hero section converted from stone-on-serif to a clean white surface with orange eyebrow; card headings switched from `DM_Serif_Display` to bold Inter; account and Telegram icons use the theme's orange chips; the "Telegram connected" pill uses the standard emerald success treatment (matching Deployments). Cards unified to `rounded-2xl`.
- `client/src/components/UserAutomationsCard.tsx` and `client/src/components/TelegramModelSelector.tsx`: Same treatment — serif headings replaced with bold Inter, sage-green accents replaced with orange, and the "Automation created" notice uses the standard emerald success treatment.
- `client/src/components/DashboardLayout.tsx`: Removed the header drop shadow for a flat, blurred border-only bar; the unauthenticated "Sign in to continue" card uses a lighter shadow and tighter radius. `client/src/pages/SignIn.tsx` and `client/src/pages/NotFound.tsx` use the same softened shadow.
- `client/src/pages/Workspace.tsx`: Metric cards lightened from a large soft shadow to `shadow-sm`. `client/src/pages/Chats.tsx` and `client/src/pages/Deployments.tsx` eyebrows unified to the brand-orange tone. `client/src/pages/More.tsx` hover shadow lightened to `shadow-sm`.
- Verified: `tsc --noEmit` clean, render tests pass, `pnpm run build` succeeds.

## 2026-08-31 — Send /start to the Telegram bot from Settings

- `client/src/pages/WorkspaceSettings.tsx`: The Telegram card now shows an "Open Telegram & send /start" button once a bot is saved. It deep-links to `https://t.me/<botUsername>?start=nova_app_link`, so Telegram opens the bot and pre-fills `/start` without any typing. The existing webhook handler recognizes the `nova_app_link` payload and links the chatting chat as the outbound destination automatically, so no "Discover chat" round-trip is needed.

## 2026-08-30 — Add Telegram webhook detection and recovery

- `server/telegram.ts`: Added `getTelegramWebhookInfo` (Bot API `getWebhookInfo`), reporting whether Telegram has a registered callback for the bot and how many updates are pending.
- `server/_core/env.ts`: Added `publicBaseUrl` (`NOVA_PUBLIC_BASE_URL` > `PUBLIC_BASE_URL` > `PUBLIC_APP_URL`, falling back to the `OAUTH_SERVER_URL` origin) and `defaultTelegramBotToken` (`DEFAULT_TELEGRAM_BOT_TOKEN`), used to register the Telegram webhook.
- `server/db.ts`: `getTelegramSettingsForUser()` and `updateTelegramChatForUser()` now check the webhook state on every read and expose it as `webhook: { linked }` (or `webhook: null` when no bot is configured). Failures degrade to `linked: false`, never throw. The webhook URL itself is not exposed because it embeds the bot token. `getOrCreateTelegramSetting()` lazily materializes a settings row for the server-wide `DEFAULT_TELEGRAM_BOT_TOKEN`, so the out-of-box bot works before any token is saved; `findWorkspaceOwnerByTelegramToken()` routes default-bot updates to the first workspace owner when no row matches.
- `server/routers.ts`: `telegram.configure` now accepts an empty `botToken` and reuses the previously saved token (the recovery/repair path), and re-registers the webhook on every save (falling back to the request's `Host` when no `publicBaseUrl` is configured); registration failures are swallowed and surfaced through `status.webhook.linked` instead of blocking the request.
- `server/index.ts`: registers the default bot's webhook at boot so Telegram messages start flowing without any UI action.
- `server/app.ts`: the webhook handler auto-links the chatting Telegram chat on every message (and materializes the default bot's settings row), so test sends and automations always reach the user.
- `client/src/pages/WorkspaceSettings.tsx`: The Telegram card shows a red "Webhook not reachable" badge when Telegram has no registered callback and the validate button doubles as "Re-register webhook" when a bot is already saved but webhook delivery is broken.

## 2026-08-28 — Fix intermittent white screen on page load

- Review hardening: the boot guard now only reacts to module-script/stylesheet load errors (favicon/analytics failures can no longer trigger a reload), the 8s watchdog only fires after `document.readyState` is `complete` (no false reload on slow networks), and a `?nr=1` marker prevents a reload loop in browsers that block storage; the marker is stripped from the URL on successful boot.
- Root cause: after a deploy, a cached or in-flight index.html references a hashed bundle that no longer exists. The SPA catch-all served index.html back with 200 + `text/html` for the missing `/assets/*` chunk, module MIME checking blocked execution, React never mounted, and the page stayed white.
- `vercel.json`: replaced legacy `routes` with `rewrites` + `headers`. Missing `/assets/*` files no longer fall through to the SPA fallback (they return a real 404), and hashed assets are served with `Cache-Control: public, max-age=31536000, immutable`.
- `client/index.html`: added an inline boot guard — if the entry script or stylesheet fails to load, or `#root` is still empty after 8s, it reloads once (sessionStorage-guarded, so no reload loops) to fetch fresh HTML from the current deployment. `client/src/main.tsx` clears the guard flag on successful boot.
- `vite.config.ts`: the umami analytics tag shipped a literal `%VITE_ANALYTICS_ENDPOINT%/umami` URL when the env var is unset (it is, in production), producing a 200 `text/html` script error on every load; the tag is now stripped at build time when analytics is not configured.
- Review hardening (CodeRabbit): reload loop is also bounded by a `?nr=` marker for browsers with blocked storage; recovery only reacts to module scripts/stylesheets, not favicon/analytics; the 8s empty-root watchdog now requires `document.readyState === "complete"` to avoid slow-network false positives; the analytics tag is kept only when both `VITE_ANALYTICS_ENDPOINT` and `VITE_ANALYTICS_WEBSITE_ID` are set.
- Verified: `tsc --noEmit` clean, 101 tests pass, `pnpm run build` succeeds; served the built SPA locally — normal boot unaffected, missing entry chunk triggers exactly one recovery reload with no loop.

- Addressed PR #38 review findings: `[DONE]` now streams after the auto-title update so the chat list cannot cache a stale default title, and title persistence uses an owner-scoped conditional update (`renameChatIfDefaultForUser`) that skips when the chat is no longer default-titled (race-safe, with regression test).

## 2026-08-28 — AI auto-titles chats from their first messages

- Chats no longer stay stuck on default titles ("New workspace conversation", "Telegram Chat"): after the first assistant reply, the workspace LLM generates a concise 3-6 word title from the first user + assistant messages.
- New `autoTitleChatForUser` helper in `server/workspaceAgent.ts`; wired into the `chats.send` mutation, `/api/chat/stream`, and the Telegram webhook. Idempotent: it only acts while the title is still a default, so later turns cost nothing.
- `Workspace.tsx` invalidates the workspace query once a stream completes, so the chat list and headers pick up the new title immediately.
- Exported `getChatForUser` from `server/db.ts`; replaced the inline titling block in the send mutation with the shared helper (same LLM/model config via `agentInvokeOptions`).
- Tests: 4 new cases in `server/workspaceAgent.test.ts` (rename, no-op on custom title, no-op before first reply, quote/newline stripping).

## 2026-08-28 — Fix chat deletion auth and mobile delete-icon visibility

- CodeRabbit follow-up: treat a failing `getNeonAccessToken()` lookup as no token (`catch(() => null)`) so chat delete/stream requests still run with cookie authentication instead of being skipped when the token endpoint errors.
- Chat deletion failed ("could not delete chat") when the session cookie was unavailable (Safari ITP, WebViews, iframes): the client `fetch("/api/chat/delete")` sent no `Authorization` header while the endpoint rejects cookie-less requests. The delete call now attaches the Neon access token as a Bearer header and includes credentials, matching the tRPC client.
- Applied the same auth fix to `fetch("/api/chat/stream")`, which had the identical cookie-only auth pattern.
- Delete icon in the Chats list is now always visible; it was `opacity-0` + `group-hover:opacity-100`, which is unusable on touch devices with no hover.

## 2026-08-28 — Refactor: remove dead code and prune unused dependencies

- Removed unreachable client code: `pages/ComponentShowcase.tsx` (1,437-line demo page with no route), `components/AIChatBox.tsx`, `components/ManusDialog.tsx`, `components/Map.tsx`, `hooks/useMobile.tsx`, `lib/authCallbackUrl.ts`, and `client/src/const.ts`.
- Removed 38 unused shadcn `ui/` components (alert, badge, calendar, chart, form, sidebar, etc.) that no live page or component imports.
- Removed unused server modules: `_core/map.ts`, `_core/voiceTranscription.ts`, `_core/imageGeneration.ts`, `_core/dataApi.ts`, `_core/storageProxy.ts`, `_core/oauth.ts`, and `neonAuthProxy.ts` (+ its test). No production code imported them.
- Removed `shared/types.ts` (no importers); kept `shared/const.ts` and `shared/_core/errors.ts` (used by live code).
- Pruned 34 unused dependencies from `package.json` (AWS SDK packages, form/carousel/chart libraries, 16 Radix primitives whose components were removed, framer-motion, streamdown, tailwindcss-animate, vaul, react-hook-form, etc.) and regenerated the pnpm lockfile.
- `server/app.ts`: Replaced dynamic `import("./db")`/`import("./telegram")` calls in the Telegram webhook with static imports; identical behavior, less runtime overhead.
- `server/routers.ts`: Consolidated 12 duplicated `TRPCError NOT_FOUND` throws behind a shared `throwIfNotFound()` helper with the same messages.
- README updated to reflect the removed files.
## 2026-08-27 — Fix OTP sign-in redirect loop after session exchange

**Problem:** After OTP verification, Neon Auth redirected to `/app?verifier=XXX`.
The Workspace page rendered, `DashboardLayout` detected no auth cookie, and
redirected to `/sign-in` — stripping the verifier from the URL. On `/sign-in`
there was no verifier to exchange, so `exchangeNeonVerifierAndGetJwt()` failed,
leaving the user in a redirect loop back to sign-in.

**Fix:** Added a mount-time `useEffect` in `client/src/pages/Workspace.tsx` that
detects a `verifier` query param, calls `exchangeNeonVerifierAndGetJwt()` to store
the Neon JWT in localStorage, rewrites the URL to remove the verifier, then
navigates to `/app` so the dashboard renders with a valid session.

## 2026-08-26 — Fix Telegram webhook and OTP sign-in session persistence

- `server/app.ts`: Restored `/api/telegram/webhook/:token` POST handler that maps incoming Telegram updates to the workspace owner, creates or reuses a Nova chat for the Telegram conversation, runs `runWorkspaceAgent`, and replies via Telegram. Also handles `/start` deep links to link the Telegram chat to the workspace.
- `server/db.ts`: Restored `findWorkspaceOwnerByTelegramToken()` so inbound webhook requests can resolve a bot token back to a Nova workspace owner.
- `client/src/pages/SignIn.tsx`: After OTP verification succeeds and Neon returns a session, Nova now calls `exchangeNeonVerifierAndGetJwt` to extract and persist the Neon access token in localStorage before navigating to `/app`. Without this, the bearer token was missing on first load and the user was immediately redirected back to sign-in.
- `client/src/main.tsx`: Added `credentials: "include"` to the tRPC httpBatchLink fetch so first-party session cookies are sent with every request, keeping existing sessions alive after the Neon JWT expires.

## 2026-08-24 — Fix TypeScript compile errors and login reproduction

- `server/_core/env.ts`: Added missing `forgeApiUrl` and `forgeApiKey` properties to the `ENV` type, sourced from `BUILT_IN_FORGE_API_URL` and `BUILT_IN_FORGE_API_KEY`.
- `server/_core/llm.ts`: Fixed destructuring bug in `normalizeMessage` — removed nonexistent `messages` property from the `Message` type destructuring so `tsc --noEmit` passes.


## 2026-08-24 — Fix email OTP sign-in redirect loop

- `client/src/lib/neonAuth.ts`: Added `disableDefaultFetchPlugins: true` to the Better Auth client options so the built-in `redirectPlugin` does not hijack email OTP verification and navigate the browser away from the Nova sign-in page.


## 2026-08-21 — Add README documenting the codebase and Vercel deployment

- Added `README.md` describing the app, architecture, tech stack, repository layout, key modules, data model, env vars, and build/test scripts.
- Clarified that the production deployment is Vercel (`https://nova-cloud-computer.vercel.app`) and that the repo must not be deployed as a Zo service.

## 2026-08-21 — Add /start handler to Telegram webhook

- `server/app.ts`: `/api/telegram/webhook/:token` now replies to `/start` (or `start`) with a welcome start message and skips the agent.

## 2026-08-21 — Add inbound Telegram webhook for nova-cloud-computer
## 2026-08-21 — Force default Telegram bot and add Start button

- `server/_core/env.ts`: Added `defaultTelegramBotToken` from `DEFAULT_TELEGRAM_BOT_TOKEN`.
- `server/db.ts`: `getTelegramSettingsForUser()` and `getTelegramCredentialsForUser()` now fall back to the default bot profile/token when a workspace has no saved Telegram settings.
- `server/routers.ts`: `telegram.configure` now accepts an optional `botToken`; when omitted it uses the server default. After saving, it calls Telegram `setWebhook` so inbound updates route to `/api/telegram/webhook/:token`.
- `server/app.ts`: Added `/api/telegram/webhook/:token` POST handler that maps updates to the workspace owner, creates a Telegram chat if needed, runs `runWorkspaceAgent`, and replies via Telegram.
- `client/src/pages/WorkspaceSettings.tsx`: Added a Start button that opens the default bot (`https://t.me/<botUsername>?start=`) when a bot username is available.


- `server/db.ts`: Added `findWorkspaceOwnerByTelegramToken()` so inbound Telegram updates can be mapped back to a Nova workspace owner.
- `server/app.ts`: Added `/api/telegram/webhook/:token` POST route. It verifies the token, finds the owner, creates or reuses a Nova chat for the Telegram chat, runs `runWorkspaceAgent`, and sends the assistant reply back through Telegram.
- Built and deployed to the running Nova server so the Vercel-fronted endpoint accepts Telegram updates.

## 2026-08-20 — Fix: workspace data showing "-" after persistent-sandbox feature

- Root cause: `drizzle/neon/0009_add_nvidia_nim_to_model_provider.sql` and `0010_add_persistent_sandbox_id.sql` were added in e67ce55 but never registered in `drizzle/neon/meta/_journal.json`, so `drizzle-kit migrate` skipped them and the production `workspaces` table was missing `persistentSandboxId`. Every workspace query then failed with "column ... does not exist", leaving the home dashboard showing "-" for folders/files.
- Applied migrations 0009 and 0010 directly against the production Neon database (verified: `persistentSandboxId` column present, `model_provider` enum includes `nvidia-nim`, workspace select succeeds).
- `drizzle/neon/meta/_journal.json`: registered both migrations so future Vercel build deployments track them as applied.

## 2026-08-20 — Account menu: theme switcher and sign-out for logged-in users

- `client/src/components/DashboardLayout.tsx`: The account avatar dropdown (mobile top bar and desktop sidebar) now shows a "Switch to dark/light theme" item above the existing Sign out option. Uses the `useTheme` hook from `ThemeContext`; the item reflects the current theme and toggles it via `toggleTheme`.

## 2026-08-20 — Refactor: simplify proxy helpers and trim dead code

- `api/[...path].ts` extracted `forwardUpstreamResponse()` to deduplicate response-header and cookie-normalization logic; `client/src/components/AIChatBox.tsx` removed verbose `@example` JSDoc block; `client/src/pages/WorkspaceSettings.render.test.tsx` removed two dead assertions for already-removed model-selector strings and updated test name.

## 2026-08-19 — Remove remaining forge provider fallbacks

- `server/workspaceAgent.ts`: Removed the dead `ENV.forgeApiKey` fallback from `getWorkspaceAgentConnection`. The agent now relies exclusively on NVIDIA NIM credentials when present.
- `server/workspaceAgent.test.ts`: Removed forge-dependent test cases and updated mocks to reflect the NVIDIA-only provider setup.

## 2026-08-19 — Remove forge.manus.im LLM provider fallback

- `server/_core/env.ts`: Removed `forgeApiUrl` and `forgeApiKey` from the `ENV` config.
- `server/_core/llm.ts`: Removed the `forge.manus.im` default URL fallback and the `listLLMModels` helper. `invokeLLM` now requires `apiUrl` and `apiKey` on every call instead of silently falling back to forge.
- `server/app.ts`, `server/routers.ts`: Title-generation `invokeLLM` calls now pass `connection.apiUrl` and `connection.apiKey` from the workspace agent connection.
- `server/workspaceAgent.ts`: The agent connection logic already prefers NVIDIA NIM when a key is present; with forge removed, it no longer has a secondary fallback provider.

## 2026-08-19 — Fix chat stream timeout by routing title generation through NVIDIA NIM

- `server/app.ts`: The `/api/chat/stream` endpoint now passes `connection.apiUrl` and `connection.apiKey` into the `invokeLLM` call used for title generation. Previously it fell back to `forge.manus.im`, which is unreachable in production and caused retry loops that exceeded Vercel's 10s function timeout before `[DONE]` was sent to the client.

## 2026-08-19 — Switch sign-in from magic link to email OTP code

- `client/src/pages/SignIn.tsx`: Replaced the one-step magic-link flow with a two-step email-OTP flow (send code → enter code). Uses the existing `input-otp` component for code entry and the `neonAuth.emailOTP` / `neonAuth.signIn.emailOTP` endpoints.
- `server/db.ts`, `server/_core/context.ts`: Updated the default `loginMethod` label from `neon_magic_link` to `neon_email_otp`.
- `client/src/pages/Home.render.test.tsx`: Updated the render expectation to match the new button text.


# Changelog

## Unreleased

- Restored the proven post-OTP sign-in handoff from the pre-session-refresh implementation: Nova now checks Neon’s session directly and enters the workspace, rather than requiring a separate tRPC session confirmation before navigation.
- Fixed the Vercel API proxy dropping browser Authorization headers, which prevented OTP sign-in from confirming the newly established Neon session.
- Fixed Vercel API-service response forwarding so streamed chat chunks are relayed correctly, increased chat function duration, and show the user's pending message immediately in the conversation UI.
- Fixed OTP login handoff: Nova now obtains a signed Neon access token and verifies the first-party session before opening the workspace, preventing an immediate return to the sign-in screen.
- Wrapped OTP session setup in `SignIn.tsx` with its own try/catch so token exchange, access-token fetch, and session refresh failures surface a session-specific error instead of the outer OTP verification error.
- Updated workspace chat streaming completion paths in `Workspace.tsx` so `refreshMessages` completes before `isStreaming` is cleared, and `pendingUserContent` is cleared only after the associated message refresh succeeds, preventing stale refetches from clearing newer pending content.

## 2026-08-19 — Fix default NVIDIA NIM model to GLM 5.2

- `server/workspaceAgent.ts`: Changed the default NVIDIA NIM chat model from `z-ai/glm-5.3` to `z-ai/glm-5.2` (still overridable via `NVIDIA_NIM_MODEL`). NVIDIA remains the preferred provider whenever a NIM key is present.
- `server/workspaceAgent.test.ts`: Updated the hosted-model tool-path test to expect the new default model `z-ai/glm-5.2`.

## 2026-08-19 — AI renames chat title from first messages

- `server/db.ts`: Added `updateChatForUser`.
- `server/routers.ts`: Modified `chats.send` to use a placeholder title then generate a concise 3-6 word title via the LLM after the first assistant reply.

## 2026-08-19 — Fix streaming crash on null assistant content

- `server/_core/llm.ts`: Fixed "Cannot read properties of undefined (reading 'type')" crash. `normalizeMessage` now handles assistant messages whose `content` is `null` (e.g. tool-call responses) by preserving them with empty content and their `tool_calls`, instead of passing `null` into `normalizeContentPart` which accessed `.type` on an undefined value.
- `server/workspaceAgent.test.ts`: Updated the hosted-model tool-path test to expect the new default NVIDIA model `meta/llama-3.1-8b-instruct`.

## 2026-08-19 — Add NVIDIA NIM as a first-class provider

- `drizzle/schema.ts`: Added `"nvidia-nim"` to the `model_provider` Postgres enum.
- `drizzle/neon/0009_add_nvidia_nim_to_model_provider.sql`: New migration to add the `nvidia-nim` enum value.
- `server/db.ts`: Extended `ActiveProvider` to include `"nvidia-nim"`.
- `server/routers.ts`: Extended `modelProvider` schema validation to accept `"nvidia-nim"`.
- `server/workspaceAgent.ts`: The workspace agent now checks the workspace `activeProvider` setting; when it is `"nvidia-nim"` (or the NIM credential is present), chat routing prefers the NVIDIA NIM backend. Also updated the function to load settings per workspace owner.
- `server/workspace.router.test.ts`: Updated `SettingsRecord` type to include `"nvidia-nim"`.
- `server/workspaceAgent.test.ts`: Added mock for `getWorkspaceModelSettingsForUser` so agent tests continue to pass.

## 2026-08-19 — Remove model selector from Settings and chat

- `client/src/pages/WorkspaceSettings.tsx`: Removed the provider model picker ("Choose a model home") and the custom endpoint ("Bring your own model") UI, along with the now-unused `CustomModelDialog`, provider options, and related state/mutations. Settings now focuses on workspace rules, Telegram, automations, and account management.
- `client/src/pages/Workspace.tsx`: Removed the "Claude" model chip from the chat composer, so users no longer see a model selector in the conversation input.
- `client/src/pages/WorkspaceSettings.render.test.tsx`: Updated the render test to assert the model selector and custom-endpoint UI are gone while workspace rules still render.

## 2026-08-18 — Mobile optimization pass

- `client/src/pages/Home.tsx`: Footer "Company"/"Follow"/"Explore" link columns now wrap to 2 columns below the `sm` breakpoint instead of forcing 3 cramped columns on narrow phones (≤375px), which was squeezing link labels and touch targets.
- `client/src/pages/SignIn.tsx`: Email input now uses `text-base` (16px) on mobile and `text-sm` from `sm:` up — 14px inputs trigger unwanted auto-zoom on iOS Safari when focused.
- `client/src/components/DashboardLayoutSkeleton.tsx`: loading skeleton now mirrors the real `DashboardLayout` mobile structure (sticky top bar + bottom tab bar) instead of showing a desktop-only sidebar skeleton on phones.
