# Changelog

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
## 2026-08-19 — Remove model chip from home hero mockup

- `client/src/pages/Home.tsx`: Removed the `mock-model-chip` showing "Claude" with a chevron from the hero section chat composer mockup, so the landing page no longer surfaces a model selector.
- `client/src/index.css`: Removed the now-unused `.mock-model-chip` styles.
