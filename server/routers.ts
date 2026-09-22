import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import {
  createChatForUser,
  createProjectForUser,
  deleteUserAccount,
  createTaskForUser,
  createCustomModelForUser,
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  isUsernameTaken,
  setUsernameForUser,
  deleteCustomModelForUser,
  deleteProjectForUser,
  deleteTaskForUser,
  deleteWorkspaceFileForUser,
  deleteWorkspaceFolderForUser,
  getProjectForUser,
  getChatForUser,
  getOrCreateWorkspace,
  getAutomationRecordForUser,
  getActiveAgentRunForChat,
  getWorkspaceComputer,
  getWorkspaceModelSettingsForUser,
  getWorkspaceDashboard,
  listChatMessagesForUser,
  listProjectsForUser,
  listTasksForUser,
  updateTaskStatusForUser,
  updateProjectForUser,
  updateWorkspaceFileForUser,
  updateWorkspaceFolderForUser,
  updateWorkspaceModelSettingsForUser,
  deleteTelegramSettingsForUser,
  getTelegramCredentialsForUser,
  getTelegramSettingsForUser,
  saveTelegramSettingsForUser,
  updateTelegramChatForUser,
  listAutomationsForUser,
  listAutomationRunsForUser,
  setAutomationScheduleTaskForUser,
  updateAutomationForUser, factoryResetWorkspaceForUser } from "./db";
import { cancelAgentVmRun, getAgentVmStatus, listAgentVmRuns, startAgentVmRun } from "./agentVm";
import { getTerminalStatusForUser, readTerminalForUser, resizeTerminalForUser, startTerminalForUser, stopTerminalForUser, writeTerminalForUser, TerminalError } from "./terminal";
import { getDeploymentStatusForUser } from "./siteDeploy";
import { WORKSPACE_DIGEST_CRON, runDueAutomationsForUser } from "./automations";
import { createHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { getSessionCookieOptions, sessionToken } from "./_core/cookies";
import { completeWithMistralGateway, getMistralGatewayStatus, listMistralModels, MistralGatewayClientError } from "./mistralGateway";
import { testCustomModelEndpoint } from "./byokGateway";
import { autoTitleChatForUser } from "./workspaceAgent";
import { executeWebAgentRun } from "./agentRuns";
import { COMPOSIO_TOOLKITS, ComposioApiError, createComposioConnectionLink, deleteComposioConnection, getComposioConnectionStatus, isComposioToolkit, listComposioTools } from "./composio";
import { configureTelegramWebhook, discoverTelegramChat, sendTelegramMessage, validateTelegramBotToken } from "./telegram";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { adminRouter } from "./adminRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

function throwIfNotFound<T>(result: T, entity: string): asserts result is NonNullable<T> {
  if (!result) throw new TRPCError({ code: "NOT_FOUND", message: `That ${entity} is not available in your Nova space.` });
}
const projectInput = z.object({ name: z.string().trim().min(1, "A project needs a name.").max(160), description: z.string().trim().max(2000).nullable().optional() });
const taskStatus = z.enum(["todo", "in_progress", "done"]);
const projectStatus = z.enum(["active", "archived"]);
const modelProvider = z.enum(["anthropic", "openai", "gemini", "custom", "mistral"]);
const modelCompatibility = z.enum(["openai", "anthropic"]);
const projectUpdateInput = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(160).optional(), description: z.string().trim().max(2000).nullable().optional(), status: projectStatus.optional() }).refine(input => input.name !== undefined || input.description !== undefined || input.status !== undefined, { message: "Provide at least one project change." });
const customModelInput = z.object({ name: z.string().trim().min(1, "Give the model a name.").max(120), modelId: z.string().trim().min(1, "A model ID is required.").max(240), baseUrl: z.string().trim().url("Enter a complete HTTPS endpoint URL.").max(2048), compatibility: modelCompatibility, apiKey: z.string().trim().min(1, "An API key is required.").max(4096), supportsImageInput: z.boolean() });
const workspaceSettingsInput = z.object({ activeProvider: modelProvider.optional(), activeModelId: z.string().trim().min(1).max(240).optional(), activeCustomModelId: z.number().int().positive().nullable().optional(), workspaceRules: z.string().trim().max(8000).nullable().optional() }).refine(input => input.activeProvider !== undefined || input.activeModelId !== undefined || input.activeCustomModelId !== undefined || input.workspaceRules !== undefined, { message: "Provide at least one setting change." });
const folderInput = z.object({ name: z.string().trim().min(1, "A folder needs a name.").max(160), parentId: z.number().int().positive().nullable().optional() });
const folderUpdateInput = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(160).optional(), parentId: z.number().int().positive().nullable().optional() }).refine(input => input.name !== undefined || input.parentId !== undefined, { message: "Provide a folder change." });
const fileInput = z.object({ name: z.string().trim().min(1, "A file needs a name.").max(240), content: z.string().max(200000).optional(), mimeType: z.string().trim().min(1).max(120).optional(), folderId: z.number().int().positive().nullable().optional() });
const fileUpdateInput = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(240).optional(), content: z.string().max(200000).optional(), folderId: z.number().int().positive().nullable().optional() }).refine(input => input.name !== undefined || input.content !== undefined || input.folderId !== undefined, { message: "Provide at least one file change." });
const agentVmRunInput = z.object({ task: z.string().trim().min(3, "Describe the VM task.").max(1600), code: z.string().max(12000).optional() });
const terminalSizeInput = z.object({ cols: z.number().int().min(20).max(500), rows: z.number().int().min(5).max(200) });
/** Only classified TerminalError messages reach the client; anything else is
 *  unexpected (E2B/network internals) and gets a fixed generic message. */
const terminalRouteError = (error: unknown, fallback: string) => {
  if (error instanceof TerminalError) {
    return new TRPCError({ code: error.kind === "precondition" ? "PRECONDITION_FAILED" : "BAD_REQUEST", message: error.message });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: fallback });
};
const mistralCompletionInput = z.object({ prompt: z.string().trim().min(3, "Describe what you want Mistral to help with.").max(12000), modelId: z.string().trim().min(1).max(240).optional() });

export const appRouter = router({
  system: systemRouter,
  admin: adminRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { ctx.res.clearCookie(COOKIE_NAME, getSessionCookieOptions(ctx.req)); return { success: true }; }),
    deleteAccount: protectedProcedure.mutation(async ({ ctx }) => { const success = await deleteUserAccount(ctx.user.id); if (!success) throw new TRPCError({ code: "NOT_FOUND", message: "Account deletion could not be completed." }); return { success }; }),
    /** Claim the app-wide username the agent and other surfaces know you by. */
    setUsername: protectedProcedure
      .input(z.object({
        username: z.string().trim().toLowerCase()
          .min(3, "Usernames are 3-24 characters.")
          .max(24, "Usernames are 3-24 characters.")
          .regex(/^[a-z0-9_-]+$/, "Use lowercase letters, numbers, hyphens or underscores."),
      }))
      .mutation(async ({ ctx, input }) => {
        if (await isUsernameTaken(input.username)) {
          throw new TRPCError({ code: "CONFLICT", message: "That username is already taken - try another." });
        }
        try {
          const updated = await setUsernameForUser(ctx.user.id, input.username);
          if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Account is no longer available." });
          return updated;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          // Two simultaneous claims can race past the pre-check onto the unique index.
          throw new TRPCError({ code: "CONFLICT", message: "That username is already taken - try another." });
        }
      }),
  }),
  workspace: router({
    dashboard: protectedProcedure.query(({ ctx }) => getWorkspaceDashboard(ctx.user.id)),
    computer: protectedProcedure.query(({ ctx }) => getWorkspaceComputer(ctx.user.id)),
    current: protectedProcedure.query(({ ctx }) => getOrCreateWorkspace(ctx.user.id)),
    modelSettings: protectedProcedure.query(({ ctx }) => getWorkspaceModelSettingsForUser(ctx.user.id)),
    updateSettings: protectedProcedure.input(workspaceSettingsInput).mutation(async ({ ctx, input }) => {
      if (input.activeProvider !== undefined || input.activeModelId !== undefined) {
        try {
          const current = await getWorkspaceModelSettingsForUser(ctx.user.id);
          const provider = input.activeProvider ?? current.activeProvider;
          const modelId = input.activeModelId ?? current.activeModelId;
          if (provider === "mistral") {
            const models = await listMistralModels(true);
            if (!models.some(model => model.id === modelId)) throw new TRPCError({ code: "BAD_REQUEST", message: "That Mistral text or vision model is not currently available." });
          }
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          if (error instanceof MistralGatewayClientError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
          throw error;
        }
      }
      const settings = await updateWorkspaceModelSettingsForUser(ctx.user.id, input);
      if (!settings) throwIfNotFound(settings, "custom model");
      return settings;
    }),
    /** Factory reset: deletes every workspace file and folder and replaces
     *  the persistent VM with a fresh machine. Guarded by a typed confirm. */
    factoryReset: protectedProcedure.input(z.object({ confirm: z.string().trim().min(1, "Type RESET to confirm.") })).mutation(async ({ ctx, input }) => {
      if (input.confirm !== "RESET") throw new TRPCError({ code: "BAD_REQUEST", message: "Type RESET to confirm the factory reset." });
      return factoryResetWorkspaceForUser(ctx.user.id);
    }),
  }),
  composio: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      const keyLength = ENV.composioApiKey?.length ?? 0;
      const entries = await Promise.all(COMPOSIO_TOOLKITS.map(async toolkit => {
        try {
          return [toolkit, await getComposioConnectionStatus(ctx.user.id, toolkit)] as const;
        } catch (error) {
          // Composio rejected the request (bad key, network, etc.) - surface that
          // instead of letting the client render "key missing" for a key that exists.
          return [toolkit, { configured: keyLength > 0, connected: false, status: "error", connectedAccountId: null, error: error instanceof Error ? error.message : "Composio request failed" }] as const;
        }
      }));
      return { keyLength, toolkits: Object.fromEntries(entries) };
    }),
    connect: protectedProcedure.input(z.object({ toolkit: z.enum(COMPOSIO_TOOLKITS) })).mutation(({ ctx, input }) => {
      const callbackUrl = ENV.publicBaseUrl ? `${ENV.publicBaseUrl.replace(/\/$/, "")}/app/settings?connected=${input.toolkit}` : undefined;
      return createComposioConnectionLink(ctx.user.id, input.toolkit, { callbackUrl }).catch(error => {
        if (error instanceof ComposioApiError) {
          const code = error.status === 503 ? "PRECONDITION_FAILED" : error.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
          throw new TRPCError({ code, message: error.message });
        }
        throw error;
      });
    }),
    disconnect: protectedProcedure.input(z.object({ toolkit: z.enum(COMPOSIO_TOOLKITS) })).mutation(({ ctx, input }) =>
      deleteComposioConnection(ctx.user.id, input.toolkit).catch(error => {
        if (error instanceof ComposioApiError) {
          const code = error.status === 503 ? "PRECONDITION_FAILED" : error.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
          throw new TRPCError({ code, message: error.message });
        }
        throw error;
      })
    ),
    tools: protectedProcedure.input(z.object({ toolkit: z.enum(COMPOSIO_TOOLKITS), search: z.string().trim().max(120).optional(), limit: z.number().int().min(1).max(50).optional() }).optional()).query(({ ctx, input }) => {
      const toolkit = isComposioToolkit(input?.toolkit) ? input.toolkit : "github";
      return listComposioTools(ctx.user.id, toolkit, { search: input?.search, limit: input?.limit }).catch(error => {
        if (error instanceof ComposioApiError) {
          const code = error.status === 503 || error.status === 428 ? "PRECONDITION_FAILED" : "INTERNAL_SERVER_ERROR";
          throw new TRPCError({ code, message: error.message });
        }
        throw error;
      })
    }),
  }),
  telegram: router({
    status: protectedProcedure.query(({ ctx }) => getTelegramSettingsForUser(ctx.user.id)),
    configure: protectedProcedure.input(z.object({ chatId: z.string().trim().min(1).max(64).nullable().optional() })).mutation(async ({ ctx, input }) => { const token = ENV.defaultTelegramBotToken || process.env.TELEGRAM_BOT_TOKEN || ""; if (!token) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Server bot not configured. Set DEFAULT_TELEGRAM_BOT_TOKEN." }); const bot = await validateTelegramBotToken(token); const creds = await getTelegramCredentialsForUser(ctx.user.id); const saved = await saveTelegramSettingsForUser(ctx.user.id, { botToken: token, chatId: input.chatId ?? creds?.chatId ?? null, botUsername: bot.username, botDisplayName: bot.displayName }); const webhookBaseUrl = ENV.publicBaseUrl || (ctx.req?.headers?.host ? `https://${ctx.req.headers.host}` : ""); if (webhookBaseUrl) { try { await configureTelegramWebhook(token, webhookBaseUrl); } catch {} } return saved; }),
    discoverChat: protectedProcedure.mutation(async ({ ctx }) => { const credentials = await getTelegramCredentialsForUser(ctx.user.id); if (!credentials) throw new TRPCError({ code: "NOT_FOUND", message: "Add and validate a Telegram bot token first." }); const webhookBaseUrl = ENV.publicBaseUrl || (ctx.req?.headers?.host ? `https://${ctx.req.headers.host}` : ""); const restoreWebhook = async () => { if (webhookBaseUrl) { try { await configureTelegramWebhook(credentials.token, webhookBaseUrl); } catch {} } }; let chatId: string; try { chatId = await discoverTelegramChat(credentials.token); } catch (error) { await restoreWebhook(); throw error; } const saved = await updateTelegramChatForUser(ctx.user.id, chatId); await restoreWebhook(); return saved; }),
    sendTest: protectedProcedure.input(z.object({ text: z.string().trim().min(1).max(4096).default("Nova is connected to your Telegram bot.") })).mutation(async ({ ctx, input }) => { const credentials = await getTelegramCredentialsForUser(ctx.user.id); if (!credentials?.chatId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Send /start to your bot in Telegram, then discover its chat before sending a message." }); const sent = await sendTelegramMessage(credentials.token, credentials.chatId, input.text); return { success: true as const, messageId: sent.message_id }; }),
    remove: protectedProcedure.mutation(async ({ ctx }) => { const deleted = await deleteTelegramSettingsForUser(ctx.user.id); return { success: deleted } as const; }),
  }),
  mistral: router({ models: protectedProcedure.input(z.object({ forceRefresh: z.boolean().optional() }).optional()).query(async ({ input }) => { try { return await listMistralModels(input?.forceRefresh); } catch (error) { if (error instanceof MistralGatewayClientError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message }); throw error; } }), status: protectedProcedure.query(({ ctx }) => getMistralGatewayStatus(ctx.user.id)), complete: protectedProcedure.input(mistralCompletionInput).mutation(async ({ ctx, input }) => { try { return await completeWithMistralGateway(ctx.user.id, input.prompt, input.modelId); } catch (error) { if (error instanceof MistralGatewayClientError) { const code = error.kind === "configuration" ? "PRECONDITION_FAILED" : ["rate_limit", "allowance_reached"].includes(error.kind) ? "TOO_MANY_REQUESTS" : error.kind === "client_error" ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR"; throw new TRPCError({ code, message: error.message }); } throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Mistral inference is temporarily unavailable. Please retry shortly." }); } }) }),
  deployments: router({
    /** Live website deployments: configuration, the current live site, and recent history. Publishing itself is AI-only - the deploy_website agent tool is the single path to a deploy, so there is no deploy mutation here. */
    status: protectedProcedure.query(({ ctx }) => getDeploymentStatusForUser(ctx.user.id)),
  }),
  terminal: router({
    /** Direct shell access to the workspace's persistent agent VM. */
    status: protectedProcedure.query(({ ctx }) => getTerminalStatusForUser(ctx.user.id)),
    start: protectedProcedure.input(terminalSizeInput).mutation(async ({ ctx, input }) => { try { return await startTerminalForUser(ctx.user.id, input); } catch (error) { throw terminalRouteError(error, "Nova could not open the terminal."); } }),
    read: protectedProcedure.input(z.object({ sinceSeq: z.number().int().min(0).default(0) })).query(({ ctx, input }) => readTerminalForUser(ctx.user.id, input.sinceSeq)),
    write: protectedProcedure.input(z.object({ data: z.string().min(1).max(8192) })).mutation(async ({ ctx, input }) => { try { await writeTerminalForUser(ctx.user.id, input.data); return { written: true as const }; } catch (error) { throw terminalRouteError(error, "Nova could not send that input."); } }),
    resize: protectedProcedure.input(terminalSizeInput).mutation(async ({ ctx, input }) => { try { return await resizeTerminalForUser(ctx.user.id, input); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not resize the terminal." }); } }),
    stop: protectedProcedure.mutation(async ({ ctx }) => { try { return await stopTerminalForUser(ctx.user.id); } catch (error) { throw terminalRouteError(error, "Nova could not close the terminal."); } }),
  }),
  agentVm: router({
    status: protectedProcedure.query(({ ctx }) => getAgentVmStatus(ctx.user.id)), list: protectedProcedure.query(({ ctx }) => listAgentVmRuns(ctx.user.id)),
    start: protectedProcedure.input(agentVmRunInput).mutation(async ({ ctx, input }) => { try { return await startAgentVmRun(ctx.user.id, input); } catch (error) { const message = error instanceof Error ? error.message : "Nova could not start that agent VM run."; const code = /active agent VM run/i.test(message) ? "PRECONDITION_FAILED" : /blocked|limits/i.test(message) ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR"; throw new TRPCError({ code, message }); } }),
    cancel: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const run = await cancelAgentVmRun(ctx.user.id, input.id); if (!run) throwIfNotFound(run, "active agent VM run"); return run; }),
  }),
  automations: router({
    list: protectedProcedure.query(({ ctx }) => listAutomationsForUser(ctx.user.id)), runs: protectedProcedure.input(z.object({ automationId: z.number().int().positive() })).query(({ ctx, input }) => listAutomationRunsForUser(ctx.user.id, input.automationId)),
    update: protectedProcedure.input(z.object({ id: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => { const existing = await getAutomationRecordForUser(ctx.user.id, input.id); if (!existing) throwIfNotFound(existing, "automation"); const token = sessionToken(ctx.req); if (!token) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your Nova session is not ready to save a background schedule. Refresh the page and try again." }); if (input.enabled) { if (existing.scheduleCronTaskUid) await updateHeartbeatJob(existing.scheduleCronTaskUid, { cron: WORKSPACE_DIGEST_CRON, path: "/api/scheduled/automation", method: "POST", enable: true }, token); else { const scheduled = await createHeartbeatJob({ name: `nova-automation-${existing.id}`, cron: WORKSPACE_DIGEST_CRON, path: "/api/scheduled/automation", method: "POST", description: "Daily private Nova workspace briefing" }, token); await setAutomationScheduleTaskForUser(ctx.user.id, existing.id, scheduled.taskUid); } } else if (existing.scheduleCronTaskUid) await updateHeartbeatJob(existing.scheduleCronTaskUid, { enable: false }, token); const automation = await updateAutomationForUser(ctx.user.id, input.id, { enabled: input.enabled }); if (!automation) throwIfNotFound(automation, "automation"); return automation; }),
    runDue: protectedProcedure.mutation(async ({ ctx }) => { try { return await runDueAutomationsForUser(ctx.user.id); } catch (error) { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Nova could not run the saved automation." }); } }),
  }),
  folders: router({ create: protectedProcedure.input(folderInput).mutation(async ({ ctx, input }) => { const folder = await createWorkspaceFolderForUser(ctx.user.id, input); if (!folder) throwIfNotFound(folder, "parent folder"); return folder; }), update: protectedProcedure.input(folderUpdateInput).mutation(async ({ ctx, input }) => { const folder = await updateWorkspaceFolderForUser(ctx.user.id, input.id, input); if (!folder) throwIfNotFound(folder, "folder"); return folder; }), delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const deleted = await deleteWorkspaceFolderForUser(ctx.user.id, input.id); if (!deleted) throwIfNotFound(deleted, "folder"); return { success: true } as const; }) }),
  files: router({ create: protectedProcedure.input(fileInput).mutation(async ({ ctx, input }) => { const file = await createWorkspaceFileForUser(ctx.user.id, input); if (!file) throwIfNotFound(file, "folder"); return file; }), update: protectedProcedure.input(fileUpdateInput).mutation(async ({ ctx, input }) => { const file = await updateWorkspaceFileForUser(ctx.user.id, input.id, input); if (!file) throwIfNotFound(file, "file or destination folder"); return file; }), delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const deleted = await deleteWorkspaceFileForUser(ctx.user.id, input.id); if (!deleted) throwIfNotFound(deleted, "file"); return { success: true } as const; }) }),
  chats: router({
    create: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(160) })).mutation(async ({ ctx, input }) => { const chat = await createChatForUser(ctx.user.id, input.title); if (!chat) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not create that conversation." }); return chat; }),
    messages: protectedProcedure.input(z.object({ chatId: z.number().int().positive() })).query(async ({ ctx, input }) => { const messages = await listChatMessagesForUser(ctx.user.id, input.chatId); if (!messages) throwIfNotFound(messages, "conversation"); return messages; }),
    runStatus: protectedProcedure.input(z.object({ chatId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const chat = await getChatForUser(ctx.user.id, input.chatId);
      if (!chat) throwIfNotFound(chat, "conversation");
      const run = await getActiveAgentRunForChat(ctx.user.id, input.chatId);
      return run ? { active: true as const, ...run } : { active: false as const };
    }),
    send: protectedProcedure.input(z.object({ chatId: z.number().int().positive().nullable().optional(), content: z.string().trim().min(1).max(12000) })).mutation(async ({ ctx, input }) => { const chat = input.chatId ? undefined : await createChatForUser(ctx.user.id, "New conversation"); const chatId = input.chatId ?? chat?.id; if (!chatId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not start that conversation." }); const result = await executeWebAgentRun({ ownerId: ctx.user.id, chatId, content: input.content, requestStartedAtMs: Date.now() }); void autoTitleChatForUser(ctx.user.id, chatId).catch(() => {}); return { chatId, ...(await result) }; }),
  }),
  models: router({ createCustom: protectedProcedure.input(customModelInput).mutation(({ ctx, input }) => createCustomModelForUser(ctx.user.id, input)), deleteCustom: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const deleted = await deleteCustomModelForUser(ctx.user.id, input.id); if (!deleted) throwIfNotFound(deleted, "custom model"); return { success: true } as const; }), /** Tests a candidate BYOK endpoint (base URL + key + model ID) without saving it. */ testCustom: protectedProcedure.input(z.object({ baseUrl: z.string().trim().url("Enter a complete HTTPS endpoint URL.").max(2048), apiKey: z.string().trim().min(1, "An API key is required.").max(4096), modelId: z.string().trim().min(1, "A model ID is required.").max(240) })).mutation(async ({ input }) => { try { return await testCustomModelEndpoint(input); } catch (error) { if (error instanceof MistralGatewayClientError) { const code = error.kind === "configuration" ? "PRECONDITION_FAILED" : error.kind === "rate_limit" ? "TOO_MANY_REQUESTS" : error.kind === "client_error" ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR"; throw new TRPCError({ code, message: error.message }); } throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The provider endpoint could not be reached." }); } }) }),
  projects: router({ list: protectedProcedure.query(({ ctx }) => listProjectsForUser(ctx.user.id)), get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => { const project = await getProjectForUser(ctx.user.id, input.id); if (!project) throwIfNotFound(project, "project"); return project; }), create: protectedProcedure.input(projectInput).mutation(async ({ ctx, input }) => { const project = await createProjectForUser(ctx.user.id, input); if (!project) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not create that project." }); return project; }), update: protectedProcedure.input(projectUpdateInput).mutation(async ({ ctx, input }) => { const project = await updateProjectForUser(ctx.user.id, input.id, input); if (!project) throwIfNotFound(project, "project"); return project; }), delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const deleted = await deleteProjectForUser(ctx.user.id, input.id); if (!deleted) throwIfNotFound(deleted, "project"); return { success: true } as const; }) }),
  tasks: router({ list: protectedProcedure.query(({ ctx }) => listTasksForUser(ctx.user.id)), create: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), title: z.string().trim().min(1, "A task needs a title.").max(240), notes: z.string().trim().max(4000).nullable().optional(), dueAt: z.date().nullable().optional() })).mutation(async ({ ctx, input }) => { const task = await createTaskForUser(ctx.user.id, input); if (!task) throwIfNotFound(task, "project"); return task; }), updateStatus: protectedProcedure.input(z.object({ id: z.number().int().positive(), status: taskStatus })).mutation(async ({ ctx, input }) => { const task = await updateTaskStatusForUser(ctx.user.id, input.id, input.status); if (!task) throwIfNotFound(task, "task"); return task; }), delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const deleted = await deleteTaskForUser(ctx.user.id, input.id); if (!deleted) throwIfNotFound(deleted, "task"); return { success: true } as const; }) }),
});
export type AppRouter = typeof appRouter;
