/**
 * Personalities: the named presets the composer's picker selects. This is the
 * only place they are created, edited, or deleted - the composer menu just
 * selects one. Default (Nova's own voice) is built in and cannot be edited or
 * removed, so it is listed read-only at the top.
 */
import React, { useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import {
  PERSONALITY_COLLABORATION_LABELS,
  PERSONALITY_COLLABORATIONS,
  PERSONALITY_DETAIL_LABELS,
  PERSONALITY_DETAILS,
  PERSONALITY_EXPERTISE_LABELS,
  PERSONALITY_EXPERTISES,
  personalityChips,
  type Personality,
} from "@shared/personalities";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60";

type Draft = {
  name: string;
  instructions: string;
  detail: string;
  collaboration: string;
  expertise: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  instructions: "",
  detail: "",
  collaboration: "",
  expertise: "",
};

function draftOf(personality: Personality): Draft {
  return {
    name: personality.name,
    instructions: personality.instructions ?? "",
    detail: personality.detail ?? "",
    collaboration: personality.collaboration ?? "",
    expertise: personality.expertise ?? "",
  };
}

export default function PersonalitiesCard() {
  const utils = trpc.useUtils();
  const { t } = useTranslation();
  const list = trpc.workspace.personalities.useQuery(undefined, {
    retry: false,
  });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  /** The personality being edited, or null when the form creates a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);

  // When a personality is deleted while being edited, drop back to "new".
  const personalities = list.data?.personalities ?? [];
  useEffect(() => {
    if (editingId && !personalities.some(personality => personality.id === editingId)) {
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
    }
  }, [editingId, personalities]);

  const refresh = async () => {
    await utils.workspace.personalities.invalidate();
    await utils.workspace.modelSettings.invalidate();
  };

  const create = trpc.workspace.createPersonality.useMutation({
    onSuccess: async () => {
      setDraft(EMPTY_DRAFT);
      await refresh();
      toast.success(t("settings.personalities.created"));
    },
    onError: error => toast.error(error.message || t("settings.personalities.error")),
  });

  const update = trpc.workspace.updatePersonality.useMutation({
    onSuccess: async () => {
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
      await refresh();
      toast.success(t("settings.personalities.updated"));
    },
    onError: error => toast.error(error.message || t("settings.personalities.error")),
  });

  const remove = trpc.workspace.deletePersonality.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success(t("settings.personalities.deleted"));
    },
    onError: error => toast.error(error.message || t("settings.personalities.error")),
  });

  const activate = trpc.workspace.setActivePersonality.useMutation({
    onSuccess: async () => {
      await refresh();
    },
    onError: error => toast.error(error.message || t("settings.personalities.activeError")),
  });

  const activeId = list.data?.activePersonalityId ?? "default";
  const busy = create.isPending || update.isPending;
  const canSubmit = draft.name.trim().length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    const payload = {
      name: draft.name.trim(),
      instructions: draft.instructions.trim() || null,
      detail: (draft.detail || null) as Personality["detail"],
      collaboration: (draft.collaboration || null) as Personality["collaboration"],
      expertise: (draft.expertise || null) as Personality["expertise"],
    };
    if (editingId) update.mutate({ id: editingId, ...payload });
    else create.mutate(payload);
  };

  const startEdit = (personality: Personality) => {
    setEditingId(personality.id);
    setDraft(draftOf(personality));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
            {t("settings.personalisation.eyebrow")}
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">
            {t("settings.personalities.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("settings.personalities.body")}
          </p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          <Sparkles size={24} />
        </div>
      </div>

      {list.isLoading ? (
        <div className="mt-6 flex justify-center py-8">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {personalities.map(personality => {
            const active = personality.id === activeId;
            const chips = personalityChips(personality);
            return (
              <div
                key={personality.id}
                className={`rounded-2xl border p-4 ${
                  active
                    ? "border-primary/45 bg-primary/[0.04]"
                    : "bg-muted/20"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                      {personality.name}
                      {personality.builtIn && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                          {t("settings.personalities.builtIn")}
                        </span>
                      )}
                      {active && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                          {t("settings.personalities.inUse")}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {personality.instructions ||
                        personality.description ||
                        chips.join(" · ")}
                    </p>
                    {personality.instructions && chips.length > 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground/80">
                        {chips.join(" · ")}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {!active && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => activate.mutate({ personalityId: personality.id })}
                      disabled={activate.isPending}
                    >
                      <Check size={13} />
                      {t("settings.personalities.use")}
                    </Button>
                  )}
                  {!personality.builtIn && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => startEdit(personality)}
                        disabled={busy}
                      >
                        <Pencil size={13} />
                        {t("settings.personalities.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (
                            window.confirm(
                              t("settings.personalities.delete.confirm", {
                                name: personality.name,
                              })
                            )
                          )
                            remove.mutate({ id: personality.id });
                        }}
                        disabled={remove.isPending}
                      >
                        <Trash2 size={13} />
                        {t("settings.personalities.delete")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {personalities.length <= 1 && !list.isLoading && (
        <p className="mt-3 rounded-2xl border border-dashed bg-muted/10 p-4 text-xs text-muted-foreground">
          {t("settings.personalities.empty")}
        </p>
      )}

      {/* Create / edit form */}
      <div className="mt-6 space-y-4 rounded-2xl border bg-muted/20 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-bold">
            {editingId ? (
              <>
                <Pencil size={15} className="text-primary" />
                {t("settings.personalities.editing", {
                  name: draft.name || "…",
                })}
              </>
            ) : (
              <>
                <Plus size={15} className="text-primary" />
                {t("settings.personalities.create")}
              </>
            )}
          </p>
          {editingId && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={cancelEdit}>
              <X size={13} />
              {t("settings.personalities.cancelEdit")}
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="personality-name">
            {t("settings.personalities.name.label")}
          </Label>
          <Input
            id="personality-name"
            value={draft.name}
            onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))}
            placeholder={t("settings.personalities.name.placeholder")}
            maxLength={40}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="personality-instructions">
            {t("settings.personalities.instructions.label")}
          </Label>
          <Textarea
            id="personality-instructions"
            className="min-h-24 resize-y"
            value={draft.instructions}
            onChange={event =>
              setDraft(previous => ({ ...previous, instructions: event.target.value }))
            }
            placeholder={t("settings.personalities.instructions.placeholder")}
            maxLength={600}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="personality-detail">
              {t("settings.personalities.detail.label")}
            </Label>
            <select
              id="personality-detail"
              className={selectClass}
              value={draft.detail}
              onChange={event => setDraft(previous => ({ ...previous, detail: event.target.value }))}
            >
              <option value="">{t("settings.personalities.noPreference")}</option>
              {PERSONALITY_DETAILS.map(value => (
                <option key={value} value={value}>
                  {PERSONALITY_DETAIL_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="personality-collaboration">
              {t("settings.personalities.collaboration.label")}
            </Label>
            <select
              id="personality-collaboration"
              className={selectClass}
              value={draft.collaboration}
              onChange={event =>
                setDraft(previous => ({ ...previous, collaboration: event.target.value }))
              }
            >
              <option value="">{t("settings.personalities.noPreference")}</option>
              {PERSONALITY_COLLABORATIONS.map(value => (
                <option key={value} value={value}>
                  {PERSONALITY_COLLABORATION_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="personality-expertise">
              {t("settings.personalities.expertise.label")}
            </Label>
            <select
              id="personality-expertise"
              className={selectClass}
              value={draft.expertise}
              onChange={event =>
                setDraft(previous => ({ ...previous, expertise: event.target.value }))
              }
            >
              <option value="">{t("settings.personalities.noPreference")}</option>
              {PERSONALITY_EXPERTISES.map(value => (
                <option key={value} value={value}>
                  {PERSONALITY_EXPERTISE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={submit} disabled={!canSubmit}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {editingId
              ? t("settings.personalities.update")
              : t("settings.personalities.create")}
          </Button>
        </div>
      </div>
    </section>
  );
}