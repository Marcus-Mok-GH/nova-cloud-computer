# HitPay PayNow (Singapore)

Whop does not offer PayNow at checkout — its Local Payment Methods list (docs.whop.com/payments-and-billing/local-payment-methods) has no PayNow row, and the regional-fees table shows GrabPay/ShopeePay for Malaysia but no PayNow for Singapore. `paynow` exists in the API enum, so `enabled: ["paynow"]` validates, but the checkout eligibility engine drops it before render. That's why the SGD checkout showed Card, GrabPay, Crypto, Touch 'n Go but never PayNow, even from Singapore.

This integration adds PayNow via HitPay, with a custom payment-methods page at `/checkout`.

## Flow

1. User clicks Upgrade (ModelSelector) or Buy priority (BillingCard) → routed to `/checkout?product=pro|priority`
2. `/checkout` (client/src/pages/Checkout.tsx) shows two options:
   - **PayNow QR (HitPay)** — `billing.createHitPayCheckout` → HitPay hosted checkout with `paynow_online`
   - **Card (Whop)** — `billing.createCheckout` / `billing.purchasePriority` → existing Whop hosted checkout (auto-renews for Pro)
3. HitPay webhook `POST /api/hitpay/webhook` verifies `Hitpay-Signature` (HMAC-SHA256 with salt) and grants:
   - Priority: `purchasePriorityForUser` (one hour, as Whop)
   - Pro: 30 days of Pro + monthly credits (one-time grant; PayNow is one-time-only per Stripe/HitPay docs, so Pro via PayNow does **not** auto-renew — user re-pays monthly)

## Env (server-only, Vercel)

```
HITPAY_API_KEY=
HITPAY_WEBHOOK_SALT=
HITPAY_API_BASE_URL=https://api.hit-pay.com   # or https://api.sandbox.hit-pay.com for sandbox
```

## HitPay dashboard setup

1. Create account at hitpayapp.com, verify business (Singapore)
2. Settings → API Keys → copy `X-BUSINESS-API-KEY` → `HITPAY_API_KEY`
3. Developers → Webhook Endpoints → New Webhook → `https://<your-domain>/api/hitpay/webhook` → subscribe `payment_request.completed`
4. Copy the webhook salt → `HITPAY_WEBHOOK_SALT`
5. Settings → Payment Methods → enable PayNow (enabled by default for SG businesses)

## Testing

- Sandbox: set `HITPAY_API_BASE_URL=https://api.sandbox.hit-pay.com` and sandbox keys
- `pnpm exec vitest run server/hitpay.test.ts server/billing.router.test.ts`
- Manual: open `/checkout?product=priority` → PayNow → scan QR → webhook should arm priority (check `billing.status`)
