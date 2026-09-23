import { ENV } from "./_core/env";

/**
 * Composio connector client. Composio manages the OAuth dance and credential
 * storage for toolkits like GitHub; Nova only ever sees action results.
 *
 * The workspace owner sets COMPOSIO_API_KEY (a Composio project API key) and
 * each Nova user connects their own GitHub account through an auth link
 * session, scoped to a stable per-user Composio user id.
 */

const REQUEST_TIMEOUT_MS = 20_000;

/** Connector toolkits Nova supports through Composio. */
export const COMPOSIO_TOOLKITS = ["github", "gmail"] as const;
export type ComposioToolkit = (typeof COMPOSIO_TOOLKITS)[number];

export function isComposioToolkit(value: unknown): value is ComposioToolkit {
  return value === "github" || value === "gmail";
}

/** Display name used in user-facing status and error messages. */
export function toolkitLabel(toolkit: ComposioToolkit) {
  return toolkit === "github" ? "GitHub" : "Gmail";
}

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
  status: "active" | "disconnected" | "error";
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

/**
 * Stable, model-facing GitHub operations.
 *
 * Keep this list intentionally small. The raw Composio catalog also contains
 * GitHub App installation actions and event endpoints with parameters that are
 * not available for a normal OAuth connection. Exposing those actions makes
 * the model spend turns discovering tools that cannot work.
 */
export const GITHUB_OPERATIONS = [
  "search_repositories",
  "get_repository",
  "read_file",
  "list_pull_requests",
  "get_pull_request",
  "get_issue",
  "list_issue_comments",
  "create_issue",
  "comment_on_issue",
  "create_pull_request",
  "write_file",
] as const;
export type GithubOperation = (typeof GITHUB_OPERATIONS)[number];

const GITHUB_OPERATION_ACTIONS: Record<GithubOperation, string> = {
  search_repositories: "GITHUB_FIND_REPOSITORIES",
  get_repository: "GITHUB_GET_A_REPOSITORY",
  read_file: "GITHUB_GET_REPOSITORY_CONTENT",
  list_pull_requests: "GITHUB_GET_PULL_REQUESTS",
  get_pull_request: "GITHUB_GET_A_PULL_REQUEST",
  get_issue: "GITHUB_GET_AN_ISSUE",
  list_issue_comments: "GITHUB_GET_ISSUE_COMMENTS",
  create_issue: "GITHUB_CREATE_AN_ISSUE",
  comment_on_issue: "GITHUB_CREATE_AN_ISSUE_COMMENT",
  create_pull_request: "GITHUB_CREATE_A_PULL_REQUEST",
  write_file: "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
};

export function isGithubOperation(value: unknown): value is GithubOperation {
  return typeof value === "string" && (GITHUB_OPERATIONS as readonly string[]).includes(value);
}

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
  items?: Array<{ id: string; status?: string; user_id?: string; toolkit?: { slug?: string } | string }>;
};

/** Best-effort toolkit slug for a connected-account item (may be absent on older payloads). */
function connectedAccountToolkit(item: NonNullable<ConnectedAccountsResponse["items"]>[number]): string | null {
  if (typeof item.toolkit === "string") return item.toolkit.toLowerCase();
  return item.toolkit?.slug?.toLowerCase() ?? null;
}

/** Reports whether the user's GitHub account is connected through Composio. */
export async function getComposioConnectionStatus(
  ownerId: number,
  toolkit: ComposioToolkit,
  fetchImpl: typeof fetch = fetch
): Promise<ComposioConnectionStatus> {
  if (!isComposioConfigured())
    return { configured: false, connected: false, status: "disconnected", connectedAccountId: null };
  const data = await composioRequest<ConnectedAccountsResponse>(
    `/api/v3/connected_accounts?user_id=${encodeURIComponent(composioUserId(ownerId))}&toolkit_slug=${toolkit}`,
    {},
    fetchImpl
  );
  // The Composio list endpoint ignores the user_id and toolkit_slug query
  // params (verified live: it returns accounts for every user and toolkit in
  // the project), so scope client-side. Items that omit the toolkit field
  // still match, so an older payload cannot silently hide a real connection.
  const account = (data.items ?? []).find(item => {
    if (item.user_id !== composioUserId(ownerId)) return false;
    if ((item.status ?? "").toUpperCase() !== "ACTIVE") return false;
    const itemToolkit = connectedAccountToolkit(item);
    return itemToolkit === null || itemToolkit === toolkit;
  });
  return {
    configured: true,
    connected: Boolean(account),
    status: account ? "active" : "disconnected",
    connectedAccountId: account?.id ?? null,
  };
}

/**
 * Deletes the user's active connected account for a toolkit. Composio drops
 * the stored credentials, so Nova loses access until the user connects again.
 * Returns the refreshed status after the deletion.
 */
export async function deleteComposioConnection(
  ownerId: number,
  toolkit: ComposioToolkit,
  fetchImpl: typeof fetch = fetch
): Promise<ComposioConnectionStatus> {
  if (!isComposioConfigured())
    return { configured: false, connected: false, status: "disconnected", connectedAccountId: null };
  const before = await getComposioConnectionStatus(ownerId, toolkit, fetchImpl);
  if (!before.connected || !before.connectedAccountId)
    throw new ComposioApiError(
      `${toolkitLabel(toolkit)} is not connected, so there is nothing to disconnect.`,
      404
    );
  await composioRequest(
    `/api/v3/connected_accounts/${encodeURIComponent(before.connectedAccountId)}`,
    { method: "DELETE" },
    fetchImpl
  );
  return getComposioConnectionStatus(ownerId, toolkit, fetchImpl);
}

/**
 * Starts an auth link session for GitHub and returns the hosted URL the user
 * should visit to authorize. Composio-managed OAuth configs are addressed via
 * the /connected_accounts/link endpoint.
 */
export async function createComposioConnectionLink(
  ownerId: number,
  toolkit: ComposioToolkit,
  options: { callbackUrl?: string } = {},
  fetchImpl: typeof fetch = fetch
): Promise<{ redirectUrl: string; connectedAccountId: string | null }> {
  const configs = await composioRequest<{ items?: Array<{ id: string }> }>(
    `/api/v3/auth_configs?toolkit_slug=${toolkit}&is_composio_managed=true`,
    {},
    fetchImpl
  );
  const config = (configs.items ?? [])[0];
  if (!config)
    throw new ComposioApiError(
      `No ${toolkitLabel(toolkit)} auth config exists in this Composio project yet. Create one in the Composio dashboard.`,
      404
    );
  const link = await composioRequest<{ redirect_url?: string; connected_account_id?: string }>(
    "/api/v3/connected_accounts/link",
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
  toolkit: ComposioToolkit,
  options: { search?: string; limit?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<{ tools: ComposioToolSummary[] }> {
  await requireComposioConnection(ownerId, toolkit, fetchImpl);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);
  const query = new URLSearchParams({
    toolkit_slug: toolkit,
    limit: String(limit),
  });
  if (options.search?.trim()) query.set("query", options.search.trim());
  const data = await composioRequest<{
    items?: Array<{ slug: string; name?: string; description?: string; human_description?: string; input_parameters?: Record<string, unknown> }>;
  }>(`/api/v3.1/tools?${query.toString()}`, {}, fetchImpl);
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
  toolkit: ComposioToolkit,
  toolSlug: string,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<ComposioToolExecution> {
  await requireComposioConnection(ownerId, toolkit, fetchImpl);
  const result = await composioRequest<{
    data?: unknown;
    error?: string;
    successful?: boolean;
  }>(
    `/api/v3.1/tools/execute/${encodeURIComponent(toolSlug)}`,
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

type GithubOperationInput = Record<string, unknown>;

/** Raises a client-facing validation error for malformed GitHub input. */
function githubInputError(message: string): never {
  throw new ComposioApiError(`GitHub ${message}`, 400);
}

/** Reads a required non-empty, trimmed string argument. */
function requiredString(input: GithubOperationInput, name: string): string {
  const value = typeof input[name] === "string" ? input[name].trim() : "";
  if (!value) githubInputError(`requires ${name}.`);
  return value;
}

/** Reads a required positive integer argument, accepting numeric strings. */
function positiveInteger(input: GithubOperationInput, name: string): number {
  const value = typeof input[name] === "number" ? input[name] : Number(input[name]);
  if (!Number.isInteger(value) || value < 1) githubInputError(`${name} must be a positive integer.`);
  return value;
}

/** Splits and validates the model-facing owner/name repository format. */
function repositoryParts(input: GithubOperationInput): { owner: string; repo: string } {
  const repository = requiredString(input, "repo").replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  const separator = repository.indexOf("/");
  if (separator <= 0 || separator === repository.length - 1 || repository.indexOf("/", separator + 1) !== -1)
    githubInputError(`repo must use the owner/name format, for example "octocat/Hello-World".`);
  return {
    owner: repository.slice(0, separator),
    repo: repository.slice(separator + 1),
  };
}

/** Reads an optional string argument and omits blank values. */
function optionalString(input: GithubOperationInput, name: string): string | undefined {
  const value = typeof input[name] === "string" ? input[name].trim() : "";
  return value || undefined;
}

/** Reads a string argument without modifying file content whitespace. */
function rawString(input: GithubOperationInput, name: string): string {
  const value = input[name];
  if (typeof value !== "string") githubInputError(`requires ${name}.`);
  return value;
}

/**
 * Converts one predictable GitHub operation into the exact Composio action
 * and parameters it needs. The model never has to discover action slugs,
 * split owner/repo, or know that issue comments also cover pull requests.
 */
export function githubOperationRequest(
  operation: GithubOperation,
  input: GithubOperationInput
): { action: string; args: Record<string, unknown> } {
  if (operation === "search_repositories") {
    const requestedQuery = optionalString(input, "query");
    const query = requestedQuery ?? "*";
    const args: Record<string, unknown> = {
      query,
      per_page: typeof input.per_page === "number" ? input.per_page : 25,
      response_detail: "minimal",
      ...(requestedQuery ? {} : { for_authenticated_user: true }),
    };
    const owner = optionalString(input, "owner");
    if (owner) args.owner = owner;
    if (typeof input.language === "string" && input.language.trim()) args.language = input.language.trim();
    if (typeof input.archived === "boolean") args.archived = input.archived;
    if (typeof input.for_authenticated_user === "boolean") args.for_authenticated_user = input.for_authenticated_user;
    return { action: GITHUB_OPERATION_ACTIONS[operation], args };
  }

  const { owner, repo } = repositoryParts(input);
  const base = { owner, repo };

  switch (operation) {
    case "get_repository":
      return { action: GITHUB_OPERATION_ACTIONS[operation], args: base };
    case "read_file":
      return {
        action: GITHUB_OPERATION_ACTIONS[operation],
        args: { ...base, path: requiredString(input, "path"), ...(optionalString(input, "ref") ? { ref: optionalString(input, "ref") } : {}) },
      };
    case "list_pull_requests":
      return {
        action: GITHUB_OPERATION_ACTIONS[operation],
        args: {
          ...base,
          state: optionalString(input, "state") ?? "open",
          per_page: typeof input.per_page === "number" ? input.per_page : 25,
        },
      };
    case "get_pull_request":
      return { action: GITHUB_OPERATION_ACTIONS[operation], args: { ...base, pull_number: positiveInteger(input, "number") } };
    case "get_issue":
      return { action: GITHUB_OPERATION_ACTIONS[operation], args: { ...base, issue_number: positiveInteger(input, "number") } };
    case "list_issue_comments":
      return {
        action: GITHUB_OPERATION_ACTIONS[operation],
        args: {
          ...base,
          issue_number: positiveInteger(input, "number"),
          per_page: typeof input.per_page === "number" ? input.per_page : 100,
        },
      };
    case "create_issue":
      return {
        action: GITHUB_OPERATION_ACTIONS[operation],
        args: {
          ...base,
          title: requiredString(input, "title"),
          ...(optionalString(input, "body") ? { body: optionalString(input, "body") } : {}),
          ...(Array.isArray(input.labels) ? { labels: input.labels } : {}),
        },
      };
    case "comment_on_issue":
      return {
        action: GITHUB_OPERATION_ACTIONS[operation],
        args: { ...base, issue_number: positiveInteger(input, "number"), body: requiredString(input, "body") },
      };
    case "create_pull_request":
      return {
        action: GITHUB_OPERATION_ACTIONS[operation],
        args: {
          ...base,
          title: requiredString(input, "title"),
          head: requiredString(input, "head"),
          base: requiredString(input, "base"),
          ...(optionalString(input, "body") ? { body: optionalString(input, "body") } : {}),
          ...(typeof input.draft === "boolean" ? { draft: input.draft } : {}),
        },
      };
    case "write_file":
      return {
        action: GITHUB_OPERATION_ACTIONS[operation],
        args: {
          ...base,
          path: requiredString(input, "path"),
          content: rawString(input, "content"),
          message: requiredString(input, "message"),
          ...(optionalString(input, "branch") ? { branch: optionalString(input, "branch") } : {}),
          ...(optionalString(input, "sha") ? { sha: optionalString(input, "sha") } : {}),
        },
      };
  }
}

/** Executes a stable GitHub operation without exposing the raw action catalog to the model. */
export async function executeGithubOperation(
  ownerId: number,
  operation: GithubOperation,
  input: GithubOperationInput,
  fetchImpl: typeof fetch = fetch
): Promise<ComposioToolExecution> {
  const request = githubOperationRequest(operation, input);
  return executeComposioTool(ownerId, "github", request.action, request.args, fetchImpl);
}

/** Throws a clear ComposioApiError when the toolkit is not usable for this user. */
async function requireComposioConnection(ownerId: number, toolkit: ComposioToolkit, fetchImpl: typeof fetch) {
  if (!isComposioConfigured())
    throw new ComposioApiError(
      "Composio connectors are not configured on this Nova server. The owner must set COMPOSIO_API_KEY.",
      503
    );
  const status = await getComposioConnectionStatus(ownerId, toolkit, fetchImpl);
  if (!status.connected)
    throw new ComposioApiError(
      `${toolkitLabel(toolkit)} is not connected yet. The user must open Settings and connect ${toolkitLabel(toolkit)} first.`,
      428
    );
}
