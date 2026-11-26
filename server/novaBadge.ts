import { NOVA_PUBLIC_APP_URL } from "@shared/const";

export const NOVA_BADGE_TEXT = "Made with Nova";
export const NOVA_BADGE_MARKER = "data-nova-badge";

const badgeStyle = [
  "position:fixed",
  "right:16px",
  "bottom:16px",
  "z-index:2147483647",
  "padding:7px 11px",
  "border-radius:999px",
  "background:rgba(16,20,24,.82)",
  "color:#fff",
  "font:500 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
  "text-decoration:none",
  "letter-spacing:.01em",
  "box-shadow:0 2px 10px rgba(0,0,0,.22)",
].join(";");

/** A fixed, unobtrusive badge injected into every generated HTML page. */
export const NOVA_BADGE_HTML =
  `<a ${NOVA_BADGE_MARKER}="1" href="${NOVA_PUBLIC_APP_URL}" ` +
  `target="_blank" rel="noopener noreferrer" style="${badgeStyle}">${NOVA_BADGE_TEXT}</a>`;

export function isHtmlFileName(name: string): boolean {
  return /\.html?$/i.test(name.trim());
}

/** Idempotent; leaves fragments and non-HTML content untouched. */
export function withNovaBadge(html: string): string {
  if (!html || html.includes(NOVA_BADGE_MARKER)) return html;
  if (!/<html[\s>]/i.test(html) && !/<body[\s>]/i.test(html)) return html;
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${NOVA_BADGE_HTML}</body>`);
  if (/<\/html\s*>/i.test(html)) return html.replace(/<\/html\s*>/i, `${NOVA_BADGE_HTML}</html>`);
  return `${html}${NOVA_BADGE_HTML}`;
}
