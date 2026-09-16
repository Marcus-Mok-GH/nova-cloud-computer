import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { countOtherActiveAdmins, deleteUserForAdmin, getAdminOverview, listUsersForAdmin, setUserBannedForAdmin, setUserRoleForAdmin } from "./admin";

const managedRole = z.enum(["user", "admin"]);

export const adminRouter = router({
  /** System-wide counts and recent activity for the admin overview. */
  overview: adminProcedure.query(() => getAdminOverview()),

  /** Every registered account, newest first. */
  users: adminProcedure.query(() => listUsersForAdmin()),

  /** Promote or demote an account. An admin can demote themselves, but only
   * while another active admin exists, so the console cannot lock out its last
   * admin by accident. */
  setUserRole: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), role: managedRole }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.id === input.userId) {
        if (input.role !== "user") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You are already an admin.",
          });
        }
        const otherAdmins = await countOtherActiveAdmins(ctx.user.id);
        if (otherAdmins === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You are the only active admin — promote someone else before demoting yourself.",
          });
        }
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
