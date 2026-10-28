# Launch promo kit

Copy-paste assets for the pre-launch window (waitlist open until 1 November 2026).

Canonical links:

- Share landing (public): https://nimay.zo.space/nova
- Waitlist / sign-in page: https://nova-cloud-computer.vercel.app/sign-in
- Homepage: https://nova-cloud-computer.vercel.app
- Whop store page: https://whop.com/nova-cloud-computer-pro/
- Tracker: `docs/promo-tracker.md`

Positioning: a personal cloud computer that stays on. Your files, projects and AI agent live on a machine that keeps working while your laptop is shut.

## X / Twitter (single post)

Your laptop sleeps. Your projects shouldn't.

Nova is a personal cloud computer — files, projects and an AI agent on a machine that stays on 24/7.

Early access opens 1 November. Join the waitlist: https://nimay.zo.space/nova

## X / Twitter (thread)

1/ I keep closing my laptop and killing my own work. So I built Nova: a personal cloud computer, not another chatbot.

2/ It's a persistent workspace — files, projects, notes — with an AI agent that can actually run things on it. Scheduled jobs keep running after you shut down.

3/ Everything is yours: open file formats on your own box. No tab graveyard, no re-explaining context every morning.

4/ Early access opens 1 November. Waitlist is open now: https://nova-cloud-computer.vercel.app/sign-in

## LinkedIn

Most "AI tools" are a chat window that forgets you the moment you close the tab.

Nova is different: a personal cloud computer that stays on. Your workspace, files and an AI agent that keeps working in the background — the way a computer should.

Waitlist opens for early access on 1 November: https://nova-cloud-computer.vercel.app/sign-in

## Product Hunt (teaser comment)

Nova is a personal cloud computer — a persistent workspace with an AI agent that can run tasks, manage files and keep scheduled work going after your laptop is closed. Early access opens 1 November; the waitlist is live now.

## Reddit / forum (r/selfhosted, r/SideProject tone — no hard sell)

I got tired of my "AI workflow" dying every time I closed the lid, so I've been building Nova: a personal cloud computer. Persistent files and projects, plus an agent that can execute work on the box itself (files, scheduled jobs, sandboxes).

Not launching yet — early access opens 1 November and I'm keeping the group small. Waitlist: https://nova-cloud-computer.vercel.app/sign-in

Happy to answer questions about the architecture (React + tRPC + Postgres, agent gateway, sandboxed execution).

## Paid ads status (28 Oct 2026)

Whop's ad network is not an available channel right now. `ad-campaigns list` returns an empty set and campaign creation is refused upstream (platform capacity, not a permission or billing problem). Re-check before relying on it:

```bash
whop ad-campaigns create --account_id biz_x7eTBFTmhOxbVs --platform whop --title "Nova waitlist" --objective traffic --budget_type daily --budget_amount 10
```

Until it reopens, promotion runs on free surfaces only: the public share landing, the Whop store page (banner + gallery set), the 30% affiliate program, the waitlist, free directory submissions, and manual posting of the copy below.

### Free surfaces already live

- Whop store page with banner and gallery: https://whop.com/nova-cloud-computer-pro/
- Global affiliate program at 30% (`global_affiliate_status: enabled`) — recruit affiliates to do the distribution
- Waitlist endpoint verified end to end (`POST /api/waitlist` → 200 `{"ok":true}`)

## Rules we hold ourselves to

- Never claim features that are not shipped.
- One link per post; no tracking redirects.
- Reply to every question in the first 24 hours.
- No paid promotion of the waitlist until signup capture is verified end to end.