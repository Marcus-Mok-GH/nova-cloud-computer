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
  getDailyCreditStatusForUser,
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
  updateAutomationForUser, factoryResetWorkspaceForUser,
  enqueueInferenceQueueItem,
  getInferenceQueuePosition,
  cancelWaitingInferenceQueueItemsForUser,
  getPriorityStatusForUser,
  purchasePriorityForUser,
  activatePriorityWindowForUser } from "./db";
import { priorityActiveMessage, queuePositionMessage, shouldQueue } from "./peakQueue";
import { kickPeakQueue } from "./peakQueueScheduler";
import { cancelAgentVmRun, getAgentVmStatus, listAgentVmRuns, startAgentVmRun } from "./agentVm";
import { sendAccountDeletionOtp, verifyAccountDeletionOtp } from "./accountDeletion";
import { ApiKeyLimitError, ApiKeyStorageError, createApiKeyForUser, listApiKeysForUser, renameApiKeyForUser, revokeApiKeyForUser } from "./apiKeys";
import { cancelActiveAgentVmRunsForUser, requestAgentStopForUser } from "./db";
import { getTerminalStatusForUser, readTerminalForUser, resizeTerminalForUser, startTerminalForUser, stopTerminalForUser, writeTerminalForUser, TerminalError } from "./terminal";
import { deleteWorkspaceSite, getDeploymentStatusForUser } from "./siteDeploy";
import { WORKSPACE_DIGEST_CRON, runDueAutomationsForUser } from "./automations";
import { createHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { getSessionCookieOptions, sessionToken } from "./_core/cookies";
import { completeWithAiGateway, getAiGatewayStatus, listGatewayModels, AiGatewayClientError } from "./aiGateway";
import { testCustomModelEndpoint } from "./byokGateway";
import { autoTitleChatForUser } from "./workspaceAgent";
import {
  AgentNameTakenError,
  createAgentForUser,
  createTeamChatForUser,
  decideApprovalForUser,
  deleteAgentForUser,
  listAgentChatsForUser,
  listAgentEmailsForUser,
  listAgentsForUser,
  listApprovalsForUser,
  startAgentChatForUser,
  updateAgentForUser,
} from "./agents";
import { executeWebAgentRun } from "./agentRuns";
import { clearMemoriesForUser } from "./memories";
import { COMPOSIO_TOOLKITS, ComposioApiError, createComposioConnectionLink, deleteComposioConnection, getComposioConnectionStatus, isComposioToolkit, listComposioTools } from "./composio";
import { configureTelegramWebhook, discoverTelegramChat, sendTelegramMessage, validateTelegramBotToken } from "./telegram";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { adminRouter } from "./adminRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

function throwIfNotFound<T>(result: T, entity: string): asserts result is NonNullable<T> {
  if (!result) throw new TRPCError({ code: "NOT_FOUND", message: `That ${entity} is not available in your Nova space.` });
}
/**
 * Refinement for an update payload that has to change something: at least one
 * of `keys` must be present (an explicit null counts), so an empty body cannot
 * be mistaken for a no-op. The message stays at each call site.
 */
const atLeastOneOf = (keys: readonly string[]) => (input: object) =>
  keys.some(key => (input as Record<string, unknown>)[key] !== undefined);
const projectInput = z.object({ name: z.string().trim().min(1, "A project needs a name.").max(160), description: z.string().trim().max(2000).nullable().optional() });
const taskStatus = z.enum(["todo", "in_progress", "done"]);
const projectStatus = z.enum(["active", "archived"]);
// "mistral" is the legacy stored identifier for Nova's built-in gateway; it
// must match the `model_provider` enum value persisted in the database.
const modelProvider = z.enum(["anthropic", "openai", "gemini", "custom", "mistral"]);
const modelCompatibility = z.enum(["openai", "anthropic"]);
const projectUpdateInput = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(160).optional(), description: z.string().trim().max(2000).nullable().optional(), status: projectStatus.optional() }).refine(atLeastOneOf(["name", "description", "status"]), { message: "Provide at least one project change." });
const customModelInput = z.object({ name: z.string().trim().min(1, "Give the model a name.").max(120), modelId: z.string().trim().min(1, "A model ID is required.").max(240), baseUrl: z.string().trim().url("Enter a complete HTTPS endpoint URL.").max(2048), compatibility: modelCompatibility, apiKey: z.string().trim().min(1, "An API key is required.").max(4096), supportsImageInput: z.boolean() });
const personalisationDetail = z.enum(["brief", "balanced", "detailed"]);
const personalisationProactiveness = z.enum(["ask_first", "act_and_tell", "autonomous"]);
const personalisationExpertise = z.enum(["new", "some", "expert"]);
const workspaceSettingsInput = z.object({ activeProvider: modelProvider.optional(), activeModelId: z.string().trim().min(1).max(240).optional(), activeCustomModelId: z.number().int().positive().nullable().optional(), workspaceRules: z.string().trim().max(8000).nullable().optional(), personalisationEnabled: z.boolean().optional(), personalisationProfile: z.string().trim().max(2000).nullable().optional(), personalisationTone: z.string().trim().max(60).nullable().optional(), personalisationDetail: personalisationDetail.nullable().optional(), personalisationProactiveness: personalisationProactiveness.nullable().optional(), personalisationExpertise: personalisationExpertise.nullable().optional() }).refine(atLeastOneOf(["activeProvider", "activeModelId", "activeCustomModelId", "workspaceRules", "personalisationEnabled", "personalisationProfile", "personalisationTone", "personalisationDetail", "personalisationProactiveness", "personalisationExpertise"]), { message: "Provide at least one setting change." });
const folderInput = z.object({ name: z.string().trim().min(1, "A folder needs a name.").max(160), parentId: z.number().int().positive().nullable().optional() });
const folderUpdateInput = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(160).optional(), parentId: z.number().int().positive().nullable().optional() }).refine(atLeastOneOf(["name", "parentId"]), { message: "Provide a folder change." });
const fileInput = z.object({ name: z.string().trim().min(1, "A file needs a name.").max(240), content: z.string().max(200000).optional(), mimeType: z.string().trim().min(1).max(120).optional(), folderId: z.number().int().positive().nullable().optional() });
const fileUpdateInput = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(240).optional(), content: z.string().max(200000).optional(), folderId: z.number().int().positive().nullable().optional() }).refine(atLeastOneOf(["name", "content", "folderId"]), { message: "Provide at least one file change." });
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
const gatewayCompletionInput = z.object({ prompt: z.string().trim().min(3, "Describe what you want Nova to help with.").max(12000), modelId: z.string().trim().min(1).max(240).optional() });
const agentName = z.string().trim().min(1, "An agent needs a name.").max(80, "Names are at most 80 characters.");
/** `walletBudgetCredits: null` grants an unlimited wallet (no cap). */
const agentBudgetCredits = z.number().int().min(0).max(100000).nullable().optional();
const agentCreateInput = z.object({ name: agentName, role: z.string().trim().max(120).nullable().optional(), instructions: z.string().trim().max(4000).nullable().optional(), walletBudgetCredits: agentBudgetCredits });
const agentUpdateInput = z.object({ id: z.number().int().positive(), name: agentName.optional(), role: z.string().trim().max(120).nullable().optional(), instructions: z.string().trim().max(4000).nullable().optional(), walletBudgetCredits: agentBudgetCredits }).refine(atLeastOneOf(["name", "role", "instructions", "walletBudgetCredits"]), { message: "Provide at least one agent change." });
const teamCreateInput = z.object({ name: z.string().trim().min(1, "A team needs a name.").max(160), goal: z.string().trim().min(1, "A team needs a shared goal.").max(2000), agentIds: z.array(z.number().int().positive()).min(2, "A team needs at least two agents.").max(8) });
/** Agent mutations surface their two typed failures as proper TRPC errors. */
const agentRouteError = (error: unknown, fallback: string): never => {
  if (error instanceof AgentNameTakenError) throw new TRPCError({ code: "CONFLICT", message: error.message });
  console.warn("[Agents] mutation failed:", error instanceof Error ? error.message : error);
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: fallback });
};

export const appRouter = router({
  system: systemRouter,
  admin: adminRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    /** Lets the sign-in page tell a banned account apart from a broken deployment. */
    banStatus: publicProcedure.query(opts => ({ banned: opts.ctx.banned })),
    logout: publicProcedure.mutation(({ ctx }) => { ctx.res.clearCookie(COOKIE_NAME, getSessionCookieOptions(ctx.req)); return { success: true }; }),
    /** Step 1 of account deletion: emails an OTP to the account address via
     *  Neon Auth so only the mailbox owner can confirm deletion. */
    requestDeletionCode: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ctx.user.email) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account has no email address, so a deletion code cannot be sent." });
      try {
        await sendAccountDeletionOtp(ctx.user.email);
      } catch (error) {
        // Keep the provider's internals out of the response, but log the cause
        // so an operator can tell a misconfigured deployment from an outage.
        console.warn("[Account deletion] Could not email a deletion code:", error instanceof Error ? error.message : error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not email a verification code right now. Try again shortly." });
      }
      return { success: true, email: ctx.user.email } as const;
    }),
    /** Step 2 of account deletion: verifies the emailed code with Neon Auth
     *  before the account and workspace data are permanently deleted. The
     *  check is side-effect free, so the code stays valid for a retry if the
     *  delete itself fails. */
    confirmDeleteAccount: protectedProcedure
      .input(z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your email.") }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.email) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account has no email address, so a deletion code cannot be verified." });
        let check: { valid: boolean; error?: string };
        try {
          check = await verifyAccountDeletionOtp({ email: ctx.user.email, otp: input.code });
        } catch (error) {
          // An unconfigured or unreachable auth service must not surface an
          // internal message; fail closed and keep the account intact.
          console.warn("[Account deletion] Could not verify a deletion code:", error instanceof Error ? error.message : error);
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Nova could not verify that code right now. Try again shortly." });
        }
        if (!check.valid) throw new TRPCError({ code: "BAD_REQUEST", message: check.error ?? "That code is not valid or has expired. Send a new code and try again." });
        const success = await deleteUserAccount(ctx.user.id);
        if (!success) throw new TRPCError({ code: "NOT_FOUND", message: "Account deletion could not be completed." });
        return { success: true } as const;
      }),
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
  credits: router({ status: protectedProcedure.query(({ ctx }) => getDailyCreditStatusForUser(ctx.user.id)) }),
  billing: router({
    status: protectedProcedure.query(({ ctx }) => getPriorityStatusForUser(ctx.user.id)),
    /**
     * Test mode: no payment step. Records the priority purchase, which makes the
     * account's queued requests jump ahead of standard ones for one hour from
     * the purchase. Buying again restarts the hour; there is nothing to cancel.
     */
    purchasePriority: protectedProcedure.mutation(({ ctx }) => purchasePriorityForUser(ctx.user.id)),
  }),
  apiKeys: router({
    list: protectedProcedure.query(({ ctx }) => listApiKeysForUser(ctx.user.id)),
    /** Returns the full key value exactly once; Nova stores only its hash. */
    create: protectedProcedure
      .input(z.object({ name: z.string().trim().min(1, "Give the key a name.").max(120) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await createApiKeyForUser(ctx.user.id, input.name);
        } catch (error) {
          if (error instanceof ApiKeyLimitError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
          if (error instanceof ApiKeyStorageError) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: error.message });
          throw error;
        }
      }),
    rename: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(1, "Give the key a name.").max(120) }))
      .mutation(async ({ ctx, input }) => {
        const renamed = await renameApiKeyForUser(ctx.user.id, input.id, input.name);
        if (!renamed) throw new TRPCError({ code: "NOT_FOUND", message: "That API key does not exist." });
        return renamed;
      }),
    revoke: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const revoked = await revokeApiKeyForUser(ctx.user.id, input.id);
        if (!revoked) throw new TRPCError({ code: "NOT_FOUND", message: "That API key does not exist." });
        return { success: true };
      }),
  }),
  workspace: router({
    dashboard: protectedProcedure.query(({ ctx }) => getWorkspaceDashboard(ctx.user.id)),
    computer: protectedProcedure.query(({ ctx }) => getWorkspaceComputer(ctx.user.id)),
    current: protectedProcedure.query(({ ctx }) => getOrCreateWorkspace(ctx.user.id)),
    modelSettings: protectedProcedure.query(({ ctx }) => getWorkspaceModelSettingsForUser(ctx.user.id)),
    updateSettings: protectedProcedure.input(workspaceSettingsInput).mutation(async ({ ctx, input }) => {
      if (input.activeModelId !== undefined) {
        // Only an explicit model-id change is validated against the live
        // gateway catalogue. A bare provider switch (e.g. back to the
        // built-in gateway) must never need the round-trip: the stored
        // activeModelId is bookkeeping (resume paths resolve their own
        // model), and a gateway that omits its default model from /models
        // would otherwise block the switch with an unrelated error.
        try {
          const models = await listGatewayModels(true);
          if (!models.some(model => model.id === input.activeModelId)) throw new TRPCError({ code: "BAD_REQUEST", message: "That text or vision model is not currently available." });
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          if (error instanceof AiGatewayClientError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
          throw error;
        }
      }
      const settings = await updateWorkspaceModelSettingsForUser(ctx.user.id, {
        activeProvider: input.activeProvider,
        activeModelId: input.activeModelId,
        activeCustomModelId: input.activeCustomModelId,
        workspaceRules: input.workspaceRules,
        enabled: input.personalisationEnabled,
        profile: input.personalisationProfile,
        tone: input.personalisationTone,
        detail: input.personalisationDetail,
        proactiveness: input.personalisationProactiveness,
        expertise: input.personalisationExpertise,
      });
      if (!settings) throwIfNotFound(settings, "custom model");
      return settings;
    }),
    /** Factory reset: deletes every workspace file and folder and replaces
     *  the persistent VM with a fresh machine. Guarded by a typed confirm. */
    factoryReset: protectedProcedure.input(z.object({ confirm: z.string().trim().min(1, "Type RESET to confirm.") })).mutation(async ({ ctx, input }) => {
      if (input.confirm !== "RESET") throw new TRPCError({ code: "BAD_REQUEST", message: "Type RESET to confirm the factory reset." });
      return factoryResetWorkspaceForUser(ctx.user.id);
    }),
    /** Clears every memory Nova has stored for the workspace - the shared
     *  (default Nova) scope and each personal agent's private scope. Guarded
     *  by a typed confirm because it cannot be undone. */
    clearMemories: protectedProcedure.input(z.object({ confirm: z.string().trim().min(1, "Type CLEAR to confirm.") })).mutation(async ({ ctx, input }) => {
      if (input.confirm !== "CLEAR") throw new TRPCError({ code: "BAD_REQUEST", message: "Type CLEAR to confirm clearing all memory." });
      const deletedMemories = await clearMemoriesForUser(ctx.user.id);
      return { success: true as const, deletedMemories };
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
    configure: protectedProcedure.input(z.object({ chatId: z.string().trim().min(1).max(64).nullable().optional() })).mutation(async ({ ctx, input }) => { const token = ENV.defaultTelegramBotToken || process.env.TELEGRAM_BOT_TOKEN || ""; if (!token) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The workspace Telegram bot is not set up yet. Ask the workspace owner to finish setting it up." }); const bot = await validateTelegramBotToken(token); const creds = await getTelegramCredentialsForUser(ctx.user.id); const saved = await saveTelegramSettingsForUser(ctx.user.id, { botToken: token, chatId: input.chatId ?? creds?.chatId ?? null, botUsername: bot.username, botDisplayName: bot.displayName }); const webhookBaseUrl = ENV.publicBaseUrl || (ctx.req?.headers?.host ? `https://${ctx.req.headers.host}` : ""); if (webhookBaseUrl) { try { await configureTelegramWebhook(token, webhookBaseUrl); } catch {} } return saved; }),
    discoverChat: protectedProcedure.mutation(async ({ ctx }) => { const credentials = await getTelegramCredentialsForUser(ctx.user.id); if (!credentials) throw new TRPCError({ code: "NOT_FOUND", message: "Add and validate a Telegram bot token first." }); const webhookBaseUrl = ENV.publicBaseUrl || (ctx.req?.headers?.host ? `https://${ctx.req.headers.host}` : ""); const restoreWebhook = async () => { if (webhookBaseUrl) { try { await configureTelegramWebhook(credentials.token, webhookBaseUrl); } catch {} } }; let chatId: string; try { chatId = await discoverTelegramChat(credentials.token); } catch (error) { await restoreWebhook(); throw error; } const saved = await updateTelegramChatForUser(ctx.user.id, chatId); await restoreWebhook(); return saved; }),
    sendTest: protectedProcedure.input(z.object({ text: z.string().trim().min(1).max(4096).default("Nova is connected to your Telegram bot.") })).mutation(async ({ ctx, input }) => { const credentials = await getTelegramCredentialsForUser(ctx.user.id); if (!credentials?.chatId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Send /start to your bot in Telegram, then discover its chat before sending a message." }); const sent = await sendTelegramMessage(credentials.token, credentials.chatId, input.text); return { success: true as const, messageId: sent.message_id }; }),
    remove: protectedProcedure.mutation(async ({ ctx }) => { const deleted = await deleteTelegramSettingsForUser(ctx.user.id); return { success: deleted } as const; }),
  }),
  ai: router({ models: protectedProcedure.input(z.object({ forceRefresh: z.boolean().optional() }).optional()).query(async ({ input }) => { try { return await listGatewayModels(input?.forceRefresh); } catch (error) { if (error instanceof AiGatewayClientError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message }); throw error; } }), status: protectedProcedure.query(({ ctx }) => getAiGatewayStatus(ctx.user.id)), complete: protectedProcedure.input(gatewayCompletionInput).mutation(async ({ ctx, input }) => { try { return await completeWithAiGateway(ctx.user.id, input.prompt, input.modelId); } catch (error) { if (error instanceof AiGatewayClientError) { const code = error.kind === "configuration" ? "PRECONDITION_FAILED" : ["rate_limit", "allowance_reached", "credits_exhausted"].includes(error.kind) ? "TOO_MANY_REQUESTS" : error.kind === "client_error" ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR"; throw new TRPCError({ code, message: error.message }); } throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova's AI service is temporarily unavailable. Please retry shortly." }); } }) }),
  deployments: router({
    /** Live website deployments: configuration, the current live site, and recent history. Publishing itself is AI-only - the deploy_website agent tool is the single path to a deploy, so there is no deploy mutation here. */
    status: protectedProcedure.query(({ ctx }) => getDeploymentStatusForUser(ctx.user.id)),
    /** Takes one hosted deployment offline by its ID (d-01, ...) - the Deployments page's own management action. */
    delete: protectedProcedure.input(z.object({ deployment: z.string().trim().min(1).max(64) })).mutation(async ({ ctx, input }) => {
      const result = await deleteWorkspaceSite(ctx.user.id, { deployment: input.deployment });
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      return { deleted: result.deleted, failed: result.failed };
    }),
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
    start: protectedProcedure.input(agentVmRunInput).mutation(async ({ ctx, input }) => { try { return await startAgentVmRun(ctx.user.id, input, { pauseWhenDone: true }); } catch (error) { /* Only curated, user-facing messages reach the client; unexpected errors (sandbox/provider internals) are logged and replaced with a fixed generic message. */ const detail = error instanceof Error ? error.message : ""; const code = /active agent VM run/i.test(detail) ? "PRECONDITION_FAILED" : /blocked|limits/i.test(detail) ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR"; if (code === "INTERNAL_SERVER_ERROR") console.warn("[AgentVM] start failed:", detail); throw new TRPCError({ code, message: code === "INTERNAL_SERVER_ERROR" ? "Nova could not start that agent VM run." : detail }); } }),
    cancel: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const run = await cancelAgentVmRun(ctx.user.id, input.id); if (!run) throwIfNotFound(run, "active agent VM run"); return run; }),
  }),
  automations: router({
    list: protectedProcedure.query(({ ctx }) => listAutomationsForUser(ctx.user.id)), runs: protectedProcedure.input(z.object({ automationId: z.number().int().positive() })).query(({ ctx, input }) => listAutomationRunsForUser(ctx.user.id, input.automationId)),
    update: protectedProcedure.input(z.object({ id: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => { const existing = await getAutomationRecordForUser(ctx.user.id, input.id); if (!existing) throwIfNotFound(existing, "automation"); const token = sessionToken(ctx.req); if (!token) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your Nova session is not ready to save a background schedule. Refresh the page and try again." }); if (input.enabled) { if (existing.scheduleCronTaskUid) await updateHeartbeatJob(existing.scheduleCronTaskUid, { cron: WORKSPACE_DIGEST_CRON, path: "/api/scheduled/automation", method: "POST", enable: true }, token); else { const scheduled = await createHeartbeatJob({ name: `nova-automation-${existing.id}`, cron: WORKSPACE_DIGEST_CRON, path: "/api/scheduled/automation", method: "POST", description: "Daily private Nova workspace briefing" }, token); await setAutomationScheduleTaskForUser(ctx.user.id, existing.id, scheduled.taskUid); } } else if (existing.scheduleCronTaskUid) await updateHeartbeatJob(existing.scheduleCronTaskUid, { enable: false }, token); const automation = await updateAutomationForUser(ctx.user.id, input.id, { enabled: input.enabled }); if (!automation) throwIfNotFound(automation, "automation"); return automation; }),
    runDue: protectedProcedure.mutation(async ({ ctx }) => { try { return await runDueAutomationsForUser(ctx.user.id); } catch (error) { /* Only the automation module's own "Nova ..." messages are user-facing; anything else (query errors, provider internals) is logged and kept out of the response. */ const detail = error instanceof Error ? error.message : ""; if (detail && !detail.startsWith("Nova ")) console.warn("[Automations] runDue failed:", detail); throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: detail.startsWith("Nova ") ? detail : "Nova could not run the saved automation." }); } }),
  }),
  folders: router({ create: protectedProcedure.input(folderInput).mutation(async ({ ctx, input }) => { const folder = await createWorkspaceFolderForUser(ctx.user.id, input); if (!folder) throwIfNotFound(folder, "parent folder"); return folder; }), update: protectedProcedure.input(folderUpdateInput).mutation(async ({ ctx, input }) => { const folder = await updateWorkspaceFolderForUser(ctx.user.id, input.id, input); if (!folder) throwIfNotFound(folder, "folder"); return folder; }), delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const deleted = await deleteWorkspaceFolderForUser(ctx.user.id, input.id); if (!deleted) throwIfNotFound(deleted, "folder"); return { success: true } as const; }) }),
  files: router({ create: protectedProcedure.input(fileInput).mutation(async ({ ctx, input }) => { const file = await createWorkspaceFileForUser(ctx.user.id, input); if (!file) throwIfNotFound(file, "folder"); return file; }), update: protectedProcedure.input(fileUpdateInput).mutation(async ({ ctx, input }) => { const file = await updateWorkspaceFileForUser(ctx.user.id, input.id, input); if (!file) throwIfNotFound(file, "file or destination folder"); return file; }), delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const deleted = await deleteWorkspaceFileForUser(ctx.user.id, input.id); if (!deleted) throwIfNotFound(deleted, "file"); return { success: true } as const; }) }),
  chats: router({
    create: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(160) })).mutation(async ({ ctx, input }) => { const chat = await createChatForUser(ctx.user.id, input.title); if (!chat) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not create that conversation." }); return chat; }),
    messages: protectedProcedure.input(z.object({ chatId: z.string().trim().min(1).max(24) })).query(async ({ ctx, input }) => { const messages = await listChatMessagesForUser(ctx.user.id, input.chatId); if (!messages) throwIfNotFound(messages, "conversation"); return messages; }),
    runStatus: protectedProcedure.input(z.object({ chatId: z.string().trim().min(1).max(24) })).query(async ({ ctx, input }) => {
      const chat = await getChatForUser(ctx.user.id, input.chatId);
      if (!chat) throwIfNotFound(chat, "conversation");
      const run = await getActiveAgentRunForChat(ctx.user.id, input.chatId);
      return run ? { active: true as const, ...run } : { active: false as const };
    }),
    /** Stops the chat's in-flight agent run and its queued/running VM workflows. */
    stop: protectedProcedure.input(z.object({ chatId: z.string().trim().min(1).max(24) })).mutation(async ({ ctx, input }) => {
      const chat = await getChatForUser(ctx.user.id, input.chatId);
      if (!chat) throwIfNotFound(chat, "conversation");
      const cancelledVmRuns = await cancelActiveAgentVmRunsForUser(ctx.user.id, input.chatId);
      const cancelledQueueItems = await cancelWaitingInferenceQueueItemsForUser(ctx.user.id, input.chatId);
      await requestAgentStopForUser(ctx.user.id, input.chatId);
      return { stopped: true as const, cancelledVmRuns, cancelledQueueItems };
    }),
    send: protectedProcedure.input(z.object({ chatId: z.string().trim().min(1).max(24).nullable().optional(), content: z.string().trim().min(1).max(12000) })).mutation(async ({ ctx, input }) => { const chat = input.chatId ? undefined : await createChatForUser(ctx.user.id, "New conversation"); const chatId = input.chatId ?? chat?.id; if (!chatId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not start that conversation." }); const activation = await activatePriorityWindowForUser(ctx.user.id).catch(() => ({ priority: false, justActivated: false, expiresAt: null as Date | null })); const priorityNotice = activation.justActivated ? priorityActiveMessage() : undefined; if (shouldQueue()) { const item = await enqueueInferenceQueueItem({ ownerId: ctx.user.id, channel: "web", chatId, content: input.content, payload: {} }); const queuePosition = await getInferenceQueuePosition(item.id); kickPeakQueue(); return { chatId, queued: true as const, queueId: item.id, queuePosition, message: queuePositionMessage(queuePosition), ...(priorityNotice ? { priorityNotice } : {}) }; } const result = await executeWebAgentRun({ ownerId: ctx.user.id, chatId, content: input.content, requestStartedAtMs: Date.now() }); void autoTitleChatForUser(ctx.user.id, chatId).catch(() => {});      return { chatId, ...(priorityNotice ? { priorityNotice } : {}), ...(await result) }; }),
  }),
  agents: router({
    /** The workspace's personal agents with their Nova-native identity and wallets. */
    list: protectedProcedure.query(({ ctx }) => listAgentsForUser(ctx.user.id)),
    create: protectedProcedure.input(agentCreateInput).mutation(async ({ ctx, input }) => {
      try {
        const agent = await createAgentForUser(ctx.user.id, input);
        if (!agent) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not create that agent." });
        return agent;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        return agentRouteError(error, "Nova could not create that agent.");
      }
    }),
    update: protectedProcedure.input(agentUpdateInput).mutation(async ({ ctx, input }) => {
      try {
        const { id, ...patch } = input;
        const agent = await updateAgentForUser(ctx.user.id, id, patch);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "That agent does not exist in your Nova space." });
        return agent;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        return agentRouteError(error, "Nova could not update that agent.");
      }
    }),
    delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const deleted = await deleteAgentForUser(ctx.user.id, input.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "That agent does not exist in your Nova space." });
      return { success: true } as const;
    }),
    /** Opens (or reuses) the 1:1 conversation for one agent. */
    startChat: protectedProcedure.input(z.object({ agentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const chat = await startAgentChatForUser(ctx.user.id, input.agentId);
      if (!chat) throw new TRPCError({ code: "NOT_FOUND", message: "That agent does not exist in your Nova space." });
      return chat;
    }),
    /** Agent-owned conversations: 1:1 chats and team chats with their rosters. */
    chats: protectedProcedure.query(({ ctx }) => listAgentChatsForUser(ctx.user.id)),
    createTeam: protectedProcedure.input(teamCreateInput).mutation(async ({ ctx, input }) => {
      const result = await createTeamChatForUser(ctx.user.id, input);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return result;
    }),
    /** Approvals waiting on the user, plus the most recently decided ones. */
    approvals: protectedProcedure.query(({ ctx }) => listApprovalsForUser(ctx.user.id)),
    approve: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const result = await decideApprovalForUser(ctx.user.id, input.id, "approve");
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "That request is no longer waiting for a decision." });
      return result;
    }),
    deny: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const result = await decideApprovalForUser(ctx.user.id, input.id, "deny");
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "That request is no longer waiting for a decision." });
      return result;
    }),
    /** Nova-internal mail between agents (and to the workspace owner). */
    inbox: protectedProcedure.query(({ ctx }) => listAgentEmailsForUser(ctx.user.id)),
  }),
  models: router({ createCustom: protectedProcedure.input(customModelInput).mutation(({ ctx, input }) => createCustomModelForUser(ctx.user.id, input)), deleteCustom: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const deleted = await deleteCustomModelForUser(ctx.user.id, input.id); if (!deleted) throwIfNotFound(deleted, "custom model"); return { success: true } as const; }), /** Tests a candidate BYOK endpoint (base URL + key + model ID) without saving it. */ testCustom: protectedProcedure.input(z.object({ baseUrl: z.string().trim().url("Enter a complete HTTPS endpoint URL.").max(2048), apiKey: z.string().trim().min(1, "An API key is required.").max(4096), modelId: z.string().trim().min(1, "A model ID is required.").max(240) })).mutation(async ({ input }) => { try { return await testCustomModelEndpoint(input); } catch (error) { if (error instanceof AiGatewayClientError) { const code = error.kind === "configuration" ? "PRECONDITION_FAILED" : error.kind === "rate_limit" ? "TOO_MANY_REQUESTS" : error.kind === "client_error" ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR"; throw new TRPCError({ code, message: error.message }); } throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The provider endpoint could not be reached." }); } }) }),
  projects: router({ list: protectedProcedure.query(({ ctx }) => listProjectsForUser(ctx.user.id)), get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => { const project = await getProjectForUser(ctx.user.id, input.id); if (!project) throwIfNotFound(project, "project"); return project; }), create: protectedProcedure.input(projectInput).mutation(async ({ ctx, input }) => { const project = await createProjectForUser(ctx.user.id, input); if (!project) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not create that project." }); return project; }), update: protectedProcedure.input(projectUpdateInput).mutation(async ({ ctx, input }) => { const project = await updateProjectForUser(ctx.user.id, input.id, input); if (!project) throwIfNotFound(project, "project"); return project; }), delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const deleted = await deleteProjectForUser(ctx.user.id, input.id); if (!deleted) throwIfNotFound(deleted, "project"); return { success: true } as const; }) }),
  tasks: router({ list: protectedProcedure.query(({ ctx }) => listTasksForUser(ctx.user.id)), create: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), title: z.string().trim().min(1, "A task needs a title.").max(240), notes: z.string().trim().max(4000).nullable().optional(), dueAt: z.date().nullable().optional() })).mutation(async ({ ctx, input }) => { const task = await createTaskForUser(ctx.user.id, input); if (!task) throwIfNotFound(task, "project"); return task; }), updateStatus: protectedProcedure.input(z.object({ id: z.number().int().positive(), status: taskStatus })).mutation(async ({ ctx, input }) => { const task = await updateTaskStatusForUser(ctx.user.id, input.id, input.status); if (!task) throwIfNotFound(task, "task"); return task; }), delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const deleted = await deleteTaskForUser(ctx.user.id, input.id); if (!deleted) throwIfNotFound(deleted, "task"); return { success: true } as const; }) }),
});
export type AppRouter = typeof appRouter;
