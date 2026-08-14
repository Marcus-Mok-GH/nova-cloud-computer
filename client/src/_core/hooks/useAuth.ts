import { neonAuth } from "@/lib/neonAuth";
import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = { redirectOnUnauthenticated?: boolean; redirectPath?: string };

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/sign-in" } = options ?? {};
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });

  const logout = useCallback(async () => {
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

  useEffect(() => {
    if (!redirectOnUnauthenticated || state.loading || state.user || typeof window === "undefined") return;
    if (window.location.pathname !== redirectPath) window.location.assign(redirectPath);
  }, [redirectOnUnauthenticated, redirectPath, state.loading, state.user]);

  return { ...state, refresh: () => meQuery.refetch(), logout };
}
