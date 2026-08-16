import { neonAuth } from "@/lib/neonAuth";
import { trpc } from "@/lib/trpc";
import { SEVEN_DAYS_MS } from "@shared/const";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = { redirectOnUnauthenticated?: boolean; redirectPath?: string };

export const LAST_ACTIVE_KEY = "nova_last_active_timestamp";
export const ACTIVITY_THROTTLE_MS = 10_000; // Throttle localStorage updates to at most once every 10 seconds

export function updateLastActiveTimestamp() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    // ignore storage errors
  }
}

export function getLastActiveTimestamp(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const val = localStorage.getItem(LAST_ACTIVE_KEY);
    return val ? Number(val) : null;
  } catch {
    return null;
  }
}

export function clearLastActiveTimestamp() {
  if (typeof window === "undefined") return;
  try {
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

  const logout = useCallback(async () => {
    clearLastActiveTimestamp();
    await neonAuth?.signOut();
    utils.auth.me.setData(undefined, null);
    await utils.invalidate();
  }, [utils]);

  const state = useMemo(() => ({
    user: meQuery.data ?? null,
    loading: meQuery.isLoading,
    error: meQuery.error ?? null,
    isAuthenticated: Boolean(meQuery.data),
  }), [meQuery.data, meQuery.error, meQuery.isLoading]);

  // Handle inactivity expiration & activity tracking
  useEffect(() => {
    if (typeof window === "undefined" || !state.isAuthenticated) return;

    const lastActive = getLastActiveTimestamp();

    // Check if session has expired due to 7 days of inactivity
    if (isSessionExpiredDueToInactivity(lastActive)) {
      logout();
      return;
    }

    // Initialize last active timestamp if not present
    if (!lastActive) {
      updateLastActiveTimestamp();
    }

    // Event listener to record activity (throttled)
    let lastUpdated = 0;
    const handleUserActivity = () => {
      const now = Date.now();
      if (now - lastUpdated > ACTIVITY_THROTTLE_MS) {
        lastUpdated = now;
        updateLastActiveTimestamp();
      }
    };

    const events: (keyof WindowEventMap)[] = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach(evt => window.addEventListener(evt, handleUserActivity, { passive: true }));

    // Periodic check for inactivity
    const checkInterval = setInterval(() => {
      const currentLastActive = getLastActiveTimestamp();
      if (isSessionExpiredDueToInactivity(currentLastActive)) {
        logout();
      }
    }, 60_000);

    return () => {
      events.forEach(evt => window.removeEventListener(evt, handleUserActivity));
      clearInterval(checkInterval);
    };
  }, [state.isAuthenticated, logout]);

  useEffect(() => {
    if (!redirectOnUnauthenticated || state.loading || state.user || typeof window === "undefined") return;
    if (window.location.pathname !== redirectPath) window.location.assign(redirectPath);
  }, [redirectOnUnauthenticated, redirectPath, state.loading, state.user]);

  return { ...state, refresh: () => meQuery.refetch(), logout };
}
