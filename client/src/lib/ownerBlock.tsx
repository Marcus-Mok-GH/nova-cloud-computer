import React, { createContext, useContext, type ReactNode } from "react";
import {
  toolActivityActor,
  type ToolActivity,
  type ToolActivityOwner,
} from "@/lib/chatMessages";

/**
 * True while a row renders inside a sub-agent's owner block, so the row's own
 * owner badge stays quiet and the block's tag carries the "who" instead.
 */
export const InOwnerBlockContext = createContext(false);

export function useInOwnerBlock(): boolean {
  return useContext(InOwnerBlockContext);
}

/** The CSS custom property that carries an owner's accent (theme-aware). */
export function ownerAccentVar(owner: ToolActivityOwner): string {
  switch (owner) {
    case "coding-specialist":
      return "var(--owner-coding)";
    case "research-agent":
      return "var(--owner-research)";
    case "thinker-agent":
      return "var(--owner-thinker)";
    case "vm-agent":
      return "var(--owner-vm)";
    default:
      return "var(--primary)";
  }
}

export function ownerTint(owner: ToolActivityOwner, pct: number): string {
  return `color-mix(in oklch, ${ownerAccentVar(owner)} ${pct}%, transparent)`;
}

/**
 * A sub-agent's stretch of tool calls, wrapped in a color-coded block: a named
 * tag on top that also says whether the specialist is still working, a colored
 * rule down the side, and a faint tint behind the rows. Nova's own rows never
 * get this treatment - plain rows are the default.
 */
export function OwnerBlock({
  activities,
  children,
}: {
  activities: ToolActivity[];
  children: ReactNode;
}) {
  const actor = toolActivityActor(activities[0]);
  const accent = ownerAccentVar(actor.owner);
  // Any step still running means the specialist is at work; the label carries
  // that state so a delegated block reads as "happening" even before the row
  // beneath it is looked at.
  const working = activities.some(
    activity => activity.state === "running"
  );
  return (
    <InOwnerBlockContext.Provider value={true}>
      <div
        data-testid="owner-block"
        data-owner={actor.owner}
        data-working={working}
        className="ms-2 mt-0.5 overflow-hidden rounded-lg border-s-[3px] py-2 ps-3 pe-2"
        style={{
          borderInlineStartColor: accent,
          background: ownerTint(actor.owner, 6),
        }}
      >
        <span
          data-testid="owner-block-tag"
          className="mb-1.5 inline-flex items-center gap-1.5 text-[12px] font-bold tracking-tight"
          style={{ color: accent }}
        >
          <span
            aria-hidden
            className={`inline-block size-[7px] rounded-full ${
              working ? "animate-pulse" : ""
            }`}
            style={{ background: accent }}
          />
          {actor.label}
          <span
            data-testid="owner-block-state"
            className={
              working
                ? "font-semibold"
                : "font-medium opacity-70"
            }
          >
            {working ? "· working" : "· done"}
          </span>
        </span>
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </InOwnerBlockContext.Provider>
  );
}
