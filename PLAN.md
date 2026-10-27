# Plan: One-time payment for priority requests

## Goal

Let a Nova user buy one hour of priority service for a single upfront payment of **S$4.99 (SGD)**, using Whop. Priority should not be granted just because someone clicked the button; it should begin only after Whop confirms the payment.

## Status

Approved and implemented on branch `feat/sgd-priority-checkout`.

### Done in Whop (Nova Labs)

- Product: `prod_QJUoiU8PU9bd6` — Nova Priority
- One-time plan: `plan_BFyuf6PmE5wwz` — **S$4.99 SGD**
- Checkout base URL: `https://whop.com/checkout/plan_BFyuf6PmE5wwz`

### Done in Nova

- Buy priority opens Whop checkout instead of granting for free
- Server arms priority only after a verified Whop `payment.succeeded` (or priority `membership.activated`) webhook
- Duplicate webhook deliveries are ignored
- Priority memberships never flip Nova Pro
- Billing copy shows **S$4.99**

### Still needed for production

1. Set `WHOP_PRIORITY_PLAN_ID=plan_BFyuf6PmE5wwz` on the deployment (with existing `WHOP_API_KEY` and `WHOP_WEBHOOK_SECRET`).
2. In the Whop dashboard, ensure the webhook that posts to `/api/whop/webhook` includes **`payment.succeeded`** (API-key login is required for webhook CLI changes).
3. Optional: add a product logo in Whop so the product can be published to the storefront (checkout via plan id already works without publishing).

## What the user will experience

1. In **Settings → Billing**, the priority section explains that priority lasts one hour and starts with the next message.
2. The purchase button shows **Buy priority — S$4.99**.
3. Selecting it opens secure Whop checkout for a one-time payment.
4. After payment succeeds, Nova arms the one-hour priority window. The countdown starts with the next message.
5. If the user cancels or payment fails, no priority is granted.

## Not included

- No change to Nova Pro pricing or benefits
- No change to the one-hour duration or when the timer starts
- No automatic production deploy from this branch alone
