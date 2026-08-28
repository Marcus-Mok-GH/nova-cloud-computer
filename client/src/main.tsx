import { trpc } from "@/lib/trpc";
import { getNeonAccessToken } from "@/lib/neonAuth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

// The bundle loaded, so the boot guard's auto-reload can arm again for any
// future load that fails (e.g. a deploy invalidating cached hashed chunks).
try { sessionStorage.removeItem("nova_boot_reload"); } catch { /* storage unavailable */ }

// Drop the boot guard's recovery marker from the address bar now that boot succeeded.
try {
  if (new URLSearchParams(location.search).has("nr")) {
    const url = new URL(location.href);
    url.searchParams.delete("nr");
    history.replaceState(null, "", url);
  }
} catch { /* URL/history unavailable */ }

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
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

createRoot(document.getElementById("root")!).render(<trpc.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><App /></QueryClientProvider></trpc.Provider>);
