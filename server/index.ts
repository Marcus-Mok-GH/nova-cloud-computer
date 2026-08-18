import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { app } from "./app";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const server = createServer(app);

  // API and scheduled routes are mounted by ./app before this static fallback.
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`Nova server listening on http://localhost:${port}`);
  });
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
