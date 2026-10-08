import { createRoot, hydrateRoot } from "react-dom/client";
import { AppTree, createAppQueryClient, createAppTrpcClient } from "./appTree";
import { beginHydrationPass } from "./contexts/ThemeContext";
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

const queryClient = createAppQueryClient();
const trpcClient = createAppTrpcClient();
const root = document.getElementById("root")!;
const tree = <AppTree trpcClient={trpcClient} queryClient={queryClient} />;

if (root.hasChildNodes()) {
  // The landing page arrives server-rendered (client/src/entry-server.tsx)
  // with data-ssr on #root: adopt that markup instead of rebuilding it. The
  // first render must reproduce the server's markup exactly, so the theme
  // context defers reading the stored theme until hydration has committed.
  beginHydrationPass();
  hydrateRoot(root, tree);
} else {
  // Every other route gets the empty SPA shell and renders here on the client.
  createRoot(root).render(tree);
}
