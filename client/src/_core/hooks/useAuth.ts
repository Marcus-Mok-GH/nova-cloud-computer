import { clearRememberedNeonJwt, neonAuth } from "@/lib/neonAuth";
import { trpc } from "@/lib/trpc";
import { SEVEN_DAYS_MS } from "@shared/const";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = { redirectOnUnauthenticated?: boolean; redirectPath?: string };

export const LAST_ACTIVE_KEY = "nova_last_active_timestamp";
export const ACTIVITY_THROTTLE_MS = 10_000; // Throttle localStorage updates to at most once every 10 seconds

function getUserScopedKey(userId: number): string {
  return `${LAST_ACTIVE_KEY}_user_${userId}`;
}

export function updateLastActiveTimestamp(userId?: number) {
  if (typeof window === "undefined" || userId === undefined) return;
  try {
    localStorage.setItem(getUserScopedKey(userId), String(Date.now()));
  } catch {
    // ignore storage errors
  }
}

export function getLastActiveTimestamp(userId?: number): number | null {
  if (typeof window === "undefined" || userId === undefined) return null;
  try {
    const val = localStorage.getItem(getUserScopedKey(userId));
    return val ? Number(val) : null;
  } catch {
    return null;
  }
}

export function clearLastActiveTimestamp(userId?: number) {
  if (typeof window === "undefined") return;
  try {
    // Clear user-specific timestamp if userId provided
    if (userId !== undefined) {
      localStorage.removeItem(getUserScopedKey(userId));
    }
    // Also clear legacy unscoped key for backwards compatibility
    localStorage.removeItem(LAST_ACTIVE_KEY);
  } catch {
    // ignore
  }
}

export function isSessionExpiredDueToInactivity(
  lastActive: number | null,
  now: number = Date.now(),
  maxInactiveMs: number = SEVEN_DAYS_MS
): boolean {
  if (!lastActive || isNaN(lastActive)) return false;
  return now - lastActive > maxInactiveMs;
}

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/sign-in" } = options ?? {};
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const { mutateAsync: clearFirstPartySession } = trpc.auth.logout.useMutation();

  const logout = useCallback(async (userId?: number) => {
    clearLastActiveTimestamp(userId);
    clearRememberedNeonJwt();
    const tasks: Promise<unknown>[] = [clearFirstPartySession()];
    if (neonAuth) tasks.push(neonAuth.signOut());
    await Promise.allSettled(tasks);
    utils.auth.me.setData(undefined, null);
    await utils.invalidate();
  }, [clearFirstPartySession, utils]);

  const state = useMemo(() => ({
    user: meQuery.data ?? null,
    loading: meQuery.isLoading,
    error: meQuery.error ?? null,
    isAuthenticated: Boolean(meQuery.data),
  }), [meQuery.data, meQuery.error, meQuery.isLoading]);

  // Handle inactivity expiration & activity tracking
  useEffect(() => {
    if (typeof window === "undefined" || !state.isAuthenticated || !state.user?.id) return;

    const userId = state.user.id;
    const lastActive = getLastActiveTimestamp(userId);

    // Check if session has expired due to 7 days of inactivity
    if (isSessionExpiredDueToInactivity(lastActive)) {
      logout(userId);
      return;
    }

    // Initialize last active timestamp if not present
    if (!lastActive) {
      updateLastActiveTimestamp(userId);
    }

    // Event listener to record activity (throttled)
    let lastUpdated = 0;
    const handleUserActivity = () => {
      const now = Date.now();
      if (now - lastUpdated > ACTIVITY_THROTTLE_MS) {
        lastUpdated = now;
        updateLastActiveTimestamp(userId);
      }
    };

    const events: (keyof WindowEventMap)[] = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach(evt => window.addEventListener(evt, handleUserActivity, { passive: true }));

    // Periodic check for inactivity
    const checkInterval = setInterval(() => {
      const currentLastActive = getLastActiveTimestamp(userId);
      if (isSessionExpiredDueToInactivity(currentLastActive)) {
        logout(userId);
      }
    }, 60_000);

    return () => {
      events.forEach(evt => window.removeEventListener(evt, handleUserActivity));
      clearInterval(checkInterval);
    };
  }, [state.isAuthenticated, state.user?.id, logout]);

  useEffect(() => {
    if (!redirectOnUnauthenticated || state.loading || state.user || typeof window === "undefined") return;
    if (window.location.pathname !== redirectPath) window.location.assign(redirectPath);
  }, [redirectOnUnauthenticated, redirectPath, state.loading, state.user]);

  return { ...state, refresh: () => meQuery.refetch(), logout: () => logout(state.user?.id) };
}
