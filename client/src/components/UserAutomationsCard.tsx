import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function UserAutomationsCard() {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [clarification, setClarification] = useState("");
  const [createdSummary, setCreatedSummary] = useState("");

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
    } catch (error) { toast.error(error instanceof Error ? error.message : "Nova could not create the automation."); }
    finally { setRunning(false); }
  };

  return <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Automations</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Tell Nova what to automate</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Describe the job naturally. Nova will turn it into a structured automation with a schedule, reusable arguments, an execution prompt, safety constraints, and a recurring background job.</p></div>
      <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#e4f0eb] text-[#42665d] dark:bg-[#28473f] dark:text-[#c5e1d6]"><Zap size={22} /></div>
    </div>
    <div className="mt-6 rounded-2xl border bg-muted/20 p-5">
      <div className="flex items-center gap-2"><Sparkles className="size-4 text-[#638f84]" /><p className="text-sm font-bold">What should Nova do?</p></div>
      <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }} disabled={running} className="mt-4 min-h-36 resize-y" maxLength={8000} placeholder="For example: Every weekday at 9 AM, review my workspace files, find anything that looks unfinished, and create a concise report with suggested next steps." />
      <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] text-muted-foreground">Include when it should run, what it should do, and any limits or preferences. Ctrl/Cmd + Enter also submits.</p><Button onClick={() => void submit()} disabled={running || prompt.trim().length < 3} className="shrink-0 gap-2">{running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Enter</Button></div>
    </div>
    {clarification && <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"><p className="text-xs font-bold text-amber-800 dark:text-amber-300">Nova needs one detail</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{clarification}</p></div>}
    {createdSummary && <div className="mt-4 rounded-2xl border border-[#638f84]/20 bg-[#e4f0eb]/40 p-4"><p className="text-xs font-bold text-[#42665d]">Automation created</p><p className="mt-1 text-sm text-muted-foreground">{createdSummary}</p></div>}
  </section>;
}
