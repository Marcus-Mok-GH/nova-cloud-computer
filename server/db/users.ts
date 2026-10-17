import { eq } from "drizzle-orm";
import { InsertUser, users } from "../../drizzle/schema";
import { isDeveloperEmail } from "@shared/const";
import type { CreditRole } from "../credits";
import { requireDb } from "./core";

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("Nova could not complete sign-in. Please try again.");
  const db = await requireDb();
  // The developer rank is pinned to one address: signing in with it always
  // (re)asserts the role, even if the row was changed some other way. Not every
  // sign-in path carries the email, so fall back to the address already stored
  // on the row - otherwise a session-only upsert silently drops the pin and the
  // sole developer keeps whatever rank the row had (previously `admin`).
  const storedEmail = user.email
    ? undefined
    : (await db.select({ email: users.email }).from(users).where(eq(users.openId, user.openId)).limit(1))[0]?.email;
  const email = user.email ?? storedEmail ?? null;
  const isSoleDeveloper = isDeveloperEmail(email);
  const lastSignedIn = user.lastSignedIn ?? new Date();
  await db.insert(users).values({
    openId: user.openId,
    name: user.name ?? null,
    email,
    loginMethod: user.loginMethod ?? "neon_email_otp",
    role: isSoleDeveloper ? "developer" : user.role ?? "user",
    lastSignedIn,
  }).onConflictDoUpdate({
    target: users.openId,
    set: {
      // Session-only callers pass no profile fields: keep whatever is already
      // stored rather than blanking the row's name and email.
      ...(user.name !== undefined ? { name: user.name } : {}),
      email,
      loginMethod: user.loginMethod ?? "neon_email_otp",
      lastSignedIn,
      updatedAt: new Date(),
      ...(isSoleDeveloper ? { role: "developer" as const } : {}),
    },
  });
}

export async function getUserByOpenId(openId: string) {
  const db = await requireDb();
  return (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
}

export async function deleteUserAccount(userId: number): Promise<boolean> {
  const db = await requireDb();
  // Note: This deletes the local user record and associated workspace data via cascade.
  // The external Neon Auth identity (managed by Neon's Better Auth service) is not
  // automatically deleted because the Neon Auth Admin API does not currently expose
  // a deleteUser method. Users who need to fully remove their authentication identity
  // should contact Neon support or use the Neon Console to manually delete the auth user.
  // Reference: https://neon.com/docs/auth/guides/plugins/admin (Admin plugin methods)
  const [deleted] = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return !!deleted;
}

/** True when an admin has banned this account. Banned accounts cannot sign in
 * or use the Telegram bot; the ban is a first-party Nova state, independent of
 * the Neon Auth identity. */
export async function isUserBanned(userId: number): Promise<boolean> {
  const db = await requireDb();
  const [row] = await db.select({ bannedAt: users.bannedAt }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(row?.bannedAt);
}

/** Identity details the workspace agent greets the user by. */
export async function getUserIdentityForUser(userId: number): Promise<{ username: string | null; name: string | null; email: string | null }> {
  const db = await requireDb();
  const [row] = await db.select({ username: users.username, name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return row ?? { username: null, name: null, email: null };
}

/** True when another account already claims this username (case-insensitive). */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const db = await requireDb();
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  return Boolean(row);
}

/** Claims or re-claims the username for an account. Returns the updated row. */
export async function setUsernameForUser(userId: number, username: string) {
  const db = await requireDb();
  const [updated] = await db.update(users).set({ username, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
  return updated;
}

/** The account's rank, defaulting to a standard user when the row is missing. */
export async function getUserRole(ownerId: number): Promise<CreditRole> {
  const db = await requireDb();
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, ownerId)).limit(1);
  return row?.role ?? "user";
}
