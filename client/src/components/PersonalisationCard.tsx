/** Personalisation: tune how Nova works with the user through structured controls, a distilled profile, and a guided setup chat. */
import React, { useEffect, useState } from "react";
import { Brain, Loader2, MessagesSquare, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

const DETAIL_OPTIONS = [
  { value: "brief", label: "Brief - just the essentials" },
  { value: "balanced", label: "Balanced - context where it helps" },
  { value: "detailed", label: "Detailed - explain the reasoning" },
] as const;
const PROACTIVENESS_OPTIONS = [
  { value: "ask_first", label: "Ask me before acting" },
  { value: "act_and_tell", label: "Act, then tell me what you did" },
  { value: "autonomous", label: "Work fully autonomously" },
] as const;
const EXPERTISE_OPTIONS = [
  { value: "new", label: "New to this - explain as you go" },
  { value: "some", label: "Familiar - skip the basics" },
  { value: "expert", label: "Expert - keep it terse" },
] as const;

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
      toast.success("Personalisation saved.");
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
        title: "Personalisation setup",
      });
      window.location.assign(`/app?chatId=${chat.id}&personalise=1`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Nova could not start the setup chat."
      );
    }
  };

  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
            Personalisation
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">
            Tune Nova to how you work
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Tell Nova what you want and it learns the rest. Set your preferences
            below, or let Nova interview you and build your profile for you.
          </p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          <Brain size={24} />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4">
        <div>
          <p className="text-sm font-bold">Personalisation mode</p>
          <p className="text-xs text-muted-foreground">
            Let Nova notice lasting preferences while you work and save them, so
            every future reply fits you better.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Personalisation mode"
        />
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="personalisation-tone">Preferred tone</Label>
          <Input
            id="personalisation-tone"
            value={tone}
            onChange={event => setTone(event.target.value)}
            placeholder="e.g. warm and encouraging"
            maxLength={60}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="personalisation-detail">Reply length</Label>
          <select
            id="personalisation-detail"
            className={selectClass}
            value={detail}
            onChange={event => setDetail(event.target.value as Detail | "")}
          >
            <option value="">No preference</option>
            {DETAIL_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="personalisation-proactiveness">Collaboration style</Label>
          <select
            id="personalisation-proactiveness"
            className={selectClass}
            value={proactiveness}
            onChange={event =>
              setProactiveness(event.target.value as Proactiveness | "")
            }
          >
            <option value="">No preference</option>
            {PROACTIVENESS_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="personalisation-expertise">Your expertise</Label>
          <select
            id="personalisation-expertise"
            className={selectClass}
            value={expertise}
            onChange={event =>
              setExpertise(event.target.value as Expertise | "")
            }
          >
            <option value="">No preference</option>
            {EXPERTISE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <Label htmlFor="personalisation-profile">
          What Nova knows about you
        </Label>
        <Textarea
          id="personalisation-profile"
          className="min-h-32 resize-y"
          value={profile}
          onChange={event => setProfile(event.target.value)}
          placeholder="Nova fills this in during a guided setup, or you can write it yourself - your role, goals, and what matters to you."
          maxLength={2000}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={savePreferences} disabled={save.isPending}>
          {save.isPending && <Loader2 size={15} className="animate-spin" />}
          Save preferences
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
          Start guided setup
        </Button>
      </div>

      <div className="mt-5 flex items-start gap-2 rounded-2xl border border-dashed bg-muted/10 p-4 text-xs leading-5 text-muted-foreground">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          <Wand2 size={12} className="mr-1 inline" />
          Guided setup opens a real chat where Nova asks a few questions, saves
          what it learns, and turns personalisation mode on. You can revise
          anything here afterwards.
        </span>
      </div>
    </section>
  );
}
