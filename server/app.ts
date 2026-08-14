import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";

export const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
app.get("/api/health", (_req, res) => res.status(200).json({ ok: true, service: "nova" }));
