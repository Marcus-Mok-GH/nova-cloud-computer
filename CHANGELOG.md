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
- Built and deployed to the running Nova server so the Vercel-fronted endpoint accepts Telegram updates.## 2026-08-20 — Fix: workspace data showing "-" after persistent-sandbox feature

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
