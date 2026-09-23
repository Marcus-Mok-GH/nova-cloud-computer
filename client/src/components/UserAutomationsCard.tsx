import React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Clock, Loader2, Sparkles, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type ExistingAutomation = {
  id: number;
  name: string;
  frequency: string;
  scheduleCron: string | null;
  scheduleTimezone: string | null;
  enabled: boolean;
  scheduleActive: boolean;
  lastRunAt: string | null;
  lastError: string | null;
};

const FREQUENCY_LABELS: Record<string, string> = { hourly: "Hourly", daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", custom: "Custom schedule" };

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function UserAutomationsCard() {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [clarification, setClarification] = useState("");
  const [createdSummary, setCreatedSummary] = useState("");
  const [automations, setAutomations] = useState<ExistingAutomation[]>([]);
  const [automationsError, setAutomationsError] = useState("");

  const loadAutomations = async () => {
    try {
      const response = await fetch("/api/user-automations");
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error();
      setAutomations(Array.isArray(data) ? data : []);
      setAutomationsError("");
    } catch {
      setAutomationsError("Could not load your automations.");
    }
  };

  useEffect(() => { void loadAutomations(); }, []);

  const submit = async () => {
    const value = prompt.trim();
    if (value.length < 3) { toast.error("Tell Nova what you want the automation to do."); return; }
    if (value.length > 8000) { toast.error("Keep the automation request under 8,000 characters."); return; }
    setRunning(true); setClarification(""); setCreatedSummary("");
    try {
      const response = await fetch("/api/user-automations/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Nova could not create the automation.");
      if (!data.created) {
        const question = data.clarification || data.plan?.clarificationQuestion || "I need one more detail before I can safely schedule this.";
        setClarification(question); toast.info(question); return;
      }
      const automation = data.automation;
      setCreatedSummary(`${automation?.name || "Automation"} · ${data.plan?.scheduleHuman || "scheduled"}`);
      setPrompt("");
      toast.success("Automation created and scheduled.");
      void loadAutomations();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Nova could not create the automation."); }
    finally { setRunning(false); }
  };

  return <section className="rounded-2xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Automations</p><h2 className="mt-1 text-xl font-bold tracking-tight">Tell Nova what to automate</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Describe the job naturally. Nova will turn it into a structured automation with a schedule, reusable arguments, an execution prompt, safety constraints, and a recurring background job.</p></div>
      <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Zap size={22} /></div>
    </div>
    <div className="mt-6 rounded-2xl border bg-muted/20 p-5">
      <div className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /><p className="text-sm font-bold">What should Nova do?</p></div>
      <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }} disabled={running} className="mt-4 min-h-36 resize-y" maxLength={8000} placeholder="For example: Every weekday at 9 AM, review my workspace files, find anything that looks unfinished, and create a concise report with suggested next steps." />
      <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] text-muted-foreground">Include when it should run, what it should do, and any limits or preferences. Ctrl/Cmd + Enter also submits.</p><Button onClick={() => void submit()} disabled={running || prompt.trim().length < 3} className="shrink-0 gap-2">{running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Enter</Button></div>
    </div>
    {clarification && <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"><p className="text-xs font-bold text-amber-800 dark:text-amber-300">Nova needs one detail</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{clarification}</p></div>}
    {createdSummary && <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4"><p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">Automation created</p><p className="mt-1 text-sm text-muted-foreground">{createdSummary}</p></div>}
    {(automations.length > 0 || automationsError) && <div className="mt-6">
      <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Your automations</p>
      {automationsError && <p className="mt-2 text-sm text-muted-foreground">{automationsError}</p>}
      <div className="mt-2 flex flex-col gap-2">
        {automations.map(automation => <div key={automation.id} className="flex flex-col justify-between gap-2 rounded-2xl border bg-muted/20 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-bold">{automation.name}</p>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${automation.enabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{automation.enabled ? "Scheduled" : "Paused"}</span>
            </div>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3 shrink-0" />{FREQUENCY_LABELS[automation.frequency] || automation.frequency}{automation.scheduleTimezone ? ` · ${automation.scheduleTimezone}` : ""} · last run {relativeTime(automation.lastRunAt)}</p>
            {automation.lastError && <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{automation.lastError}</p>}
          </div>
        </div>)}
      </div>
    </div>}
  </section>;
}
