/**
 * Owner-scoped "is a terminal shell open right now" registry.
 *
 * The terminal attaches a PTY inside the workspace's persistent E2B sandbox —
 * the same machine agent runs use. Pausing that machine (the end-of-run idle
 * pause, or a standalone VM run finishing) freezes it and drops every PTY on
 * it, so an agent run in one tab would silently kill a shell open in another.
 * The pause sites consult this registry and skip the pause while a terminal is
 * live, so the shared machine stays warm until the shell is done with it. The
 * next run, or the terminal's own teardown, pauses it as usual.
 *
 * Deliberately a tiny module with no imports: both `terminal.ts` and
 * `sandboxWorkspace.ts` need it, and routing it through either one would create
 * an import cycle (`terminal.ts` -> `sandboxWorkspace.ts` -> `terminal.ts`).
 *
 * In-memory, like the terminal sessions themselves: a server restart loses both
 * together, and a stale "open" entry can only keep a sandbox warm, never leave
 * one paused while a shell is attached.
 */

const openTerminals = new Map<number, number>();

/** Records that an owner has a live shell; repeated calls are counted. */
export function markTerminalSessionOpen(ownerId: number) {
  openTerminals.set(ownerId, (openTerminals.get(ownerId) ?? 0) + 1);
}

/** Records that an owner's shell ended (closed, or exited on its own). */
export function markTerminalSessionClosed(ownerId: number) {
  const count = openTerminals.get(ownerId) ?? 0;
  if (count <= 1) openTerminals.delete(ownerId);
  else openTerminals.set(ownerId, count - 1);
}

/** True while the owner has a terminal shell open in the shared sandbox. */
export function hasOpenTerminalSession(ownerId: number): boolean {
  return (openTerminals.get(ownerId) ?? 0) > 0;
}

/** Test seam: forget every tracked shell. */
export function resetSandboxLivenessForTests() {
  openTerminals.clear();
}
