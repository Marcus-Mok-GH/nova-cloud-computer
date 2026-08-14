const CANONICAL_VERCEL_ORIGIN = "https://nova-cloud-computer.vercel.app";

/**
 * Passwordless links must return to a trusted origin. Dynamic Vercel deployment
 * URLs change on every build, so they are redirected to Nova's stable production
 * alias instead of being used directly as Better Auth callback URLs.
 */
export function getMagicLinkCallbackUrl(currentOrigin: string, configuredPublicOrigin?: string): string {
  const configuredOrigin = configuredPublicOrigin?.trim();
  if (configuredOrigin) return `${new URL(configuredOrigin).origin}/app`;

  const origin = new URL(currentOrigin).origin;
  if (new URL(origin).hostname.endsWith(".vercel.app")) {
    return `${CANONICAL_VERCEL_ORIGIN}/app`;
  }

  return `${origin}/app`;
}
