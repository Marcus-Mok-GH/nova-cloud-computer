/**
 * The composer's personality picker — the control that used to be the inert
 * "My Nova ▾" label. It selects the active personality for the workspace;
 * creating and editing personalities happens only in Settings >
 * Personalisation, so this menu never grows an editor. Default is always
 * present and always first.
 */
import React from "react";
import { Check, ChevronDown, Loader2, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  DEFAULT_PERSONALITY,
  DEFAULT_PERSONALITY_ID,
  personalityChips,
  type Personality,
} from "@shared/personalities";
import { useLocation } from "wouter";

/** The selected personality, or Default while the list is still loading. */
export function useActivePersonality(): {
  personalities: Personality[];
  active: Personality;
  activeId: string;
  isLoading: boolean;
} {
  const query = trpc.workspace.personalities.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const personalities = query.data?.personalities ?? [DEFAULT_PERSONALITY];
  const activeId = query.data?.activePersonalityId ?? DEFAULT_PERSONALITY_ID;
  const active =
    personalities.find(personality => personality.id === activeId) ??
    DEFAULT_PERSONALITY;
  return { personalities, active, activeId, isLoading: query.isLoading };
}

export function PersonalitySelector() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { personalities, active, activeId, isLoading } = useActivePersonality();
  const setActive = trpc.workspace.setActivePersonality.useMutation({
    onSuccess: async () => {
      await utils.workspace.personalities.invalidate();
    },
    onError: error => toast.error(error.message || t("composer.personality.error")),
  });

  const choose = (personality: Personality) => {
    if (personality.id === activeId) return;
    setActive.mutate({ personalityId: personality.id });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isLoading}
        aria-label={t("composer.personality.aria")}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <>
            <span className="grid size-6 place-items-center rounded-lg bg-foreground text-background">
              <Sparkles className="size-3.5" />
            </span>
            <span className="max-w-[8rem] truncate">{active.name}</span>
            <ChevronDown className="size-3.5" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-80">
        <PersonalityOptions
          personalities={personalities}
          activeId={activeId}
          busy={setActive.isPending}
          onChoose={choose}
          onManage={() => setLocation("/app/settings?tab=personalisation")}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The picker's list, split out of the dropdown so it can be rendered and
 * asserted on its own (a closed Radix menu renders no content at all, so the
 * menu body is otherwise untestable in a static render).
 */
export function PersonalityOptions({
  personalities,
  activeId,
  busy,
  onChoose,
  onManage,
}: {
  personalities: Personality[];
  activeId: string;
  busy: boolean;
  onChoose: (personality: Personality) => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {t("composer.personality.menuLabel")}
      </DropdownMenuLabel>
      {personalities.map(personality => {
        const selected = personality.id === activeId;
        const chips = personalityChips(personality);
        return (
          <DropdownMenuItem
            key={personality.id}
            disabled={busy}
            onSelect={event => {
              event.preventDefault();
              onChoose(personality);
            }}
            className="flex items-start gap-2.5 py-2"
          >
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
              {selected ? <Check className="size-4 text-primary" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                {personality.name}
                {personality.builtIn && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t("composer.personality.builtIn")}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                {personality.instructions ||
                  personality.description ||
                  chips.join(" · ")}
              </span>
              {personality.instructions && chips.length > 0 && (
                <span className="mt-1 block text-[11px] text-muted-foreground/80">
                  {chips.join(" · ")}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        );
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={event => {
          event.preventDefault();
          onManage();
        }}
        className="flex items-center gap-2 py-2 text-xs font-semibold text-muted-foreground"
      >
        <Sparkles className="size-3.5" />
        {t("composer.personality.manage")}
      </DropdownMenuItem>
    </>
  );
}

export default PersonalitySelector;