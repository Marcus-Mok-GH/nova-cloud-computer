import { renderToString } from "react-dom/server";
import { AppTree, createAppQueryClient, createAppTrpcClient } from "./appTree";

/**
 * Server-side render of the landing page ("/"). The build
 * (scripts/prerender-landing.mjs) injects this markup into the SPA shell and
 * writes dist/public/landing.html, which every server sends for "/" while all
 * other routes keep the empty shell that renders on the client. main.tsx
 * hydrates whatever arrives with children already in #root.
 *
 * The tree is AppTree - the same one main.tsx mounts - so hydration matches:
 * the server cannot know the visitor's stored theme or session, and both are
 * deliberately resolved after hydration (see ThemeContext's hydration pass;
 * auth queries only start in React effects).
 */
export function renderLanding(): string {
  return renderToString(
    <AppTree
      trpcClient={createAppTrpcClient()}
      queryClient={createAppQueryClient()}
    />
  );
}
