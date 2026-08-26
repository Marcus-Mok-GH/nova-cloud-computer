import { trpc } from "@/lib/trpc";
import { getNeonAccessToken } from "@/lib/neonAuth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

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
