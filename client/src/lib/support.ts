/**
 * Support/donation entry point.
 *
 * The link opens an external Buy Me a Coffee page in a new tab. It is env
 * configurable (`VITE_BUY_ME_A_COFFEE_URL`) so the destination can change
 * without a code deploy, and only https URLs are honoured.
 */

const FALLBACK_SUPPORT_URL = "https://buymeacoffee.com/NovaLabsOfficial";

export const SUPPORT_DISMISS_KEY = "nova.support.dismissed.v1";

function normalizeSupportUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Where the “Buy us a coffee” button points. */
export const SUPPORT_URL =
  normalizeSupportUrl(import.meta.env?.VITE_BUY_ME_A_COFFEE_URL) ??
  FALLBACK_SUPPORT_URL;

export function isSupportDismissed(): boolean {
  try {
    return window.localStorage.getItem(SUPPORT_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissSupport(): void {
  try {
    window.localStorage.setItem(SUPPORT_DISMISS_KEY, "1");
  } catch {
    /* private mode or storage disabled: the card simply shows again next load */
  }
}
