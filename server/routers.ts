import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createChatForUser,
  createProjectForUser,
  deleteUserAccount,
  createTaskForUser,
  createCustomModelForUser,
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  deleteCustomModelForUser,
  deleteProjectForUser,
  deleteTaskForUser,
  deleteWorkspaceFileForUser,
  deleteWorkspaceFolderForUser,
  getProjectForUser,
  getOrCreateWorkspace,
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
} from "./db";
import { cancelAgentVmRun, getAgentVmStatus, listAgentVmRuns, startAgentVmRun } from "./agentVm";
import { completeWithNvidiaGateway, getNvidiaGatewayStatus, NvidiaGatewayClientError } from "./nvidiaGateway";
import { runWorkspaceAgent } from "./workspaceAgent";
import { discoverTelegramChat, sendTelegramMessage, validateTelegramBotToken } from "./telegram";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

const projectInput = z.object({
  name: z.string().trim().min(1, "A project needs a name.").max(160),
  description: z.string().trim().max(2000).nullable().optional(),
});

const taskStatus = z.enum(["todo", "in_progress", "done"]);
const projectStatus = z.enum(["active", "archived"]);
const modelProvider = z.enum(["anthropic", "openai", "gemini", "custom"]);
const modelCompatibility = z.enum(["openai", "anthropic"]);
const projectUpdateInput = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: projectStatus.optional(),
}).refine(input => input.name !== undefined || input.description !== undefined || input.status !== undefined, { message: "Provide at least one project change." });
const customModelInput = z.object({
  name: z.string().trim().min(1, "Give the model a name.").max(120),
  modelId: z.string().trim().min(1, "A model ID is required.").max(240),
  baseUrl: z.string().trim().url("Enter a complete HTTPS endpoint URL.").max(2048),
  compatibility: modelCompatibility,
  apiKey: z.string().trim().min(1, "An API key is required.").max(4096),
  supportsImageInput: z.boolean(),
});
const workspaceSettingsInput = z.object({
  activeProvider: modelProvider.optional(),
  activeModelId: z.string().trim().min(1).max(240).optional(),
  activeCustomModelId: z.number().int().positive().nullable().optional(),
  workspaceRules: z.string().trim().max(8000).nullable().optional(),
}).refine(input => input.activeProvider !== undefined || input.activeModelId !== undefined || input.activeCustomModelId !== undefined || input.workspaceRules !== undefined, { message: "Provide at least one setting change." });
const folderInput = z.object({
  name: z.string().trim().min(1, "A folder needs a name.").max(160),
  parentId: z.number().int().positive().nullable().optional(),
});
const folderUpdateInput = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(160).optional(),
  parentId: z.number().int().positive().nullable().optional(),
}).refine(input => input.name !== undefined || input.parentId !== undefined, { message: "Provide a folder change." });
const fileInput = z.object({
  name: z.string().trim().min(1, "A file needs a name.").max(240),
  content: z.string().max(200000).optional(),
  mimeType: z.string().trim().min(1).max(120).optional(),
  folderId: z.number().int().positive().nullable().optional(),
});
const fileUpdateInput = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(240).optional(),
  content: z.string().max(200000).optional(),
  folderId: z.number().int().positive().nullable().optional(),
}).refine(input => input.name !== undefined || input.content !== undefined || input.folderId !== undefined, { message: "Provide a file change." });
const telegramConfigureInput = z.object({
  botToken: z.string().trim().min(20, "Enter a complete BotFather token.").max(4096),
  chatId: z.string().trim().min(1).max(64).nullable().optional(),
});
const agentVmRunInput = z.object({
  task: z.string().trim().min(3, "Describe the VM task.").max(1600),
  code: z.string().max(12000).optional(),
});
const nvidiaCompletionInput = z.object({
  prompt: z.string().trim().min(3, "Describe what you want NVIDIA to help with.").max(12000),
});

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
      const success = await deleteUserAccount(ctx.user.id);
      if (!success) throw new TRPCError({ code: "NOT_FOUND", message: "Account deletion could not be completed." });
      return { success };
    }),
  }),
  workspace: router({
    dashboard: protectedProcedure.query(({ ctx }) => getWorkspaceDashboard(ctx.user.id)),
    computer: protectedProcedure.query(({ ctx }) => getWorkspaceComputer(ctx.user.id)),
    current: protectedProcedure.query(({ ctx }) => getOrCreateWorkspace(ctx.user.id)),
    modelSettings: protectedProcedure.query(({ ctx }) => getWorkspaceModelSettingsForUser(ctx.user.id)),
    updateSettings: protectedProcedure.input(workspaceSettingsInput).mutation(async ({ ctx, input }) => {
      const settings = await updateWorkspaceModelSettingsForUser(ctx.user.id, input);
      if (!settings) throw new TRPCError({ code: "NOT_FOUND", message: "That custom model is not available in your Nova space." });
      return settings;
    }),
  }),
  telegram: router({
    status: protectedProcedure.query(({ ctx }) => getTelegramSettingsForUser(ctx.user.id)),
    configure: protectedProcedure.input(telegramConfigureInput).mutation(async ({ ctx, input }) => {
      const bot = await validateTelegramBotToken(input.botToken);
      return saveTelegramSettingsForUser(ctx.user.id, { botToken: input.botToken, chatId: input.chatId ?? null, botUsername: bot.username, botDisplayName: bot.displayName });
    }),
    discoverChat: protectedProcedure.mutation(async ({ ctx }) => {
      const credentials = await getTelegramCredentialsForUser(ctx.user.id);
      if (!credentials) throw new TRPCError({ code: "NOT_FOUND", message: "Add and validate a Telegram bot token first." });
      const chatId = await discoverTelegramChat(credentials.token);
      return updateTelegramChatForUser(ctx.user.id, chatId);
    }),
    sendTest: protectedProcedure.input(z.object({ text: z.string().trim().min(1).max(4096).default("Nova is connected to your Telegram bot.") })).mutation(async ({ ctx, input }) => {
      const credentials = await getTelegramCredentialsForUser(ctx.user.id);
      if (!credentials?.chatId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Send /start to your bot in Telegram, then discover its chat before sending a message." });
      const sent = await sendTelegramMessage(credentials.token, credentials.chatId, input.text);
      return { success: true as const, messageId: sent.message_id };
    }),
    remove: protectedProcedure.mutation(async ({ ctx }) => {
      const deleted = await deleteTelegramSettingsForUser(ctx.user.id);
      return { success: deleted } as const;
    }),
  }),
  nvidia: router({
    status: protectedProcedure.query(({ ctx }) => getNvidiaGatewayStatus(ctx.user.id)),
    complete: protectedProcedure.input(nvidiaCompletionInput).mutation(async ({ ctx, input }) => {
      try {
        return await completeWithNvidiaGateway(ctx.user.id, input.prompt);
      } catch (error) {
        if (error instanceof NvidiaGatewayClientError) {
          const code = error.kind === "configuration" ? "PRECONDITION_FAILED" : error.kind === "rate_limit" ? "TOO_MANY_REQUESTS" : "INTERNAL_SERVER_ERROR";
          throw new TRPCError({ code, message: error.message });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "NVIDIA inference is temporarily unavailable. Please retry shortly." });
      }
    }),
  }),
  agentVm: router({
    status: protectedProcedure.query(({ ctx }) => getAgentVmStatus(ctx.user.id)),
    list: protectedProcedure.query(({ ctx }) => listAgentVmRuns(ctx.user.id)),
    start: protectedProcedure.input(agentVmRunInput).mutation(async ({ ctx, input }) => {
      try {
        return await startAgentVmRun(ctx.user.id, input);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Nova could not start that agent VM run.";
        const code = /active agent VM run/i.test(message) ? "PRECONDITION_FAILED" : /blocked|limits/i.test(message) ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR";
        throw new TRPCError({ code, message });
      }
    }),
    cancel: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const run = await cancelAgentVmRun(ctx.user.id, input.id);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "That active agent VM run is not available in your Nova space." });
      return run;
    }),
  }),
  folders: router({
    create: protectedProcedure.input(folderInput).mutation(async ({ ctx, input }) => {
      const folder = await createWorkspaceFolderForUser(ctx.user.id, input);
      if (!folder) throw new TRPCError({ code: "NOT_FOUND", message: "That parent folder is not available in your Nova space." });
      return folder;
    }),
    update: protectedProcedure.input(folderUpdateInput).mutation(async ({ ctx, input }) => {
      const folder = await updateWorkspaceFolderForUser(ctx.user.id, input.id, input);
      if (!folder) throw new TRPCError({ code: "NOT_FOUND", message: "That folder is not available in your Nova space." });
      return folder;
    }),
    delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const deleted = await deleteWorkspaceFolderForUser(ctx.user.id, input.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "That folder is not available in your Nova space." });
      return { success: true } as const;
    }),
  }),
  files: router({
    create: protectedProcedure.input(fileInput).mutation(async ({ ctx, input }) => {
      const file = await createWorkspaceFileForUser(ctx.user.id, input);
      if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "That folder is not available in your Nova space." });
      return file;
    }),
    update: protectedProcedure.input(fileUpdateInput).mutation(async ({ ctx, input }) => {
      const file = await updateWorkspaceFileForUser(ctx.user.id, input.id, input);
      if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "That file or destination folder is not available in your Nova space." });
      return file;
    }),
    delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const deleted = await deleteWorkspaceFileForUser(ctx.user.id, input.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "That file is not available in your Nova space." });
      return { success: true } as const;
    }),
  }),
  chats: router({
    create: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(160) })).mutation(async ({ ctx, input }) => {
      const chat = await createChatForUser(ctx.user.id, input.title);
      if (!chat) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not create that conversation." });
      return chat;
    }),
    messages: protectedProcedure.input(z.object({ chatId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const messages = await listChatMessagesForUser(ctx.user.id, input.chatId);
      if (!messages) throw new TRPCError({ code: "NOT_FOUND", message: "That conversation is not available in your Nova space." });
      return messages;
    }),
    send: protectedProcedure.input(z.object({ chatId: z.number().int().positive().nullable().optional(), content: z.string().trim().min(1).max(12000) })).mutation(async ({ ctx, input }) => {
      const chat = input.chatId ? undefined : await createChatForUser(ctx.user.id, input.content.slice(0, 60));
      const chatId = input.chatId ?? chat?.id;
      if (!chatId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not start that conversation." });
      return { chatId, ...(await runWorkspaceAgent(ctx.user.id, chatId, input.content)) };
    }),
  }),
  models: router({
    createCustom: protectedProcedure.input(customModelInput).mutation(({ ctx, input }) => createCustomModelForUser(ctx.user.id, input)),
    deleteCustom: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const deleted = await deleteCustomModelForUser(ctx.user.id, input.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "That custom model is not available in your Nova space." });
      return { success: true } as const;
    }),
  }),
  projects: router({
    list: protectedProcedure.query(({ ctx }) => listProjectsForUser(ctx.user.id)),
    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const project = await getProjectForUser(ctx.user.id, input.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "That project is not available in your Nova space." });
      return project;
    }),
    create: protectedProcedure.input(projectInput).mutation(async ({ ctx, input }) => {
      const project = await createProjectForUser(ctx.user.id, input);
      if (!project) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Nova could not create that project." });
      return project;
    }),
    update: protectedProcedure.input(projectUpdateInput).mutation(async ({ ctx, input }) => {
      const project = await updateProjectForUser(ctx.user.id, input.id, input);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "That project is not available in your Nova space." });
      return project;
    }),
    delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const deleted = await deleteProjectForUser(ctx.user.id, input.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "That project is not available in your Nova space." });
      return { success: true } as const;
    }),
  }),
  tasks: router({
    list: protectedProcedure.query(({ ctx }) => listTasksForUser(ctx.user.id)),
    create: protectedProcedure.input(z.object({
      projectId: z.number().int().positive(),
      title: z.string().trim().min(1, "A task needs a title.").max(240),
      notes: z.string().trim().max(4000).nullable().optional(),
      dueAt: z.date().nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const task = await createTaskForUser(ctx.user.id, input);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "That project is not available in your Nova space." });
      return task;
    }),
    updateStatus: protectedProcedure.input(z.object({ id: z.number().int().positive(), status: taskStatus })).mutation(async ({ ctx, input }) => {
      const task = await updateTaskStatusForUser(ctx.user.id, input.id, input.status);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "That task is not available in your Nova space." });
      return task;
    }),
    delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const deleted = await deleteTaskForUser(ctx.user.id, input.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "That task is not available in your Nova space." });
      return { success: true } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;
