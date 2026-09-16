# Changelog

## 2026-09-16 — Heavyweight default: Kimi K3

- `server/nvidiaGateway.ts`: the hardcoded default chat model is now `moonshotai/kimi-k3`, verified on NVIDIA NIM — a native-multimodal MoE with 2.8T total parameters (104B active), RGB image input, function/tool calling, and a 1M-token context over the OpenAI-compatible chat API. The fallback ladder is unchanged: if a gateway does not serve it, the best other vision model is used (nemotron family first, e.g. Nemotron 3 Nano Omni), then the text fallback.
- `server/nvidiaGateway.client.test.ts`: tests for the Kimi K3 default and the omni degradation path.


## 2026-09-16 — Hardcoded NIM-verified vision default

- `server/nvidiaGateway.ts`: the default chat model is now hardcoded to `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, verified on NVIDIA NIM (build.nvidia.com) — vision-capable (jpeg/png image input), tool-calling, OpenAI-compatible chat. The discovery-driven default became a fallback ladder: if a gateway does not serve the hardcoded model, the best other vision model is used (nemotron family first), and only then `TEXT_FALLBACK_MODEL` (`nvidia/nemotron-3-super-120b-a12b`). Model classification no longer rejects chat models for having audio/video input modalities — only text-less models are excluded — so omni models stay eligible, and id-based detection now treats `omni` as vision.
- `server/nvidiaGateway.client.test.ts`: tests updated for the hardcoded default (served vs not-served, vision fallback ladder, text fallback) and omni discovery.


## 2026-09-16 — End-to-end webhook tests + recovering tool calls written as text

- `server/telegramUploadWebhook.test.ts` (new): drives the real express webhook handler with only the network and database faked — a photo update goes all the way from Telegram download through workspace save to an agent turn carrying the caption, the attachment note, and the image as vision input, then the reply lands back in the chat. Also covers text-file uploads (read_file routing), binary uploads (run_vm_task guidance) plus a failed-download path, and unlinked chats still getting the link prompt instead of running the agent.
- `server/workspaceAgent.ts`: some models spell a tool call out as text — "The function call that best answers the given prompt is {"name": "present_file", "parameters": {...}}" — instead of invoking it. The agent now recovers the intent: it extracts the embedded JSON (parameters, arguments, or a bare object), runs it as a real tool call, and the raw JSON never reaches the user. Capped at two recoveries per run; unknown tool names and ordinary JSON in replies are left untouched. The system prompt now also forbids writing tool calls as plain text.
- `server/workspaceAgent.test.ts`: tests for the recovered present_file round-trip (real tool call in the gateway transcript, action recorded, clean final reply) and for ordinary JSON passing through untouched.


## 2026-09-16 — The default model now switches to a vision-capable one

- `server/nvidiaGateway.ts`: the default chat model (used by every agent run) now prefers a vision-capable model. The gateway health probe's existing /models round-trip also primes model discovery — no extra request — and the default becomes the best vision model found, preferring the nemotron family; the text fallback `DEFAULT_NVIDIA_MODEL` stays when no vision model is available. `modelKind` now also detects vision models by id (`vision`, `vlm`, `multimodal`, `visual-language`) for gateways that return no modality metadata, plus new test hooks (`defaultNvidiaModel`, `resetNvidiaModelCache`).
- `server/nvidiaGateway.client.test.ts`: tests for the vision-first default (any vision model, nemotron preference, text fallback), and metadata-poor id-based vision detection.
- Combined with the previous commit, uploaded images now reach the model as vision input on the default configuration, with the strip-and-retry path still guarding non-vision selections.


## 2026-09-16 — The agent can read what users upload

- `server/nvidiaGateway.ts`: `GatewayChatMessage.content` now accepts OpenAI-style content parts alongside plain text, so a user turn can carry images as `image_url` parts.
- `server/workspaceAgent.ts`: new `imageAttachments` option — data-URI images ride along on the user turn as vision input. If the selected model rejects image parts, the run does not fail: the attachment is stripped, the model is told it cannot view images, and it answers from context.
- `server/app.ts`: upload context notes are now tailored to what arrived. Images are attached to the model's turn directly ("you can see it"), binary files explain the base64 data-URI layout and point at a short run_vm_task decode (e.g. pypdf for PDFs), and text files point at read_file.
- `server/workspaceAgent.test.ts`: tests for the vision turn shape and the graceful strip-and-retry path.


## 2026-09-16 — Telegram file uploads land in the workspace

- `server/telegram.ts`: the webhook no longer skips message-less uploads. `telegramUploadFromMessage` pulls the upload out of any update — photos (largest size), documents, voice notes, audio, video, video notes, stickers — and `downloadTelegramUpload` fetches it via getFile, keeping text-like files (by extension and mime type, including code and config files) as readable content and storing binary as a base64 data URI ready for present_file to re-present. Unnamed photos get stamped names like `photo-20260916-1119.jpg`.
- `server/app.ts`: on a linked chat, the upload is saved into the user's workspace before the agent run and the model receives a context note (📎 Attachment: "report.pdf" is file id N — acknowledge and work with it). The caption, or a generated "Uploaded <name>" line, becomes the user turn, so a bare file still runs the agent. If saving fails, the model is told to explain and suggest retrying — the reply stays model-driven.
- `server/telegram.test.ts`: tests for upload extraction (photo size picking, documents, voice, video, none), text vs binary storage, extension-based text detection under octet-stream mimes, and Telegram failure surfacing.


## 2026-09-16 — present_file: the Telegram bot can hand files to the user

- `server/telegram.ts`: new `presentTelegramFile` helper. Images arrive inline via sendPhoto for viewing — data URIs are decoded, hosted URLs are passed straight to Telegram, bare base64 is detected — and everything else is uploaded via sendDocument as a downloadable file with an optional caption. Failures surface Telegram's own error text.
- `server/workspaceAgent.ts`: new `present_file` tool, exposed *only on Telegram runs* (the web app filters it out since the workspace is browsable there). It resolves the file in the workspace, sends it over the linked bot chat, and records a "presented" action with a human summary ("Presented notes.txt to the user."). The Telegram prompt now tells the model to present files it creates or meaningfully updates so the user can view or download them right in the chat.
- `server/telegram.test.ts` and `server/workspaceAgent.test.ts`: tests for the upload paths (document, data-URI photo, URL photo, base64 fallback, failure) and the agent round-trip, graceful not-connected failure, and Telegram-only tool exposure.


## 2026-09-16 — Landing page: agent-action feature card replaces Conversations

- `client/src/pages/Home.tsx`: the middle feature card on the landing page no longer pitches conversations ("Useful help, in context") — it now positions Nova as *An agent that takes action*: "Instead of just chatting, Nova does the work — creating files, sending messages, and carrying jobs through to done." Icon swapped from MessageSquareText to Bot (the old icon stays in use in the hero preview mock).
- `client/src/pages/Home.render.test.tsx`: the landing test now asserts the new card copy and that the old Conversations copy is gone.


## 2026-09-16 — Landing-page workspace preview optimized for phones

- `client/src/pages/Home.tsx`: the hero's mock workspace window now adapts to small screens. Phones get a single-pane preview — the decorative sidebar (previously a fixed 132px column, roughly a third of a phone viewport) is hidden below sm and the mock content gets the full card width. The card also scales down on phones: tighter corner radii and padding, a lighter shadow, a shorter min-height (300px vs 390px), comfier content padding, and slightly tighter vertical rhythm between the chat card and the "pick up where you left off" cards. From sm up the two-pane workspace looks exactly as before, and the whole mock is now aria-hidden since it is purely decorative.
- `client/src/pages/Home.render.test.tsx`: added a regression test asserting the phone-first classes — single-pane grid, hidden sidebar, reduced min-height, and the decorative aria-hidden.


## 2026-09-16 — The AI owns the ETA end-to-end

- `server/workspaceAgent.ts`: the Telegram progress bullet now makes the model responsible for maintaining the estimate throughout the run — not just the opening one. It revises the range whenever reality diverges ("taking longer than expected — about 2 more minutes"), sends short updates at a steady rhythm while working (after each meaningful step, no long silent gaps), and says whether a blocker changes the ETA. The send_progress_update tool description now mentions revised ETAs. Still zero hardcoded logic: cadence and wording stay the model's own judgment, set by the system prompt.
- `server/workspaceAgent.test.ts`: the prompt test now asserts the revised-ETA and steady-rhythm guidance.


## 2026-09-16 — Model-driven progress updates replace the hardcoded reporter

- `server/agentProgress.ts` (removed): the heuristic ETA scorer and throttled reporter are gone. Per the project direction, progress behavior is *not* hardcoded — the AI itself decides the ETA, cadence, and blocker notices.
- `server/workspaceAgent.ts`: new `send_progress_update` tool (sends a brief mid-task note to the linked Telegram chat) plus a channel option on `runWorkspaceAgent` — `telegram` or `web` — surfaced to the model through the system prompt. A new prompt bullet tells the model how to keep the user posted on Telegram: open with an honest time estimate ("I'll get this done within about 30 seconds"), send interim updates instead of going silent, flag blockers immediately saying whether it needs the user, and skip interim notes in the web app where the user already watches tool activity live. The hardcoded round/blocker event plumbing was removed.
- `server/app.ts`: the Telegram webhook no longer constructs a reporter; it just passes `channel: "telegram"` to the agent run.
- `server/workspaceAgent.test.ts`: replaced the event tests with tests for the model-driven flow — the send_progress_update tool round-trip and the channel-aware system prompt.


## 2026-09-16 — Telegram progress updates: ETA, blockers, adaptive autonomy

- `server/agentProgress.ts` (new): a run-progress reporter that estimates an ETA from the request text the moment a Telegram message arrives ("I'll get this done within about 15–30 seconds"), sends throttled milestone updates with a revised ETA while the run is in flight, and immediately notifies on blockers — classifying each as a snag the agent works around on its own or one that needs the user's action. Trivial argument mistakes are suppressed and blocker notices cap at three per run so a flaky tool cannot flood the chat.
- `server/workspaceAgent.ts`: the run loop now emits `round_started`, `blocker`, and `round_completed` events through the existing `onEvent` channel (the web client ignores unknown event types, so `/api/chat/stream` is unaffected). The system prompt's "assume instead of asking" rule became an explicit collaboration policy: fully autonomous by default for reversible work, switching to a single focused question when guessing has a real cost — irreversible actions, personal taste the model cannot know, or credentials only the user can provide.
- `server/app.ts`: the Telegram webhook wires an `AgentRunProgressReporter` into every agent run, so the user gets the ETA message up front, milestone updates every ~20 seconds on long runs, and immediate blocker notices with a recovery plan.
- `server/agentProgress.test.ts` (new) and `server/workspaceAgent.test.ts`: tests for ETA formatting/estimation, blocker classification and throttling, and the new run-loop events.


## 2026-09-15 — Connector cards say Ready only when actually connected

- `client/src/pages/Workspace.tsx`: the overview Telegram connector card no longer hardcodes a "Ready" badge — it now reads the real Telegram link state, so it shows "Ready" only after the owner's Telegram chat is linked, and "Connect" when only the bot token is configured. GitHub and Gmail cards already reflected their OAuth state.
- `client/src/pages/Workspace.render.test.tsx`: added a regression test that a configured-but-unlinked Telegram shows no "Ready" badge, and a linked one does.


## 2026-09-15 — Vercel Web Analytics

- `client/index.html`: replaced the placeholder umami tag (which shipped a literal `%VITE_ANALYTICS_ENDPOINT%/umami` URL since the env vars were never set) with the native Vercel Web Analytics script `/_vercel/insights/script.js`, which Vercel serves once Web Analytics is enabled in the project dashboard and which tracks SPA page views automatically.
- `vite.config.ts`: removed the now-dead `vitePluginConditionalAnalyticsTag` transform that stripped the umami tag when analytics env vars were unset.


## 2026-09-13 — Better NVIDIA unavailable messages

- `server/workspaceAgent.ts`: when NVIDIA inference fails, the agent now checks gateway status before attempting completion and surfaces a specific message for each failure mode (not configured, unreachable, allowance exhausted) instead of the generic "isn't available" string. The catch block also inspects `NvidiaGatewayClientError.kind` and returns a targeted reply for configuration, rate-limit, and invalid-response errors.
- `server/workspaceAgent.test.ts`: added tests for the four new pre-check paths (unconfigured, unreachable, allowance exhausted, and each error kind from the catch block).

## 2026-09-13 — Stream chat responses end-to-end

- `server/nvidiaGateway.ts`: `completeWithNvidiaGateway` now accepts an `onChunk` callback and requests `stream: true` from the gateway, consuming the SSE `data:` events incrementally so the first token of a reply reaches the client long before the model finishes. If the gateway is not yet deployed with streaming it falls back to the buffered JSON body, emitted as a single chunk, so the wire format stays compatible. The non-stream path and its returned `{ text, model, usage, allowance }` shape are unchanged; `usage` may be `null` in stream mode.
- `server/nvidiaGateway.ts`: `getNvidiaGatewayStatus` caches the configured/reachable/provider flags in-process for 10s, so every chat message no longer performs a live `GET /api/nvidia/health`. Per-request DB allowance reads and the atomic inference claim are preserved; exported `resetNvidiaGatewayHealthCache()` for test isolation.
- `server/workspaceAgent.ts`: Conversational replies are built from streamed deltas (emitted via `options.onChunk`) and still persisted via `persistAssistant`; the direct-action and unavailable-NVIDIA fallback paths are unchanged. `runDirectWorkspaceAction` receives the already-loaded `computer` instead of reloading the workspace a second time per message.
- `server/routers.ts`, `server/app.ts`: Auto-title generation (`autoTitleChatForUser`) after `chats.send` and after Telegram webhook replies is now fire-and-forget, so a second full LLM completion no longer blocks the response.
- `server/db.ts`: `getOrCreateWorkspace` returns the freshly-read workspace row directly when `persistentSandboxId` is already stored, eliminating ~8–10 E2B connect/create calls per chat message. VM and automation flows still connect/provision explicitly where a live sandbox is actually needed.
- `client/src/pages/Workspace.tsx`: `finalizeStream` now performs a single immediate list refresh instead of a retry loop that slept up to ~3s with the input locked and the typing indicator shown.
- Tests: added streaming, buffered-fallback, and health-cache coverage in `server/nvidiaGateway.client.test.ts`; added conversational-chunk streaming coverage in `server/workspaceAgent.test.ts`.
- Verified: `tsc --noEmit` clean; targeted Vitest suites pass.

## 2026-09-09 — Behavior-preserving cleanup pass

- `server/automations.ts`: Removed the unused `runAutomationForUser` export and its sole consumer import `getAutomationRecordForUser`.
- `server/userAutomations.ts`: Inlined the `workspaceFor` wrapper into direct `getOrCreateWorkspace` calls at all call sites and removed the wrapper.
- `server/modelSecrets.ts`: `encryptModelApiKey`/`decryptModelApiKey` now derive the AES-256-GCM secret box once (lazily memoized at module scope) instead of re-creating it on every call. Encrypt/decrypt output unchanged.
- `client/src/components/DashboardLayoutSkeleton.tsx`, `client/src/components/TelegramModelSelector.tsx`, `client/src/pages/Chats.tsx`, `client/src/pages/More.tsx`, `client/src/pages/NotFound.tsx`: Removed unused default `React` imports (automatic JSX runtime). `Home`, `SignIn`, `WorkspaceSettings`, `NovaMark`, and `UserAutomationsCard` kept their imports because the Vitest render harness still uses the classic JSX transform.
- `server/automations.ts`: Dropped the now-internal-only `export` from the `WorkspaceBriefingInput` type.
- `server/_core/cookies.ts`, `server/app.ts`, `server/routers.ts`: Extracted the duplicated cookie/session-token parsing into a shared `sessionToken` helper in `server/_core/cookies.ts`, used by both the tRPC automations.update procedure and the Express user-automations handlers. Same cookie name and `""` fallback.
- `server/workspaceAgent.ts`: Extracted a local `persistAssistant(reply)` helper used by the three `role: "assistant"` `appendChatMessageForUser` call sites.
- `server/automations.ts`: Extracted shared `recentEntries(list, n)` and `plural(count, word)` TS helpers used in `buildWorkspaceBriefing`. The generated Python string template in `buildWorkspaceBriefingVmCode` was intentionally left byte-for-byte unchanged.
- `client/src/lib/nav.ts` (new), `client/src/pages/More.tsx`, `client/src/components/DashboardLayout.tsx`: Extracted the duplicated 5-item navigation array into a single shared `navItems` module; `description` is an optional field rendered only by `More.tsx`.
- Verified: `tsc --noEmit` clean, full Vitest suite matches baseline (32 files passed / 2 skipped; 140 tests passed / 3 skipped), `npm run build` succeeds.
- Added one-line docstrings to the new `sessionToken`, `recentEntries`, `plural`, `getSecretBox`, `persistAssistant` helpers and the `NavItem` type, per CodeRabbit's docstring-coverage nitpick on PR #74. Comment-only; no logic changed.

## 2026-09-08 — Clean up cron validation regex

- `server/automationPlanner.ts`: Removed the redundant backslash before `/` in the `validCron` character class and added a docstring describing the function. No behavior change.

## 2026-09-07 — Nova creates files and folders from natural language

- `server/workspaceAgent.ts`: Rewrote the workspace agent prompt so Nova no longer describes itself as a text-only assistant that cannot create, edit, move, or delete anything. It now states plainly that it creates files and folders, renames/moves/deletes them, sends Telegram messages, and starts VM runs — handled directly and reliably — while still never claiming to read file contents or run commands.
- `server/workspaceAgent.ts`: Broadened the direct file/folder create matching to accept `write`, `new`, and `titled`, plus extra content cues (`saying`, `that says`, `with the text`), so more natural requests create files and folders without a model round-trip.
- `server/workspaceAgent.test.ts`: Added coverage for a natural `write a file named … saying …` request.
- Verified: `tsc --noEmit` clean, tests pass, `biome check` clean.

## 2026-09-07 — Reset chat auto-scroll when switching conversations

- `client/src/pages/Workspace.tsx`: The user-stickiness scroll guard is now reset whenever `chatId` changes, so opening a different conversation scrolls to its latest message instead of inheriting the previous chat's scroll offset.


## 2026-09-07 — Show an animated "typing" indicator while Nova is working

- `client/src/pages/Workspace.tsx`: While the AI stream is active the chat now shows three animated dots instead of a static "Nova is thinking…" placeholder; the indicator is replaced by streamed text as tokens arrive and disappears the moment streaming finalizes. `finalizeStream` now always clears the streaming state even when the post-reply refetch fails, so the indicator can never linger.
- `client/src/index.css`: Added the `nova-typing-bounce` keyframes and a `.typing-dot` animation, with a `prefers-reduced-motion` fallback that keeps the dots static.
- `client/src/pages/Workspace.render.test.tsx`: Added coverage asserting the indicator is absent while idle and renders exactly three animated dots while working.
- Verified: `tsc --noEmit` clean, tests pass, `biome check` clean.

## 2026-09-07 — De-clutter the chat view and surface unavailable-AI replies as errors

- `client/src/pages/Workspace.tsx`: The chat view now auto-scrolls to the newest message (with a user-stickiness guard so it won't yank the viewport while reading history, except when a new message is sent). Repeated "Nova App" labels are deduped, so an assistant turn — tool activity panels plus the reply — reads as one grouped row instead of several noisy ones.
- `client/src/pages/Workspace.tsx`: When NVIDIA inference is unavailable, the persisted/streaming reply is now rendered as an explicit error bubble ("Nova is offline") instead of a normal reply. Detection is client-side only; the server-persisted copy is unchanged.
- `server/workspaceAgent.ts`, `shared/const.ts`: The NVIDIA-unavailable fallback text now lives in a single shared constant (`NVIDIA_UNAVAILABLE_MESSAGE`) imported by both the server (persist path) and the client (render path), so the copy can't drift.
- `client/src/pages/Workspace.render.test.tsx`: Added coverage for the error bubble and label-dedup behavior.
- Verified: `tsc --noEmit` clean, tests pass, `biome check` clean.

## 2026-09-07 — Replace OpenCode Zen VM with NVIDIA NIM; drop the home-screen NVIDIA metric

- `server/e2b.ts`: Removed the OpenCode Zen VM chat implementation (`provisionOpencodeOnSandbox`, `runOpencodeChatInPersistentSandbox`, `OpencodeChatResult`) and the `OPENCODE_CHAT_TIMEOUT_MS` constant. E2B sandboxes remain for autonomous task execution only; the opencode CLI is no longer provisioned or invoked for conversational work.
- `server/workspaceAgent.ts`: Conversational chat, chat auto-titling, and the VM agent path now call `completeWithNvidiaGateway` (NVIDIA NIM) instead of running the opencode CLI inside the user's persistent VM. The conversational path is explicitly text-only — the agent prompt no longer instructs shell/file tool use that the gateway can't perform — and the "Nova's VM (opencode) isn't available" fallback copy now references NVIDIA inference directly.
- `server/automationPlanner.ts`: Automation planning now runs through `completeWithNvidiaGateway` instead of the VM opencode agent. Gateway failures (configuration, rate-limit, unreachable) propagate immediately instead of being retried — retries now apply only to plan parse/sanitize failures — so a single request can't burn multiple inference allowance units.
- `server/_core/env.ts`: Removed the now-unused `opencodeZenModel` (`OPENCODE_ZEN_MODEL`) config.
- `client/src/pages/Workspace.tsx`: Removed the `NVIDIA requests used` metric from the home screen (and its `trpc.nvidia.status` query + `Sparkles` icon), leaving workspace stats to folders, files, and VM runs.
- Added `server/automationPlanner.test.ts` covering gateway-failure propagation and parse-only retries.
- Verified: `tsc --noEmit` clean, all tests pass (134 tests), `pnpm run build` succeeds.

## 2026-09-06 — De-clutter the landing nav on mobile

- `client/src/pages/Home.tsx`: The theme toggle is hidden from the top bar below `md` and now lives as a "Toggle theme" row inside the mobile hamburger menu (above the Sign up button), so the bar shows only the brand and the hamburger on phones. The top-bar container tightens to `gap-3 px-4` on mobile (`sm:gap-6 sm:px-5` above) and the right-cluster gap drops to `gap-2` on mobile (`sm:gap-2.5` above), so Log in + Sign up + theme do not feel squeezed at `sm`–`md` widths. Desktop (`md` and up) layout is unchanged.
- `client/src/index.css`: The landing `.pill-btn*`, `.topbar-link`, and `.theme-toggle` rules moved into `@layer components` so Tailwind's display utilities (`hidden`, `sm:inline-flex`, `md:hidden`, `md:inline-flex`) can override their layout — previously the unlayered `display: inline-flex` always won, so Log in/Sign up/theme toggle stayed visible at every width regardless of the `hidden …` classes.
- Verified: `tsc --noEmit` clean, all tests pass, `pnpm run build` succeeds.

## 2026-09-06 — Remove Forge object-storage requirement; persist workspace files in Neon

- `server/storage.ts` (deleted): Removed the Forge/S3 object-storage layer that required `BUILT_IN_FORGE_API_URL` and `BUILT_IN_FORGE_API_KEY`. Workspace files now persist directly in Neon Postgres via `file.content`, which was already the durable source of truth.
- `server/workspaceSync.ts`: Removed `persistWorkspaceToObjectStorage` and `restoreWorkspaceFromObjectStorage`, and dropped every S3 presign/fetch round-trip. `restoreWorkspaceToE2B` now reads file contents straight from the Postgres records, and `persistE2BWorkspace` writes changes back to Postgres only.
- `server/workspaceAgent.ts`, `server/agentVm.ts`: Removed the now-redundant `persistWorkspaceToObjectStorage` calls around agent runs.
- `server/workspaceSecurity.ts`: Removed the dead `requireWorkspaceStorageKey` helper (its only caller was the S3 object-key builder).
- `server/workspaceAgent.test.ts`: Dropped the stale `persistWorkspaceToObjectStorage` mock.

Note: `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` remain optional and are still consumed by the automations (heartbeat) and admin-notification features; they are no longer required for the workspace/E2B flow.

## 2026-09-06 — Stream the AI's chat responses as they are generated

- `server/e2b.ts`: `runOpencodeChatInPersistentSandbox` now wires an `onStdout` callback into the E2B `opencode run --format json` command and forwards each `text` part to `onChunk` as soon as opencode emits it, instead of buffering the full reply and re-emitting it as fixed 64-character chunks after the run finished. The authoritative reply is still reconstructed from the full stdout for persistence. Nova's workspace replies now appear progressively rather than all at once.

## 2026-09-06 — Fix chat message flicker, duplicates, and missing replies in the workspace chat

- `client/src/lib/chatMessages.ts` (new): Extracted `parsePersistedToolActivity` and `reconcileChatMessages`, a pure helper that decides whether the optimistic user bubble, streaming reply bubble, and live tool rows are still needed on top of the persisted conversation.
- `client/src/pages/Workspace.tsx`: The chat view now reconciles optimistic state against persisted messages. The user bubble is hidden once the server's copy loads, a tool row is never rendered twice (persisted + live), and the streaming reply stays on screen until the persisted reply is fetched. Optimistic state is now cleared only after `refreshMessages()` completes, so the reply never flashes to "Nova is working..." or disappears between the end of the stream and the refetch. The messages query also disables `refetchOnWindowFocus` and refetch failures keep the last known list.
- `client/src/lib/chatMessages.test.ts` (new): Covers user-bubble dedup, reply-bubble dedup, tool-activity dedup, and malformed persisted tool rows.

Addressed CodeRabbit review findings:
- Commit identity is now the persisted record id, not message content. `reconcileChatMessages` takes a `baselineMessageId` (the highest persisted id at submit time) and only treats records with a higher id as part of the current submission, so typing the same prompt or receiving the same reply twice is never mistaken for the earlier copy, and a tool id reused across turns is not wrongly suppressed.
- `parsePersistedToolActivity` now validates `args` as a flat string record (`parseStringRecord`), rejecting arrays, null, nested objects, and non-string values with the same empty-object fallback.
- `refreshMessages` returns an explicit success flag; `finalizeStream` retries the final refetch (up to 3 times with backoff) and only clears optimistic state on success, so a failed final refetch can no longer drop the reply or leave the UI stuck mid-submit.
- Verified: `tsc --noEmit` clean, all tests pass.


## 2026-09-06 — Fix bare opencode model ID breaking the VM agent

- `server/_core/env.ts`: Changed the `opencodeZenModel` default from `big-pickle` to `opencode/big-pickle`. A bare model name fails on OpenCode Zen with an opaque "Unexpected server error" (`UnknownError`), which made the VM opencode chat report "Nova's VM isn't available" and blocked agent runs.
- `server/e2b.ts`: `runOpencodeChatInPersistentSandbox` now qualifies bare model names with the `opencode/` provider prefix before building the `opencode run -m …` invocation, so both the new default and a bare `OPENCODE_ZEN_MODEL` override work. Empty model identifiers are rejected up front (CodeRabbit review).
- Verified: `tsc --noEmit` clean; `e2b` and `workspaceAgent` tests pass (22 tests).


## 2026-09-04 — Make the VM opencode CLI the workspace AI path (drop the Zen API key)

- `server/workspaceAgent.ts`: Removed the server-side `OPENCODE_ZEN_API_KEY` requirement and the hosted-model (`invokeLLM` + tool loop) chat path. Conversational chat now always runs the full opencode agent on the user's persistent VM (`runOpencodeChatInPersistentSandbox`, big-pickle, anonymous OpenCode Zen), mirroring Zo Computer. Explicit workspace actions (file/folder create-rename-move-delete, Telegram, VM run) are still resolved directly without a model. `autoTitleChatForUser` now asks the VM agent for a title instead of `invokeLLM`.
- `server/automationPlanner.ts`: Automation planning now runs on the VM's opencode agent (`runOpencodeChatInPersistentSandbox`), asking for the JSON plan and retrying up to three times, instead of the hosted-model structured-output call.
- `server/daytona.ts`: `provisionOpencodeOnSandbox` no longer reads or exports `OPENCODE_ZEN_API_KEY`; the CLI uses anonymous OpenCode Zen access. Removed the now-unused `runBashCommandInPersistentSandbox`/`sanitizeBashOutput` (only served the removed hosted-model bash tool).
- `server/telegramModelSettings.ts`: Removed the unused `getTelegramModelConnectionForUser`, which was the last user of the Zen key.
- `server/_core/env.ts`: Removed `opencodeZenApiKey` and `opencodeZenApiUrl`; kept `opencodeZenModel` (used by the VM path).
- `server/workspaceAgent.test.ts` / `server/daytona.test.ts`: Updated for the VM-only flow (no key gating, VM-unavailable copy, auto-title + automation via VM).
- Verified: `tsc --noEmit` clean, `workspaceAgent` and `daytona` tests pass, all 122 tests pass, Biome clean.


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
