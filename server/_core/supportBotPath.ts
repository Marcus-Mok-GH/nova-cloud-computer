/**
 * The public Q&A assistant's tRPC route.
 *
 * The bot answers from a server-owned product brief and never reads or writes
 * the database, so its requests are routed around every database-backed step:
 * the session lookup in `createContext` and the schema/recovery bootstrap in
 * the Vercel entry. That keeps the widget answering while the database is
 * unavailable or over quota.
 */

/** The tRPC procedure path of the public Q&A mutation. */
export const SUPPORT_BOT_PROCEDURE = "support.ask";

/**
 * True when a URL targets the public Q&A procedure and nothing else.
 *
 * The tRPC adapter dispatches on the *last* path segment of the
 * mount-relative path - `req.path.slice(req.path.lastIndexOf("/") + 1)` - so
 * the classification has to read that same segment. A URL like
 * `/api/trpc/support.ask/../auth.me` dispatches `auth.me`, not the Q&A route,
 * and must not be treated as one; a trailing slash dispatches nothing at all.
 *
 * A batched tRPC request carries several procedures in one path
 * (`/api/trpc/support.ask,auth.me`). Such a request still needs the session
 * lookup for its other procedures, so only a batch made up entirely of the
 * Q&A procedure counts as database-free.
 */
export function isSupportBotRequestPath(url: string | undefined): boolean {
  if (!url) return false;
  const pathname = url.split(/[?#]/)[0] ?? "";
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  const procedures = lastSegment
    .split(",")
    .map(procedure => procedure.trim())
    .filter(Boolean);
  return (
    procedures.length > 0 &&
    procedures.every(procedure => procedure === SUPPORT_BOT_PROCEDURE)
  );
}
