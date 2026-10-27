#!/usr/bin/env bun
/**
 * Creates the Whop subscription product for Nova Cloud Computer.
 * Run with: bun scripts/create-whop-subscription.ts
 * 
 * Requires WHOP_API_KEY in environment (from Whop Dashboard > Developer Settings)
 */

import { WhopServerSdk } from "@whop/api";

const WHOP_API_KEY = process.env.WHOP_API_KEY;
const APP_URL = process.env.NOVA_WEB_APP_URL || "https://novacloud.computer";

if (!WHOP_API_KEY) {
  console.error("ERROR: WHOP_API_KEY environment variable not set");
  console.error("Get it from: https://whop.com/dashboard/developer");
  process.exit(1);
}

const whop = new WhopServerSdk({ apiKey: WHOP_API_KEY });

async function main() {
  console.log("Creating Whop subscription product for Nova Cloud Computer...\n");

  // 1. Create the Product
  console.log("1. Creating product...");
  const product = await whop.products.create({
    name: "Nova Cloud Computer Pro",
    description: "Monthly subscription for Nova Cloud Computer - 10,000 credits/month with rollover, access to all premium models including Nova Pro",
    is_marketplace_listed: false,
    is_public: false,
    metadata: {
      product_type: "subscription",
      platform: "nova-cloud-computer",
    },
  });
  console.log(`   Product created: ${product.id}`);

  // 2. Create the Plan ($7.99/month)
  console.log("2. Creating plan ($7.99/month)...");
  const plan = await whop.plans.create({
    product_id: product.id,
    name: "Pro Monthly",
    description: "10,000 credits per month (unused credits roll over), access to all premium models including Nova Pro",
    pricing_type: "recurring",
    price: {
      amount: 799, // $7.99 in cents
      currency: "USD",
      interval: "month",
    },
    billing_cycle_anchor: "immediate",
    trial_period_days: 0,
    max_quantity: 1,
    is_archived: false,
    metadata: {
      credits_per_month: "10000",
      includes_premium_models: "true",
      includes_nova_pro: "true",
    },
  });
  console.log(`   Plan created: ${plan.id}`);

  // 3. Create the Variant (for checkout)
  console.log("3. Creating variant...");
  const variant = await whop.variants.create({
    plan_id: plan.id,
    name: "Nova Pro Monthly",
    description: "Monthly subscription - $7.99/month",
    is_archived: false,
    sort_order: 0,
    metadata: {
      variant_type: "monthly",
    },
  });
  console.log(`   Variant created: ${variant.id}`);

  // 4. Create a checkout link
  console.log("4. Creating checkout session...");
  const checkout = await whop.checkout.sessions.create({
    variant_id: variant.id,
    success_url: `${APP_URL}/settings?billing=success`,
    cancel_url: `${APP_URL}/settings?billing=cancelled`,
    mode: "subscription",
    metadata: {
      product: "nova-pro-monthly",
    },
  });
  console.log(`   Checkout URL: ${checkout.url}`);

  console.log("\n✅ Setup complete!");
  console.log("\n--- Environment Variables to Add ---");
  console.log(`WHOP_API_KEY=${WHOP_API_KEY}`);
  console.log(`WHOP_PRODUCT_ID=${product.id}`);
  console.log(`WHOP_PLAN_ID=${plan.id}`);
  console.log(`WHOP_VARIANT_ID=${variant.id}`);
  console.log(`WHOP_CHECKOUT_URL=${checkout.url}`);
  console.log("\nAdd these to your environment (Settings > Advanced > Secrets)");
  console.log("Also set WHOP_WEBHOOK_SECRET after registering the webhook in Whop Dashboard");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
