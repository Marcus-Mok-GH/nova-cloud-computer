/** Personalisation: tune how Nova works with the user through structured controls, a distilled profile, and a guided setup chat. */
import React, { useEffect, useState } from "react";
import { Brain, Loader2, MessagesSquare, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/i18n";
import { trpc } from "@/lib/trpc";

const DETAIL_OPTIONS = [
  { value: "brief", labelKey: "settings.personalisation.detail.brief" },
  { value: "balanced", labelKey: "settings.personalisation.detail.balanced" },
  { value: "detailed", labelKey: "settings.personalisation.detail.detailed" },
] as const satisfies ReadonlyArray<{ value: string; labelKey: TranslationKey }>;
const PROACTIVENESS_OPTIONS = [
  { value: "ask_first", labelKey: "settings.personalisation.collab.askFirst" },
  { value: "act_and_tell", labelKey: "settings.personalisation.collab.actAndTell" },
  { value: "autonomous", labelKey: "settings.personalisation.collab.autonomous" },
] as const satisfies ReadonlyArray<{ value: string; labelKey: TranslationKey }>;
const EXPERTISE_OPTIONS = [
  { value: "new", labelKey: "settings.personalisation.expertise.new" },
  { value: "some", labelKey: "settings.personalisation.expertise.some" },
  { value: "expert", labelKey: "settings.personalisation.expertise.expert" },
] as const satisfies ReadonlyArray<{ value: string; labelKey: TranslationKey }>;

type Detail = (typeof DETAIL_OPTIONS)[number]["value"];
type Proactiveness = (typeof PROACTIVENESS_OPTIONS)[number]["value"];
type Expertise = (typeof EXPERTISE_OPTIONS)[number]["value"];

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60";

/**
 * The Personalisation tab body. Users can flip the mode on, set structured
 * preferences by hand, edit the profile the agent built, or open a real chat
 * with Nova to be interviewed and have the profile written for them.
 */
export default function PersonalisationCard() {
  const utils = trpc.useUtils();
  const { t } = useTranslation();
  const settings = trpc.workspace.modelSettings.useQuery(undefined, {
    retry: false,
  });
  const [enabled, setEnabled] = useState(false);
  const [profile, setProfile] = useState("");
  const [tone, setTone] = useState("");
  const [detail, setDetail] = useState<Detail | "">("");
  const [proactiveness, setProactiveness] = useState<Proactiveness | "">("");
  const [expertise, setExpertise] = useState<Expertise | "">("");

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.personalisationEnabled ?? false);
    setProfile(settings.data.personalisationProfile ?? "");
    setTone(settings.data.personalisationTone ?? "");
    setDetail((settings.data.personalisationDetail as Detail | null) ?? "");
    setProactiveness(
      (settings.data.personalisationProactiveness as Proactiveness | null) ?? ""
    );
    setExpertise(
      (settings.data.personalisationExpertise as Expertise | null) ?? ""
    );
  }, [settings.data]);

  const save = trpc.workspace.updateSettings.useMutation({
    onSuccess: async () => {
      await utils.workspace.modelSettings.invalidate();
      toast.success(t("settings.personalisation.saved"));
    },
    onError: error => toast.error(error.message),
  });
  const createChat = trpc.chats.create.useMutation();

  const savePreferences = () =>
    save.mutate({
      personalisationEnabled: enabled,
      personalisationProfile: profile.trim() || null,
      personalisationTone: tone.trim() || null,
      personalisationDetail: detail || null,
      personalisationProactiveness: proactiveness || null,
      personalisationExpertise: expertise || null,
    });

  const startGuidedSetup = async () => {
    try {
      // Save what is on screen first, and switch the mode on, so the agent
      // starts the interview from the user's latest intent.
      await save.mutateAsync({
        personalisationEnabled: true,
        personalisationProfile: profile.trim() || null,
        personalisationTone: tone.trim() || null,
        personalisationDetail: detail || null,
        personalisationProactiveness: proactiveness || null,
        personalisationExpertise: expertise || null,
      });
      const chat = await createChat.mutateAsync({
        title: t("settings.personalisation.setupChatTitle"),
      });
      window.location.assign(`/app?chatId=${chat.id}&personalise=1`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings.personalisation.setupError")
      );
    }
  };

  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
            {t("settings.personalisation.eyebrow")}
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">
            {t("settings.personalisation.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("settings.personalisation.body")}
          </p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          <Brain size={24} />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4">
        <div>
          <p className="text-sm font-bold">{t("settings.personalisation.mode.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("settings.personalisation.mode.body")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={t("settings.personalisation.mode.title")}
        />
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="personalisation-tone">{t("settings.personalisation.tone.label")}</Label>
          <Input
            id="personalisation-tone"
            value={tone}
            onChange={event => setTone(event.target.value)}
            placeholder={t("settings.personalisation.tone.placeholder")}
            maxLength={60}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="personalisation-detail">{t("settings.personalisation.detail.label")}</Label>
          <select
            id="personalisation-detail"
            className={selectClass}
            value={detail}
            onChange={event => setDetail(event.target.value as Detail | "")}
          >
            <option value="">{t("settings.personalisation.noPreference")}</option>
            {DETAIL_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="personalisation-proactiveness">{t("settings.personalisation.collab.label")}</Label>
          <select
            id="personalisation-proactiveness"
            className={selectClass}
            value={proactiveness}
            onChange={event =>
              setProactiveness(event.target.value as Proactiveness | "")
            }
          >
            <option value="">{t("settings.personalisation.noPreference")}</option>
            {PROACTIVENESS_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="personalisation-expertise">{t("settings.personalisation.expertise.label")}</Label>
          <select
            id="personalisation-expertise"
            className={selectClass}
            value={expertise}
            onChange={event =>
              setExpertise(event.target.value as Expertise | "")
            }
          >
            <option value="">{t("settings.personalisation.noPreference")}</option>
            {EXPERTISE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <Label htmlFor="personalisation-profile">
          {t("settings.personalisation.profile.label")}
        </Label>
        <Textarea
          id="personalisation-profile"
          className="min-h-32 resize-y"
          value={profile}
          onChange={event => setProfile(event.target.value)}
          placeholder={t("settings.personalisation.profile.placeholder")}
          maxLength={2000}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={savePreferences} disabled={save.isPending}>
          {save.isPending && <Loader2 size={15} className="animate-spin" />}
          {t("settings.personalisation.save")}
        </Button>
        <Button
          variant="outline"
          onClick={() => void startGuidedSetup()}
          disabled={createChat.isPending || save.isPending}
        >
          {createChat.isPending || save.isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <MessagesSquare size={15} />
          )}
          {t("settings.personalisation.guided")}
        </Button>
      </div>

      <div className="mt-5 flex items-start gap-2 rounded-2xl border border-dashed bg-muted/10 p-4 text-xs leading-5 text-muted-foreground">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          <Wand2 size={12} className="me-1 inline" />
          {t("settings.personalisation.guided.hint")}
        </span>
      </div>
    </section>
  );
}
