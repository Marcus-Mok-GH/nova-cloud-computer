import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { COOKIE_NAME, SEVEN_DAYS_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { User } from "../../drizzle/schema";
import { getUserByOpenId, upsertUser } from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

export type TrpcContext = { req: CreateExpressContextOptions["req"]; res: CreateExpressContextOptions["res"]; user: User | null };

type NeonIdentity = {
  openId: string;
  email: string | null;
  name: string;
};

type BearerAuthentication = {
  user: User;
  identity: NeonIdentity;
};

export function normalizeNeonIdentity(payload: JWTPayload): NeonIdentity | null {
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

async function authenticateBearerToken(header: string | undefined): Promise<BearerAuthentication | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const keySet = getJwks();
  if (!keySet || !ENV.neonAuthBaseUrl) return null;
  const issuer = new URL(ENV.neonAuthBaseUrl).origin;
  try {
    const { payload } = await jwtVerify(header.slice(7), keySet, { issuer, audience: issuer });
    const identity = normalizeNeonIdentity(payload);
    if (!identity) return null;
    await upsertUser({ ...identity, loginMethod: "neon_magic_link", lastSignedIn: new Date() });
    const user = await getUserByOpenId(identity.openId);
    return user ? { user, identity } : null;
  } catch (error) {
    console.warn("[Auth] Neon token validation failed", error instanceof Error ? error.message : error);
    return null;
  }
}

async function authenticateFirstPartySession(cookieHeader: string | undefined): Promise<User | null> {
  const sessionToken = parseCookieHeader(cookieHeader ?? "")[COOKIE_NAME];
  const session = await sdk.verifySession(sessionToken);
  if (!session) return null;
  return getUserByOpenId(session.openId);
}

async function persistFirstPartySession(opts: CreateExpressContextOptions, identity: NeonIdentity) {
  const token = await sdk.createSessionToken(identity.openId, { expiresInMs: SEVEN_DAYS_MS, name: identity.name });
  opts.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(opts.req), maxAge: SEVEN_DAYS_MS });
}

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  const bearer = await authenticateBearerToken(opts.req.header("authorization"));
  if (bearer) {
    await persistFirstPartySession(opts, bearer.identity);
    return { req: opts.req, res: opts.res, user: bearer.user };
  }

  return { req: opts.req, res: opts.res, user: await authenticateFirstPartySession(opts.req.header("cookie")) };
}
