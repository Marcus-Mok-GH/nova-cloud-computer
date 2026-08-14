import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app } = require("../dist/server/app.cjs") as typeof import("../server/app");

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req, res);
}
