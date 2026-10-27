#!/usr/bin/env bun
/**
 * Documents the Whop one-time priority product for Nova Cloud Computer.
 *
 * Created via the Whop CLI against Nova Labs (`biz_x7eTBFTmhOxbVs`):
 *   Product: prod_QJUoiU8PU9bd6  (Nova Priority)
 *   Plan:    plan_BFyuf6PmE5wwz  (1 hour priority, one_time, S$4.99 SGD)
 *
 * Set this env var on the deployment:
 *   WHOP_PRIORITY_PLAN_ID=plan_BFyuf6PmE5wwz
 *
 * Ensure the Whop webhook endpoint receives `payment.succeeded` (and ideally
 * `membership.activated`) in addition to the existing membership events.
 *
 * Recreate with:
 *   whop products create --account_id biz_x7eTBFTmhOxbVs --title "Nova Priority" ...
 *   whop variants create --product_id <prod> --plan_type one_time --currency sgd --initial_price 4.99 ...
 */

const PRODUCT_ID = "prod_QJUoiU8PU9bd6";
const PLAN_ID = "plan_BFyuf6PmE5wwz";
const PRICE = "S$4.99";
const CURRENCY = "sgd";

console.log("Nova Priority Whop offer");
console.log(`  product:  ${PRODUCT_ID}`);
console.log(`  plan:     ${PLAN_ID}`);
console.log(`  price:    ${PRICE} (${CURRENCY}, one_time)`);
console.log(`  checkout: https://whop.com/checkout/${PLAN_ID}`);
console.log("\nAdd to deployment secrets:");
console.log(`  WHOP_PRIORITY_PLAN_ID=${PLAN_ID}`);
