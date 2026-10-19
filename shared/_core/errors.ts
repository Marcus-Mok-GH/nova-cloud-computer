/**
 * Base HTTP error class with status code.
 * Throw this from route handlers to send specific HTTP errors.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Convenience constructors
export const ForbiddenError = (msg: string) => new HttpError(403, msg);

/**
 * The readable message of a caught value, for logs and user-facing copy.
 * Rejections that are not Error objects (strings, raw fetch failures) fall back
 * to `fallback` when given, otherwise to their text.
 */
export const errorMessage = (error: unknown, fallback?: string): string =>
  error instanceof Error ? error.message : (fallback ?? String(error));

/**
 * A short, single-line excerpt of a failed response's body, for error messages.
 * Empty when the body cannot be read, and capped so a page of HTML cannot flood
 * a log or a model prompt.
 */
export const responseErrorDetail = async (
  response: Response,
  maxChars = 300
): Promise<string> =>
  (await response.text().catch(() => ""))
    .slice(0, maxChars)
    .replace(/\s+/g, " ")
    .trim();
