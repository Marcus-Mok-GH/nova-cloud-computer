import "dotenv/config";
import { createServer } from "http";
import { app } from "../app";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const server = createServer(app);
  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Nova server listening on http://localhost:${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
