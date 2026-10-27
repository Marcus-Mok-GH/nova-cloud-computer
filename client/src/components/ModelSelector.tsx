/**
 * The chat composer's model picker. Free accounts see the whole catalogue but
 * the premium entries are locked; choosing one starts Whop checkout instead of
 * switching the model. The selection is persisted per chat by
 * `chats.setModel`, and the server re-checks the plan on every set, so the lock
 * here is presentation only.
 */
import React, { useState } from "react";
import { Check, ChevronDown, Crown, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import type { ChatModel } from "@shared/models";

function modelLabel(models: ChatModel[], id: string | undefined) {
  return models.find(model => model.id === id)?.label ?? "Nova Pro";
}

export function ModelSelector({ chatId }: { chatId: string }) {
  const utils = trpc.useUtils();
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const catalogue = trpc.chats.models.useQuery({ chatId }, { retry: false });

  const checkout = trpc.billing.createCheckout.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: error => {
      setOpeningCheckout(false);
      toast.error(error.message);
    },
  });

  const setModel = trpc.chats.setModel.useMutation({
    onSuccess: async () => {
      await utils.chats.models.invalidate({ chatId });
    },
    onError: error => toast.error(error.message),
  });

  const models = catalogue.data?.models ?? [];
  const current = catalogue.data?.current;
  const isPaid = catalogue.data?.plan === "paid";
  const busy = setModel.isPending || openingCheckout;

  const choose = (model: ChatModel) => {
    if (model.tier === "pro" && !isPaid) {
      setOpeningCheckout(true);
      checkout.mutate({ redirectUrl: window.location.href });
      return;
    }
    if (model.id === current) return;
    setModel.mutate({ chatId, model: model.id });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={catalogue.isLoading}
        aria-label="Choose model"
        className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50 dark:hover:bg-white/[0.08]"
      >
        {catalogue.isLoading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <>
            {isPaid && current !== "nova-pro" && (
              <Crown className="size-3.5 text-amber-500" />
            )}
            <span className="max-w-[9rem] truncate">
              {modelLabel(models, current)}
            </span>
            <ChevronDown className="size-3.5 opacity-60" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-72">
        <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {isPaid ? "Nova Pro subscription active" : "Models"}
        </DropdownMenuLabel>
        {models.map(model => {
          const locked = model.tier === "pro" && !isPaid;
          const selected = model.id === current;
          return (
            <DropdownMenuItem
              key={model.id}
              disabled={busy}
              onSelect={event => {
                event.preventDefault();
                choose(model);
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
                Nova Pro unlocks every premium model, 10,000 credits a month,
                and unused credits roll over.
              </p>
              <button
                type="button"
                disabled={openingCheckout || checkout.isPending}
                onClick={() => {
                  setOpeningCheckout(true);
                  checkout.mutate({ redirectUrl: window.location.href });
                }}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-3 py-2 text-xs font-bold text-background transition hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-black"
              >
                {openingCheckout || checkout.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Crown className="size-3.5" />
                )}
                Upgrade - $7.99/month
              </button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ModelSelector;
