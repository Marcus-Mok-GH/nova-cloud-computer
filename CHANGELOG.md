# Changelog

## 2026-08-18 — Mobile optimization pass

- `client/src/pages/Home.tsx`: Footer "Company"/"Follow"/"Explore" link columns now wrap to 2 columns below the `sm` breakpoint instead of forcing 3 cramped columns on narrow phones (≤375px), which was squeezing link labels and touch targets.
- `client/src/pages/SignIn.tsx`: Email input now uses `text-base` (16px) on mobile and `text-sm` from `sm:` up — 14px inputs trigger unwanted auto-zoom on iOS Safari when focused.
- `client/src/components/DashboardLayoutSkeleton.tsx` (pre-existing local diff, verified/kept): loading skeleton now mirrors the real `DashboardLayout` mobile structure (top bar + bottom tab bar) instead of showing a desktop-only sidebar skeleton on phones.

Verified via `agent-browser` at 320px, 390px, and 1280px viewports: no horizontal overflow, mobile nav menu toggle works, feature grid and file grids reflow correctly, dashboard mobile bottom-tab nav and top bar render as expected.
