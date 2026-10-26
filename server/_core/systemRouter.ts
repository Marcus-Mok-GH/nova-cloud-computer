import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getSandboxMetrics } from "../e2b";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  sandboxMetrics: adminProcedure.query(() => {
    const metrics = getSandboxMetrics();
    return {
      ...metrics,
      avgConnectLatencyMs:
        metrics.sandboxConnects > 0
          ? Math.round(metrics.totalConnectLatencyMs / metrics.sandboxConnects)
          : 0,
      avgCreateLatencyMs:
        metrics.sandboxCreations > 0
          ? Math.round(metrics.totalCreateLatencyMs / metrics.sandboxCreations)
          : 0,
    };
  }),
});
