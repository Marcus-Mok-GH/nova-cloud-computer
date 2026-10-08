import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { getNeonAccessToken } from "@/lib/neonAuth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import App from "./App";

/**
 * Builds the tRPC client for an entry point. Both the browser (main.tsx) and
 * the server render of the landing page (entry-server.tsx) create one; no
 * request is ever issued during the server render - queries only start after
 * hydration, in React effects.
 */
export function createAppTrpcClient() {
  return trpc.createClient({
    links: [httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
      async headers() {
        const token = await getNeonAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    })],
  });
}

export function createAppQueryClient() {
  return new QueryClient();
}

interface AppTreeProps {
  trpcClient: ReturnType<typeof createAppTrpcClient>;
  queryClient: QueryClient;
}

/**
 * The exact tree every entry point mounts - the client render, the client
 * hydration of the server-rendered landing page, and the server render itself
 * - so the markup always lines up. Its first committed render also clears the
 * `data-ssr` marker the prerendered document puts on #root, which tells
 * index.html's boot guard that React (not just static HTML) now owns the page.
 */
export function AppTree({ trpcClient, queryClient }: AppTreeProps) {
  useEffect(() => {
    document.getElementById("root")?.removeAttribute("data-ssr");
  }, []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
