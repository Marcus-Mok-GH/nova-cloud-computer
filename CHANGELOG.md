# Changelog

## 2026-08-18 — Mobile optimization pass

- `client/src/pages/Home.tsx`: Footer "Company"/"Follow"/"Explore" link columns now wrap to 2 columns below the `sm` breakpoint instead of forcing 3 cramped columns on narrow phones (≤375px), which was squeezing link labels and touch targets.
- `client/src/pages/SignIn.tsx`: Email input now uses `text-base` (16px) on mobile and `text-sm` from `sm:` up — 14px inputs trigger unwanted auto-zoom on iOS Safari when focused.
- `client/src/components/DashboardLayoutSkeleton.tsx`: loading skeleton now mirrors the real `DashboardLayout` mobile structure (sticky top bar + bottom tab bar) instead of showing a desktop-only sidebar skeleton on phones.
