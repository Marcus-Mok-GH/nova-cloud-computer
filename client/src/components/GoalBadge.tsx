import type { GoalState } from "@shared/goal";
import { Target } from "lucide-react";
import React from "react";

/**
 * The header badge for a conversation's autonomous goal: what the agent is
 * chasing and where it stands. Renders nothing for a conversation that has no
 * goal (or one the user cleared), so the header is unchanged for ordinary
 * chats.
 */

const GOAL_STATUS: Record<
  Exclude<GoalState["status"], "cleared">,
  { label: string; className: string; title: string }
> = {
  active: {
    label: "Goal",
    className: "border-primary/30 bg-primary/10 text-primary",
    title: "Nova is working toward this goal on its own, round after round.",
  },
  met: {
    label: "Goal met",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    title: "Nova reported this goal achieved, with its evidence.",
  },
  unfinished: {
    label: "Goal stalled",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    title:
      "Nova stopped before reaching this goal - it needs something from you, or the chase ran out of its allowance.",
  },
};

export function GoalBadge({ goal }: { goal: GoalState | null }) {
  if (!goal || goal.status === "cleared" || !goal.objective) return null;
  const status = GOAL_STATUS[goal.status];
  return (
    <span
      data-testid="goal-badge"
      data-goal-status={goal.status}
      title={`${status.title}\n\nGoal: ${goal.objective}`}
      className={`inline-flex max-w-[18rem] shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${status.className}`}
    >
      <Target className="size-3 shrink-0" />
      <span className="shrink-0">{status.label}</span>
      <span className="truncate font-semibold normal-case tracking-normal opacity-90">
        {goal.objective}
      </span>
    </span>
  );
}
