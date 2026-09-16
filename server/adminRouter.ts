import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { deleteUserForAdmin, getAdminOverview, listUsersForAdmin, setUserBannedForAdmin, setUserRoleForAdmin } from "./admin";

const managedRole = z.enum(["user", "admin"]);

export const adminRouter = router({
  /** System-wide counts and recent activity for the admin overview. */
  overview: adminProcedure.query(() => getAdminOverview()),

  /** Every registered account, newest first. */
  users: adminProcedure.query(() => listUsersForAdmin()),

  /** Promote or demote an account. An admin can never change their own role,
   * so the console itself cannot lock out the last admin by accident. */
  setUserRole: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), role: managedRole }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.id === input.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot change your own role from the admin console.",
        });
      }
      const updated = await setUserRoleForAdmin(input.userId, input.role);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "That account is no longer available." });
      return { success: true, user: updated };
    }),

  /** Ban or unban an account. An admin can never ban themselves. */
  setUserBanned: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), banned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.id === input.userId && input.banned) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot ban your own account from the admin console." });
      }
      const updated = await setUserBannedForAdmin(input.userId, input.banned);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "That account is no longer available." });
      return { success: true, user: updated };
    }),

  /** Permanently delete an account with all of its workspace data. An admin can
   * never delete their own account here; use profile settings for that. */
  deleteUser: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.id === input.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot delete your own account from the admin console." });
      }
      const deleted = await deleteUserForAdmin(input.userId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "That account is no longer available." });
      return { success: true };
    }),
});
