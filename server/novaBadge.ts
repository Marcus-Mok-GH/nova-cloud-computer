import { NOVA_BRAND_INK, NOVA_BRAND_ORANGE, NOVA_PUBLIC_APP_URL } from "@shared/const";

export const NOVA_BADGE_TEXT = "Made with Nova";
export const NOVA_BADGE_MARKER = "data-nova-badge";

const badgeStyle = [
  "position:fixed",
  "right:16px",
  "bottom:16px",
  "z-index:2147483647",
  "display:inline-flex",
  "align-items:center",
  "gap:8px",
  "padding:9px 12px",
  "border:1px solid rgba(0,0,0,.12)",
  "border-radius:8px",
  `background:${NOVA_BRAND_ORANGE}`,
  `color:${NOVA_BRAND_INK}`,
  "font:600 13px/18px system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
  "text-decoration:none",
  "box-shadow:0 2px 8px rgba(0,0,0,.16)",
].join(";");

/** A fixed, unobtrusive badge injected into every generated HTML page. */
export const NOVA_BADGE_HTML =
  `<a ${NOVA_BADGE_MARKER}="1" href="${NOVA_PUBLIC_APP_URL}" ` +
  `target="_blank" rel="noopener noreferrer" style="${badgeStyle}">` +
  `<span>Made with Nova</span><span aria-hidden="true">↗</span></a>`;

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
