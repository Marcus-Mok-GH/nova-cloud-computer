import { ENV } from "./_core/env";

/**
 * Composio connector client. Composio manages the OAuth dance and credential
 * storage for toolkits like GitHub; Nova only ever sees action results.
 *
 * The workspace owner sets COMPOSIO_API_KEY (a Composio project API key) and
 * each Nova user connects their own GitHub account through an auth link
 * session, scoped to a stable per-user Composio user id.
 */

const DEFAULT_TOOLKIT = "github";
const REQUEST_TIMEOUT_MS = 20_000;

export class ComposioApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ComposioApiError";
  }
}

export type ComposioConnectionStatus = {
  configured: boolean;
  connected: boolean;
  status: "active" | "disconnected";
  connectedAccountId: string | null;
};

export type ComposioToolSummary = {
  slug: string;
  name: string;
  description: string;
  inputParameters: Record<string, unknown>;
};

export type ComposioToolExecution = {
  ok: boolean;
  data: unknown;
  error: string | null;
};

export function isComposioConfigured() {
  return Boolean(ENV.composioApiKey);
}

/** Stable Composio user id for a Nova workspace owner. */
export function composioUserId(ownerId: number) {
  return `nova-user-${ownerId}`;
}

async function composioRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  if (!ENV.composioApiKey)
    throw new ComposioApiError("Composio is not configured. Set COMPOSIO_API_KEY on the server.", 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${ENV.composioApiUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-api-key": ENV.composioApiKey,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof ComposioApiError) throw error;
    throw new ComposioApiError(`Composio request failed: ${(error as Error).message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const parsed = payload as { error?: { message?: string } | string } | undefined;
    const detail =
      parsed?.error && typeof parsed.error === "object" && parsed.error.message
        ? parsed.error.message
        : typeof parsed?.error === "string"
          ? parsed.error
          : text.slice(0, 300);
    throw new ComposioApiError(detail || `Composio request failed with status ${response.status}.`, response.status);
  }
  return payload as T;
}

type ConnectedAccountsResponse = {
  items?: Array<{ id: string; status?: string }>;
};

/** Reports whether the user's GitHub account is connected through Composio. */
export async function getComposioConnectionStatus(
  ownerId: number,
  fetchImpl: typeof fetch = fetch
): Promise<ComposioConnectionStatus> {
  if (!isComposioConfigured())
    return { configured: false, connected: false, status: "disconnected", connectedAccountId: null };
  const data = await composioRequest<ConnectedAccountsResponse>(
    `/connected_accounts?user_id=${encodeURIComponent(composioUserId(ownerId))}&toolkit_slug=${DEFAULT_TOOLKIT}`,
    {},
    fetchImpl
  );
  const account = (data.items ?? []).find(
    item => (item.status ?? "").toUpperCase() === "ACTIVE"
  );
  return {
    configured: true,
    connected: Boolean(account),
    status: account ? "active" : "disconnected",
    connectedAccountId: account?.id ?? null,
  };
}

/**
 * Starts an auth link session for GitHub and returns the hosted URL the user
 * should visit to authorize. Composio-managed OAuth configs are addressed via
 * the /connected_accounts/link endpoint.
 */
export async function createComposioConnectionLink(
  ownerId: number,
  options: { callbackUrl?: string } = {},
  fetchImpl: typeof fetch = fetch
): Promise<{ redirectUrl: string; connectedAccountId: string | null }> {
  const configs = await composioRequest<{ items?: Array<{ id: string }> }>(
    `/auth_configs?toolkit_slug=${DEFAULT_TOOLKIT}&is_composio_managed=true`,
    {},
    fetchImpl
  );
  const config = (configs.items ?? [])[0];
  if (!config)
    throw new ComposioApiError(
      "No GitHub auth config exists in this Composio project yet. Create one in the Composio dashboard.",
      404
    );
  const link = await composioRequest<{ redirect_url?: string; connected_account_id?: string }>(
    "/connected_accounts/link",
    {
      method: "POST",
      body: {
        auth_config_id: config.id,
        user_id: composioUserId(ownerId),
        ...(options.callbackUrl ? { callback_url: options.callbackUrl } : {}),
      },
    },
    fetchImpl
  );
  if (!link.redirect_url)
    throw new ComposioApiError("Composio did not return an authorization URL for GitHub.", 502);
  return { redirectUrl: link.redirect_url, connectedAccountId: link.connected_account_id ?? null };
}

/** Searches Composio's GitHub tool catalog and returns slugs plus parameter schemas. */
export async function listComposioTools(
  ownerId: number,
  options: { search?: string; limit?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<{ tools: ComposioToolSummary[] }> {
  await requireComposioConnection(ownerId, fetchImpl);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);
  const query = new URLSearchParams({
    toolkit_slug: DEFAULT_TOOLKIT,
    limit: String(limit),
  });
  if (options.search?.trim()) query.set("query", options.search.trim());
  const data = await composioRequest<{
    items?: Array<{ slug: string; name?: string; description?: string; human_description?: string; input_parameters?: Record<string, unknown> }>;
  }>(`/tools?${query.toString()}`, {}, fetchImpl);
  return {
    tools: (data.items ?? []).map(item => ({
      slug: item.slug,
      name: item.name ?? item.slug,
      description: item.human_description ?? item.description ?? "",
      inputParameters: item.input_parameters ?? {},
    })),
  };
}

/** Executes a Composio GitHub tool on behalf of the connected user. */
export async function executeComposioTool(
  ownerId: number,
  toolSlug: string,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<ComposioToolExecution> {
  await requireComposioConnection(ownerId, fetchImpl);
  const result = await composioRequest<{
    data?: unknown;
    error?: string;
    successful?: boolean;
  }>(
    `/tools/execute/${encodeURIComponent(toolSlug)}`,
    {
      method: "POST",
      body: {
        user_id: composioUserId(ownerId),
        arguments: args,
      },
    },
    fetchImpl
  );
  return {
    ok: result.successful !== false && !result.error,
    data: result.data ?? null,
    error: result.error ?? null,
  };
}

/** Throws a clear ComposioApiError when the toolkit is not usable for this user. */
async function requireComposioConnection(ownerId: number, fetchImpl: typeof fetch) {
  if (!isComposioConfigured())
    throw new ComposioApiError(
      "Composio connectors are not configured on this Nova server. The owner must set COMPOSIO_API_KEY.",
      503
    );
  const status = await getComposioConnectionStatus(ownerId, fetchImpl);
  if (!status.connected)
    throw new ComposioApiError(
      "GitHub is not connected yet. The user must open Settings and connect GitHub first.",
      428
    );
}
