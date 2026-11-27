import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  findOwnerByApiKey,
  WORKSPACE_API_KEY_PREFIX,
} from "./apiKeys";
import {
  createWorkspaceFileForUser,
  deleteWorkspaceFileForUser,
  getWorkspaceFileForUser,
  listWorkspaceFilesForUser,
  searchWorkspaceFilesForUser,
  updateWorkspaceFileForUser,
} from "./db/workspaceFiles";
import {
  listUserAutomations,
  getUserAutomation,
  createUserAutomation,
  updateUserAutomation,
  deleteUserAutomation,
  USER_AUTOMATION_CRONS,
} from "./userAutomations";
import { listSiteDeploymentRegistryForUser } from "./db/deployments";
import { deleteWorkspaceSite } from "./siteDeploy";
import {
  getTerminalStatusForUser,
  startTerminalForUser,
  readTerminalForUser,
  writeTerminalForUser,
  stopTerminalForUser,
  TerminalError,
} from "./terminal";

/**
 * The WORKSPACE API: managing the agent's computer over HTTP.
 *
 * Nova's existing API key drives the OpenAI-compatible inference API. This is
 * the other half: a key that lets a script drive the agent's own machine -
 * its files, its terminal, its automations and its deployments - without a
 * browser session.
 *
 * The two key types are SEPARATE. A workspace key is refused by the inference
 * API (it must not spend inference credits) and an inference key is refused
 * here (it must not touch the workspace). The scope check lives in
 * `findOwnerByApiKey`, so it applies to every route below without each one
 * having to remember it.
 *
 * Every handler resolves the OWNER from the key and then calls the same
 * owner-scoped functions the in-app tRPC routes use, so a key can never reach
 * another account's workspace.
 */

/** The error shape every route returns. */
type WorkspaceApiError = {
  error: { message: string; type: string; code: string };
};

function fail(
  res: Response,
  status: number,
  message: string,
  type: string,
  code: string
): void {
  res.status(status).json({ error: { message, type, code } } satisfies WorkspaceApiError);
}

/** Extracts a workspace key from the request, or null. */
export function readWorkspaceKeyFromRequest(headers: {
  authorization?: string;
  "x-api-key"?: string;
}): string | null {
  const authHeader = headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token.startsWith(WORKSPACE_API_KEY_PREFIX) ? token : null;
  }
  const headerKey = headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim().startsWith(WORKSPACE_API_KEY_PREFIX)) {
    return headerKey.trim();
  }
  return null;
}

/**
 * Resolves the workspace key to its owner, or writes the 401 and returns null.
 *
 * A missing key, a key of the wrong type, and a revoked key are all the same
 * answer to the caller: the request is not authorized. They are logged
 * differently, never differently answered.
 */
async function requireWorkspaceOwner(req: Request, res: Response): Promise<number | null> {
  const presentedKey = readWorkspaceKeyFromRequest(req.headers);
  if (!presentedKey) {
    fail(
      res,
      401,
      `Missing or invalid API key. Pass \`Authorization: Bearer ${WORKSPACE_API_KEY_PREFIX}...\` or \`x-api-key\`.`,
      "invalid_request_error",
      "invalid_api_key"
    );
    return null;
  }
  const ownerId = await findOwnerByApiKey(presentedKey, { scope: "workspace" });
  if (ownerId === null) {
    fail(
      res,
      401,
      "That API key has been revoked or no longer exists.",
      "invalid_request_error",
      "invalid_api_key"
    );
    return null;
  }
  return ownerId;
}

/** The request shapes, mirroring the in-app routes so both behave the same. */
const fileCreateInput = z.object({
  name: z.string().trim().min(1, "A file needs a name.").max(240),
  content: z.string().max(200000).optional(),
  mimeType: z.string().trim().min(1).max(120).optional(),
  folderId: z.number().int().positive().nullable().optional(),
});

const fileUpdateInput = z
  .object({
    id: z.number().int().positive(),
    name: z.string().trim().min(1).max(240).optional(),
    content: z.string().max(200000).optional(),
    folderId: z.number().int().positive().nullable().optional(),
  })
  .refine(value => value.name !== undefined || value.content !== undefined || value.folderId !== undefined, {
    message: "Provide at least one file change.",
  });

const searchInput = z.object({
  query: z.string().trim().min(1).max(200),
  regex: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/**
 * The automation frequencies the API accepts, kept in step with the module's
 * own cron table by the compile-time check below.
 */
const AUTOMATION_FREQUENCIES = ["hourly", "daily", "weekdays", "weekly", "custom"] as const;
// A missing or extra frequency here would make the API reject a schedule the
// app accepts (or accept one it cannot run), so the two must stay identical.
type _FrequencyCheck = Expect<
  Equal<keyof typeof USER_AUTOMATION_CRONS | "custom", (typeof AUTOMATION_FREQUENCIES)[number]>
>;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const automationCreateInput = z.object({
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(8000),
  frequency: z.enum(AUTOMATION_FREQUENCIES).default("daily"),
  scheduleCron: z.string().trim().min(1).max(64),
  scheduleTimezone: z.string().trim().min(1).max(80).default("UTC"),
  executionPrompt: z.string().trim().min(1).max(8000),
  args: z.record(z.string(), z.unknown()).default({}),
  definition: z.record(z.string(), z.unknown()).default({}),
});

/**
 * The cron expression a frequency maps to, so a key-created automation carries
 * the SAME schedule the app would give it rather than a free-form string that
 * could never be parsed.
 */
const AUTOMATION_CRON_BY_FREQUENCY: Record<(typeof AUTOMATION_FREQUENCIES)[number], string> = {
  ...USER_AUTOMATION_CRONS,
  custom: "0 0 9 * * *",
};

const automationUpdateInput = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  instructions: z.string().trim().min(1).max(8000).optional(),
  frequency: z.enum(AUTOMATION_FREQUENCIES).optional(),
});

const terminalWriteInput = z.object({ data: z.string().min(1).max(8192) });
const terminalReadInput = z.object({ sinceSeq: z.number().int().min(0).default(0) });

/** Parses a JSON body, answering with a 400 when it is not usable. */
function parseBody<T extends z.ZodTypeAny>(
  res: Response,
  raw: unknown,
  schema: T
): z.infer<T> | null {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    fail(
      res,
      400,
      parsed.error.issues[0]?.message ?? "That request body is not valid.",
      "invalid_request_error",
      "invalid_body"
    );
    return null;
  }
  return parsed.data;
}

/**
 * Wraps an async route handler so its failures reach the error middleware.
 *
 * Express 4 does not forward a rejected promise to the error handler, so an
 * async route that throws would leave the request hanging and surface as an
 * unhandled rejection instead of an answer.
 */
function handle(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: (err?: unknown) => void) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export const workspaceApiRouter = express.Router();

/** A read-only summary of what the key can reach. */
workspaceApiRouter.get("/me", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const [files, automations, deployments, terminal] = await Promise.all([
    listWorkspaceFilesForUser(ownerId),
    listUserAutomations(ownerId),
    listSiteDeploymentRegistryForUser(ownerId),
    Promise.resolve(getTerminalStatusForUser(ownerId)),
  ]);
  res.json({
    object: "workspace",
    file_count: files.length,
    automation_count: automations.length,
    deployment_count: deployments.length,
    terminal: terminal,
  });
}));

// --- Files -----------------------------------------------------------------

workspaceApiRouter.get("/files", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const files = await listWorkspaceFilesForUser(ownerId);
  res.json({ object: "list", data: files });
}));

// Registered before `/files/:id`: Express matches in order, so a later
// `:id` route would swallow the literal "search" segment.
workspaceApiRouter.get("/files/search", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const input = parseBody(res, req.query, searchInput);
  if (!input) return;
  const result = await searchWorkspaceFilesForUser(ownerId, input);
  if ("error" in result) {
    fail(res, 400, result.error, "invalid_request_error", "invalid_search");
    return;
  }
  res.json({ object: "list", data: result.matches });
}));

workspaceApiRouter.get("/files/:id", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, "That file id is not valid.", "invalid_request_error", "invalid_id");
    return;
  }
  const file = await getWorkspaceFileForUser(ownerId, id);
  if (!file) {
    fail(res, 404, "That file does not exist.", "not_found_error", "file_not_found");
    return;
  }
  res.json(file);
}));

workspaceApiRouter.post("/files", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const input = parseBody(res, req.body, fileCreateInput);
  if (!input) return;
  const file = await createWorkspaceFileForUser(ownerId, input);
  if (!file) {
    fail(res, 404, "That folder does not exist.", "not_found_error", "folder_not_found");
    return;
  }
  res.status(201).json(file);
}));

workspaceApiRouter.patch("/files/:id", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, "That file id is not valid.", "invalid_request_error", "invalid_id");
    return;
  }
  const body = parseBody(res, { ...(req.body ?? {}), id }, fileUpdateInput);
  if (!body) return;
  const file = await updateWorkspaceFileForUser(ownerId, id, body);
  if (!file) {
    fail(res, 404, "That file or destination folder does not exist.", "not_found_error", "file_not_found");
    return;
  }
  res.json(file);
}));

workspaceApiRouter.delete("/files/:id", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, "That file id is not valid.", "invalid_request_error", "invalid_id");
    return;
  }
  const deleted = await deleteWorkspaceFileForUser(ownerId, id);
  if (!deleted) {
    fail(res, 404, "That file does not exist.", "not_found_error", "file_not_found");
    return;
  }
  res.json({ deleted: true });
}));

// --- Automations -----------------------------------------------------------

workspaceApiRouter.get("/automations", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const automations = await listUserAutomations(ownerId);
  res.json({ object: "list", data: automations });
}));

workspaceApiRouter.post("/automations", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const input = parseBody(res, req.body, automationCreateInput);
  if (!input) return;
  // The cron comes from the frequency, so the automation carries the same
  // schedule the app would give it.
  const automation = await createUserAutomation(ownerId, {
    ...input,
    scheduleCron: AUTOMATION_CRON_BY_FREQUENCY[input.frequency] ?? input.scheduleCron,
  });
  res.status(201).json(automation);
}));

workspaceApiRouter.patch("/automations/:id", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, "That automation id is not valid.", "invalid_request_error", "invalid_id");
    return;
  }
  const body = parseBody(res, { ...(req.body ?? {}), id }, automationUpdateInput);
  if (!body) return;
  // Enabling an automation needs the background schedule to be created, and
  // that scheduling call is bound to the user's browser session - a key
  // carries no session. Refusing it is better than storing "enabled" on a
  // row whose schedule was never created, which would look scheduled and
  // never run.
  if ((req.body as { enabled?: unknown } | undefined)?.enabled !== undefined) {
    fail(
      res,
      400,
      "A workspace key cannot enable an automation: the background schedule is created from the app. Turn it on there.",
      "invalid_request_error",
      "schedule_requires_session"
    );
    return;
  }
  const existing = await getUserAutomation(ownerId, id);
  if (!existing) {
    fail(res, 404, "That automation does not exist.", "not_found_error", "automation_not_found");
    return;
  }
  const automation = await updateUserAutomation(ownerId, id, {
    ...body,
    scheduleCron:
      body.frequency !== undefined
        ? AUTOMATION_CRON_BY_FREQUENCY[body.frequency] ?? existing.scheduleCron
        : undefined,
  });
  if (!automation) {
    fail(res, 404, "That automation does not exist.", "not_found_error", "automation_not_found");
    return;
  }
  res.json(automation);
}));

workspaceApiRouter.delete("/automations/:id", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, "That automation id is not valid.", "invalid_request_error", "invalid_id");
    return;
  }
  const deleted = await deleteUserAutomation(ownerId, id);
  if (!deleted) {
    fail(res, 404, "That automation does not exist.", "not_found_error", "automation_not_found");
    return;
  }
  res.json({ deleted: true });
}));

// --- Deployments -----------------------------------------------------------

workspaceApiRouter.get("/deployments", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  // The registry, not the raw rows: each entry carries the deployment KEY
  // that DELETE /deployments/:key takes, plus its live URL.
  const deployments = await listSiteDeploymentRegistryForUser(ownerId);
  res.json({ object: "list", data: deployments });
}));

workspaceApiRouter.delete("/deployments/:key", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const key = String(req.params.key ?? "").trim();
  if (!key) {
    fail(res, 400, "That deployment id is not valid.", "invalid_request_error", "invalid_id");
    return;
  }
  // The real deletion path, so the live site actually goes down. Marking the
  // row deleted on its own would leave the site serving.
  const result = await deleteWorkspaceSite(ownerId, { deployment: key });
  if (!result.ok) {
    fail(res, 400, result.message, "invalid_request_error", "deployment_delete_failed");
    return;
  }
  res.json({ deleted: result.deleted.map(target => target.key), failed: result.failed });
}));

// --- Terminal --------------------------------------------------------------

workspaceApiRouter.get("/terminal", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  res.json(getTerminalStatusForUser(ownerId));
}));

workspaceApiRouter.post("/terminal/start", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const input = parseBody(
    res,
    req.body,
    z.object({
      cols: z.number().int().min(20).max(500).default(120),
      rows: z.number().int().min(5).max(200).default(30),
    })
  );
  if (!input) return;
  const status = await startTerminalForUser(ownerId, { cols: input.cols, rows: input.rows });
  res.json(status);
}));

workspaceApiRouter.get("/terminal/output", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const sinceSeq = Number(req.query.sinceSeq ?? 0);
  const input = parseBody(res, { sinceSeq: Number.isFinite(sinceSeq) ? sinceSeq : 0 }, terminalReadInput);
  if (!input) return;
  res.json(readTerminalForUser(ownerId, input.sinceSeq));
}));

workspaceApiRouter.post("/terminal/input", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  const input = parseBody(res, req.body, terminalWriteInput);
  if (!input) return;
  await writeTerminalForUser(ownerId, input.data);
  res.json({ written: true });
}));

workspaceApiRouter.post("/terminal/stop", handle(async (req: Request, res: Response) => {
  const ownerId = await requireWorkspaceOwner(req, res);
  if (ownerId === null) return;
  // The helper reports whether a session was actually closed, so the answer
  // must say so rather than always claiming success.
  const result = await stopTerminalForUser(ownerId);
  res.json({ stopped: result.success });
}));

/**
 * The router's error handler.
 *
 * A workspace route can fail for reasons the caller should see as an answer,
 * not as a stack trace: the terminal is not open yet, the sandbox cannot be
 * reached, the request lost a race with another writer. Those become JSON
 * with a real status, so an API client never has to parse an HTML error page.
 */
workspaceApiRouter.use(
  (
    error: unknown,
    _req: Request,
    res: Response,
    next: (err?: unknown) => void
  ) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof TerminalError) {
      const status = error.kind === "precondition" ? 409 : 400;
      fail(res, status, error.message, "invalid_request_error", "terminal_error");
      return;
    }
    console.error("[Workspace API] request failed", error);
    fail(
      res,
      500,
      "Nova could not complete that workspace request. Please retry shortly.",
      "server_error",
      "internal_error"
    );
  }
);
