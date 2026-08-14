import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { User } from "../../drizzle/schema";
import { getUserByOpenId, upsertUser } from "../db";
import { ENV } from "./env";

export type TrpcContext = { req: CreateExpressContextOptions["req"]; res: CreateExpressContextOptions["res"]; user: User | null };

export function normalizeNeonIdentity(payload: JWTPayload) {
  if (!payload.sub) return null;
  return {
    openId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name : (typeof payload.email === "string" ? payload.email.split("@")[0] : "Nova member"),
  };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!ENV.neonAuthBaseUrl) return null;
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${ENV.neonAuthBaseUrl.replace(/\/$/, "")}/.well-known/jwks.json`));
  return jwks;
}

async function authenticateBearerToken(header: string | undefined): Promise<User | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const keySet = getJwks();
  if (!keySet || !ENV.neonAuthBaseUrl) return null;
  const issuer = new URL(ENV.neonAuthBaseUrl).origin;
  try {
    const { payload } = await jwtVerify(header.slice(7), keySet, { issuer, audience: issuer });
    const identity = normalizeNeonIdentity(payload);
    if (!identity) return null;
    await upsertUser({ ...identity, loginMethod: "neon_magic_link", lastSignedIn: new Date() });
    return (await getUserByOpenId(identity.openId)) ?? null;
  } catch (error) {
    console.warn("[Auth] Neon token validation failed", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  return { req: opts.req, res: opts.res, user: await authenticateBearerToken(opts.req.header("authorization")) };
}
