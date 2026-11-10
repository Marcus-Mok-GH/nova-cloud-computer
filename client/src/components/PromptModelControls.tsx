/**
 * The overview task-prompt's model + effort controls. The model menu lists the
 * shared catalogue (premium entries locked for free accounts, like the in-chat
 * ModelSelector) and the effort menu offers only the deep-thinking levels the
 * chosen model exposes - the two are dependent: switching models re-clamps the
 * effort to what the new model offers. Selection is owned by the parent and
 * handed to `chats.create`, so the conversation the task starts on carries
 * both the model and its effort.
 */
import React from "react";
import { Check, ChevronDown, Crown, Gauge, Lock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type ChatModel,
  type EffortId,
  effortOptionsForModelId,
  FREE_CHAT_MODEL_ID,
} from "@shared/models";

const EFFORT_LABELS: Record<EffortId, string> = {
  auto: "Auto",
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

/** Compact trigger styling that matches the prompt card's inline controls. */
const TRIGGER_CLASS =
  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-foreground transition hover:bg-foreground/[0.06] disabled:cursor-not-allowed disabled:opacity-60";

type PromptModelControlsProps = {
  models: ChatModel[];
  /** The caller's plan; undefined while the subscription query is loading. */
  plan?: "free" | "paid";
  selectedModelId: string;
  selectedEffortId: EffortId;
  onModelChange: (modelId: string) => void;
  onEffortChange: (effortId: EffortId) => void;
  /** Disable every control while a session is starting. */
  disabled?: boolean;
};

export function PromptModelControls({
  models,
  plan,
  selectedModelId,
  selectedEffortId,
  onModelChange,
  onEffortChange,
  disabled,
}: PromptModelControlsProps) {
  const isPaid = plan === "paid";
  const selectedModel =
    models.find(model => model.id === selectedModelId) ??
    models.find(model => model.id === FREE_CHAT_MODEL_ID) ??
    models[0];
  const effortOptions = effortOptionsForModelId(selectedModelId);

  return (
    <div className="flex items-center gap-2">
      {/* Model selector */}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label="Choose model"
          className={TRIGGER_CLASS}
        >
          {isPaid && selectedModel?.id !== FREE_CHAT_MODEL_ID && (
            <Crown className="size-3.5 text-amber-500" />
          )}
          <span className="max-w-[8rem] truncate">
            {selectedModel?.label ?? "Nova Lite"}
          </span>
          <ChevronDown className="size-3.5 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-72">
          <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {isPaid ? "Nova Pro subscription active" : "Models"}
          </DropdownMenuLabel>
          {models.map(model => {
            const locked = model.tier === "pro" && !isPaid;
            const selected = model.id === selectedModel.id;
            return (
              <DropdownMenuItem
                key={model.id}
                disabled={disabled || locked}
                onSelect={event => {
                  event.preventDefault();
                  if (!locked) onModelChange(model.id);
                }}
                className="flex items-start gap-2.5 py-2"
              >
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
                  {selected ? (
                    <Check className="size-4 text-primary" />
                  ) : locked ? (
                    <Lock className="size-3.5 text-muted-foreground" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    {model.label}
                    {model.tier === "pro" && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        Pro
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {model.description}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })}
          {!isPaid && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-2">
                <p className="text-xs leading-snug text-muted-foreground">
                  Nova Pro unlocks every premium model, 10,000 credits a
                  month, and unused credits roll over.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/checkout?product=pro";
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-3 py-2 text-xs font-bold text-background transition hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-black"
                >
                  <Crown className="size-3.5" />
                  Upgrade - S$7.99/month
                </button>
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Effort selector - the deep-thinking level for the chosen model */}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label="Choose effort"
          className={TRIGGER_CLASS}
        >
          <Gauge className="size-4 text-muted-foreground" />
          <span>{EFFORT_LABELS[selectedEffortId] ?? "Auto"}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-44">
          <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Effort - {selectedModel?.label ?? "model"}
          </DropdownMenuLabel>
          {effortOptions.map(option => {
            const selected = option === selectedEffortId;
            return (
              <DropdownMenuItem
                key={option}
                disabled={disabled}
                onSelect={event => {
                  event.preventDefault();
                  onEffortChange(option);
                }}
                className="flex items-center gap-2 py-1.5"
              >
                <span className="grid size-4 shrink-0 place-items-center">
                  {selected ? (
                    <Check className="size-4 text-primary" />
                  ) : null}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {EFFORT_LABELS[option]}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default PromptModelControls;
