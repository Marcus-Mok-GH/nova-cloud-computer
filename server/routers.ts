import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createProjectForUser,
  createTaskForUser,
  deleteProjectForUser,
  deleteTaskForUser,
  getProjectForUser,
  getOrCreateWorkspace,
  getWorkspaceDashboard,
  listProjectsForUser,
  listTasksForUser,
  updateTaskStatusForUser,
  updateProjectForUser,
} from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

const projectInput = z.object({
  name: z.string().trim().min(1, "A project needs a name.").max(160),
  description: z.string().trim().max(2000).nullable().optional(),
});

const taskStatus = z.enum(["todo", "in_progress", "done"]);
const projectStatus = z.enum(["active", "archived"]);
const projectUpdateInput = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: projectStatus.optional(),
}).refine(input => input.name !== undefined || input.description !== undefined || input.status !== undefined, { message: "Provide at least one project change." });

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  workspace: router({
    dashboard: protectedProcedure.query(({ ctx }) => getWorkspaceDashboard(ctx.user.id)),
    current: protectedProcedure.query(({ ctx }) => getOrCreateWorkspace(ctx.user.id)),
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
