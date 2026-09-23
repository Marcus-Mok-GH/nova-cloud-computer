import fs from "node:fs";

const fail = (message) => {
  console.error(`SPA cache convention failed: ${message}`);
  process.exit(1);
};

const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const rewrites = config.rewrites || [];
const spaRewrite = rewrites.find((rule) => rule.destination === "/api/spa.ts");

if (!spaRewrite) fail("vercel.json must route the SPA shell through /api/spa.ts");
if (!String(spaRewrite.source).includes("api/") || !String(spaRewrite.source).includes("assets/")) fail("the SPA rewrite must exclude /api/ and /assets/ paths");
if (rewrites.some((rule) => rule.destination === "/index.html")) fail("browser routes must not rewrite directly to /index.html");

const shell = fs.readFileSync("api/spa.ts", "utf8");
for (const required of ["dist/public/index.html", "Cache-Control", "no-store", "must-revalidate"]) {
  if (!shell.includes(required)) fail(`api/spa.ts is missing required marker: ${required}`);
}

const assetRule = (config.headers || []).find((rule) => String(rule.source).includes("/assets/"));
const assetCache = assetRule?.headers?.find((header) => header.key.toLowerCase() === "cache-control")?.value || "";
if (!assetCache.includes("immutable") || !assetCache.includes("31536000")) fail("/assets/* must remain immutable for one year");

console.log("SPA cache convention verified.");
