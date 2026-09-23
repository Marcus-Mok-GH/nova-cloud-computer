import { readFile } from "node:fs/promises";
import path from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const INDEX_PATH = path.resolve(process.cwd(), "dist/public/index.html");

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const html = await readFile(INDEX_PATH, "utf8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (error) {
    console.error("[SPA shell] Failed to read built index.html", error);
    return res.status(500).send("Nova is temporarily unavailable.");
  }
}
