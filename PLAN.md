# Nova pre-launch waitlist — plan

Status: shipped (code merged, provider credentials pending)
Date: 2026-10-28
Owner: CEO (Zo) / Nimay
Supersedes: the previous PLAN.md (Whop one-time priority checkout), which has shipped.

## Goal

Until **1 November 2026**, `/sign-in` is replaced by a waitlist. Visitors leave their email in an
external service. When Nova opens, everyone on the list gets **"Nova is now live!"** and a link back
into the product.

Constraints:

- $0 spend. No paid list tooling, no paid domain.
- The list must live **outside** our database. Neon is over its network-transfer quota, so nothing in
  this flow may depend on Postgres.
- Reversible. On 1 November the real sign-in must come back with no deploy, no migration, no manual step.

## Provider decision

**Buttondown** (`buttondown.com`) — free tier, 100 active subscribers, unlimited sends, API access on
every plan.

Why:

- Keyless public embed endpoint, so collection works before we have any credentials at all.
- A REST API on the free tier, so the launch broadcast can be one command rather than a UI ritual.
- Markdown editor, CSV export, and no per-email metering on the free plan.

Known limits we are accepting:

- 100 subscribers is the smallest free tier available. Acceptable for a soft launch; if we outgrow it,
  EmailOctopus (2,500 subs / 10k sends free) is the migration target and only the provider constants
  change.
- Sender reputation: sending as a `@gmail.com` address lands in spam often, because Gmail's own DMARC
  policy outranks anything the provider signs. The launch mail goes out from Buttondown's sending
  identity unless and until we own a domain with SPF/DKIM.

Fallback if Buttondown stalls: EmailOctopus free. Same shape — one public form endpoint, one API key
for the blast.

## Architecture

One page, one date constant, one thin server proxy.

```
client/src/pages/SignIn.tsx        (unchanged OTP flow)
client/src/pages/SignInRoute.tsx   new - decides what /sign-in renders
  └─ waitlist active and not bypassed ? <Waitlist /> : <SignIn />

client/src/pages/Waitlist.tsx      new
  └─ POST /api/waitlist { email, company }
       200 → "You're on the list"   400 → inline validation error
       429 → "try again in a few minutes"   503 → "briefly unavailable"

server/waitlist.ts                 new
  └─ POST /api/waitlist
       BUTTONDOWN_API_KEY set  → POST api.buttondown.com/v1/subscribers (tagged nova-waitlist)
       else BUTTONDOWN_USERNAME → POST the public embed-subscribe form, 2xx/3xx = accepted
       neither                 → 503 { error: "waitlist-not-configured" }
```

Why the proxy exists: a browser `fetch` to Buttondown's embed endpoint is cross-origin with no CORS
grant, which means either a blocked request or an opaque response we cannot read — and therefore no
honest success or error state. Posting from our server removes that ambiguity, lets the API key stay
server-side, and still stores no email on our side.

Why the gate lives in a wrapper and not inside `SignIn.tsx`: the sign-in component owns OTP hooks and a
redirect effect for already-authenticated users. A conditional early return inside it would risk
hook-order breakage. Keeping `SignIn.tsx` byte-identical means restoring sign-in on 1 November cannot
regress the OTP path.

Details:

- **Date gate** — `NOVA_WAITLIST_END_MS` (`2026-11-01T00:00:00.000Z`) in `shared/waitlist.ts`.
  `isWaitlistActive()` compares against `Date.now()` on every call, so the switch flips itself with no
  cron and no redeploy.
- **Kill switch / owner escape hatch** — `/sign-in?waitlist=0` (also `off` / `false`) renders the real
  sign-in at any time, so Nimay can still get in and demo during the window. `/app` is never gated.
- **Anti-spam** — hidden `company` honeypot (bots get a fake 200) plus a coarse per-IP throttle
  (10 attempts / 10 minutes). Buttondown still handles double opt-in and dedupe.
- **No PII in our logs** — addresses are forwarded to Buttondown and never written to Postgres, tRPC,
  or the filesystem. Neither error path echoes the address.
- **Co-deployed route** — `waitlist` is in the `isCoDeployedApiPath` list in `api/[...path].ts`, so the
  request reaches Nova's own server instead of being proxied away.

## Waitlist page

Single screen in the existing landing visual language (light theme, orange accent, Nova logo):

- Headline: "Nova opens on 1 November."
- Sub: a cloud computer that runs projects, files, and AI around the clock; one email when doors open.
- Email field + "Join the waitlist" button.
- Fine print: one launch email, no newsletter, deletion on request.
- Post-submit state: "You're on the list." with the address echoed back.
- No password field, no OTP, no link to the old sign-in.

## Launch email

Subject: **Nova is now live!**

```
Nova is live.

You asked to be told the moment it happened — this is that moment.

Nova is a cloud computer you talk to. It runs your files, your terminal and your agents,
and it keeps working while you sleep.

Start here: https://nova-cloud-computer.vercel.app

— Nova Labs
```

Sent once, to the `nova-waitlist` tag, on 1 November. Plain text plus the provider's HTML render.

## Rollout

1. ~~Build `Waitlist.tsx`, add the gate, wire `POST /api/waitlist`. PR against `main`.~~ Shipped.
2. Provider credentials: either `BUTTONDOWN_USERNAME` (collection only, no key) or `BUTTONDOWN_API_KEY`
   (collection + tags + the launch send) as a Vercel production env var. Without one of them the
   endpoint answers 503 and the page says so honestly.
3. Redeploy, then submit a real address and confirm it appears in the Buttondown list.
4. On 1 November: send the broadcast, the gate flips itself back, nothing else to do.

## Tests

- `shared/waitlist.test.ts` — the gate closes exactly at the launch instant; bypass parsing accepts
  only explicit off values.
- `server/waitlist.test.ts` — address normalisation, unconfigured 503 with no outbound call, API path
  tags the address, embed path accepts a redirect, already-subscribed is a success, provider failure is
  502, honeypot returns a fake 200, throttle returns 429.
- `client/src/pages/Waitlist.render.test.tsx` — the page promises one launch email, offers no route into
  the product, and `SignInRoute` serves the waitlist before launch and the real sign-in after it.
- `api/neonAuthCatchall.test.ts` — `/api/waitlist` stays co-deployed.

## Risks

| Risk | Mitigation |
| --- | --- |
| >100 signups on launch day | Migrate to EmailOctopus; Buttondown exports CSV in one click |
| Duplicate submissions | Provider dedupes by address; the UI treats "already subscribed" as success |
| Spam placement of the launch mail | Send from Buttondown's identity, not `@gmail.com`; short body, one link |
| Provider credentials not set yet | Endpoint answers 503 and the page says "briefly unavailable" rather than lying |
| Someone expects to log in during the window | Owner bypass plus explicit "opens 1 November" copy |

## Known gaps / follow-ups

- Landing and footer CTAs still read "Sign in" because the label lives in 18 locale files; making them
  say "Join the waitlist" is a separate i18n change, not a blocker.
- The waitlist collects but does not confirm; subscribers are added as regular (not double-opt-in)
  when the API key path is used.

## Out of scope

- Referral or position-in-queue mechanics.
- Sending anything other than the single launch announcement.
- Moving the waitlist onto our own database, now or after launch.
- Any paid plan on any provider.

## Acceptance criteria

- `/sign-in` shows the waitlist, and only the waitlist, until 2026-11-01T00:00:00Z.
- A submitted address appears in the Buttondown list within a minute.
- Successful and failed submits both render inline, with no page reload.
- `/sign-in?waitlist=0` reaches the real OTP flow.
- Nothing in the flow touches Postgres.
- After the deadline, `/sign-in` is the normal sign-in again with no code change.