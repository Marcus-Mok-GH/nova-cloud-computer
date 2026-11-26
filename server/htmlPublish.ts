/**
 * Publish-time HTML repairs for generated websites.
 *
 * A published page is the user's first impression of the site, and a page
 * that renders blank is worse than no page at all. Two repairs run on the way
 * out, so a file that was fine in the workspace still goes live working.
 */

import { NOVA_BADGE_HTML, NOVA_BADGE_MARKER, withNovaBadge } from "./novaBadge";

/**
 * Babel standalone 8 compiles JSX with the AUTOMATIC runtime, which emits
 * `import { jsx as _jsx } from "react/jsx-runtime"`. A page that loads that
 * as a classic <script> cannot parse it ("Cannot use import statement outside
 * a module"), so the component never registers, `window.App` stays undefined
 * and React renders nothing - a blank page with no visible error.
 *
 * Babel 7's preset-react defaults to the CLASSIC runtime, which compiles to
 * `React.createElement(...)` and works with the global React the page already
 * loads from a CDN. So when a page asks for the react preset AND pulls Babel
 * standalone unpinned (which today resolves to v8), pin the CDN URL to
 * Babel 7 at publish time. Pages without the react preset already compile to
 * the classic runtime and are left alone.
 */
const PINNED_BABEL_STANDALONE = "https://unpkg.com/@babel/standalone@7/babel.min.js";
const REACT_PRESET = /data-presets\s*=\s*["'][^"']*\breact\b[^"']*["']/i;
// Any Babel standalone URL - unpinned (today: v8) or pinned to a major.
const BABEL_STANDALONE_URL = /https:\/\/unpkg\.com\/@babel\/standalone(?:@(\d+))?\/babel\.min\.js/g;
// A separate non-global copy for detection: a /g regex keeps lastIndex
// between calls, so testing with it would give alternating answers.
const HAS_BABEL_STANDALONE =
  /https:\/\/unpkg\.com\/@babel\/standalone(?:@\d+)?\/babel\.min\.js/;

/** The pinned major of a Babel standalone URL, or null when it is not pinned. */
function babelMajor(url: string): number | null {
  const match = url.match(/@babel\/standalone@(\d+)\//);
  return match ? Number(match[1]) : null;
}

/** Pins Babel standalone when the page's react preset would break it. */
export function repairBabelRuntime(html: string): string {
  if (!html || !REACT_PRESET.test(html)) return html;
  if (!HAS_BABEL_STANDALONE.test(html)) return html;
  return html.replace(BABEL_STANDALONE_URL, (url) => {
    const major = babelMajor(url);
    return major !== null && major < 7 ? url : PINNED_BABEL_STANDALONE;
  });
}

/**
 * The HTML a published page carries: the Nova badge plus the Babel repair.
 * The badge stays idempotent, so republishing an already-badged page does not
 * stack badges.
 */
export function preparePublishedHtml(html: string): string {
  return withNovaBadge(repairBabelRuntime(html));
}

export { NOVA_BADGE_HTML, NOVA_BADGE_MARKER };
