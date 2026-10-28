# Nova free-promo tracker

Last updated: 2026-10-28 (Asia/Singapore)

## Canonical links

- Share landing (public): https://nimay.zo.space/nova
- Waitlist: https://nova-cloud-computer.vercel.app/sign-in
- Whop store: https://whop.com/nova-cloud-computer-pro/
- Checkout: https://whop.com/checkout/plan_qndYktNv5y8lg
- Promo kit: `docs/launch-promo-kit.md`

## Live surfaces

| Surface | Status | Notes |
| --- | --- | --- |
| Waitlist API | healthy | `POST /api/waitlist` → 200 `{"ok":true}` |
| App health | DB down | `/api/health` `database.ok=false` — blocks Show HN |
| Whop Nova Pro | visible | `marketplace_status: pending_review` |
| Affiliates | 30% enabled | 0 external affiliates yet (owner only) |
| Whop ads | unavailable | capacity refusal upstream |
| Share page | live | https://nimay.zo.space/nova (public) |
| Daily automation | scheduled | 09:00 SGT → Telegram |

## Directory / launch attempts

| Date | Channel | Result |
| --- | --- | --- |
| 2026-10-28 | Future Tools | Form filled; Cloudflare Turnstile blocked final submit |
| 2026-10-28 | Dofollow.Tools | Form started; Auto-fill forced sign-in |
| 2026-10-28 | TinyLaunch / Fazier / Findly | Require account login |
| 2026-10-28 | Uneed | Parked — rejects waitlist-only products until 1 Nov |
| 2026-10-28 | Neil Patel AI Tools submit URL | Redirects to Ubersuggest apps page (dead) |

## Blockers needing the founder

1. Connect X in Zo so organic replies/posts can ship without paid reach.
2. Re-auth Whop CLI (`whop login`) to unlock `promo_code:create` (planned `LAUNCH50`, 25 uses, first month).
3. Log into TinyLaunch / Fazier / Dofollow via [Browser](/browser) (GitHub works on TinyLaunch) and tell Zo to finish those submits.
4. Neon Postgres quota — restore DB before any Show HN.

## Next free moves (priority)

1. Founder completes X connect + one logged-in directory session.
2. Recruit affiliates (30%) with the share page + store link.
3. After 1 Nov (product usable): Uneed free queue + Product Hunt launch day.
4. Show HN only after `database.ok=true` and one real checkout observed.
