import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Check, Loader2, Plus, Trash2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Frequency = "hourly" | "daily" | "weekdays" | "weekly";
type Automation = { id: number; name: string; instructions: string; frequency: Frequency; enabled: boolean; scheduleActive: boolean; lastRunAt: string | null; lastError: string | null };

const frequencyLabels: Record<Frequency, string> = { hourly: "Every hour", daily: "Every day", weekdays: "Weekdays", weekly: "Every week" };

async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Automation request failed.");
  return data;
}

export default function UserAutomationsCard() {
  const [items, setItems] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("daily");

  const load = async () => {
    try { setLoading(true); setItems(await api("/api/user-automations")); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not load automations."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!name.trim() || instructions.trim().length < 3) { toast.error("Add a name and describe what Nova should do."); return; }
    try { setSaving(true); const created = await api("/api/user-automations", { method: "POST", body: JSON.stringify({ name, instructions, frequency }) }); setItems(current => [...current, created]); setName(""); setInstructions(""); setFrequency("daily"); toast.success("Automation created."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not create automation."); }
    finally { setSaving(false); }
  };

  const update = async (id: number, patch: Partial<Automation>) => {
    try { const updated = await api(`/api/user-automations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); setItems(current => current.map(item => item.id === id ? updated : item)); toast.success(patch.enabled === false ? "Automation paused." : patch.enabled === true ? "Automation enabled." : "Automation saved."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not update automation."); }
  };

  const remove = async (id: number) => {
    try { await api(`/api/user-automations/${id}`, { method: "DELETE" }); setItems(current => current.filter(item => item.id !== id)); toast.success("Automation deleted."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete automation."); }
  };

  return <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Automations</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Build your own automations</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Create recurring instructions for Nova. Each automation runs privately for your workspace and saves its report as a file.</p></div>
      <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#e4f0eb] text-[#42665d] dark:bg-[#28473f] dark:text-[#c5e1d6]"><Zap size={22} /></div>
    </div>

    <div className="mt-6 rounded-2xl border bg-muted/20 p-5">
      <p className="text-sm font-bold">Create an automation</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_180px]">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Automation name, e.g. Weekly project review" maxLength={120} />
        <select value={frequency} onChange={e => setFrequency(e.target.value as Frequency)} className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">{Object.entries(frequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </div>
      <Textarea value={instructions} onChange={e => setInstructions(e.target.value)} className="mt-4 min-h-28" maxLength={8000} placeholder="Tell Nova exactly what you want it to do on each run. For example: Review my recent workspace activity and create a concise progress report with unfinished tasks and suggested next steps." />
      <div className="mt-4 flex justify-end"><Button onClick={create} disabled={saving || !name.trim() || instructions.trim().length < 3} className="gap-2">{saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create automation</Button></div>
    </div>

    <div className="mt-5 space-y-3">
      {loading ? <div className="flex items-center justify-center rounded-2xl border p-8 text-muted-foreground"><Loader2 className="animate-spin" size={18} /></div> : items.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center"><Zap className="mx-auto text-muted-foreground" size={22} /><p className="mt-3 text-sm font-bold">No automations yet</p><p className="mt-1 text-xs text-muted-foreground">Create one above and Nova will keep it running on your schedule.</p></div> : items.map(item => <AutomationRow key={item.id} item={item} onUpdate={update} onDelete={remove} />)}
    </div>
  </section>;
}

function AutomationRow({ item, onUpdate, onDelete }: { item: Automation; onUpdate: (id: number, patch: Partial<Automation>) => void; onDelete: (id: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [instructions, setInstructions] = useState(item.instructions);
  const [frequency, setFrequency] = useState<Frequency>(item.frequency);
  useEffect(() => { setName(item.name); setInstructions(item.instructions); setFrequency(item.frequency); }, [item]);
  return <div className="rounded-2xl border bg-muted/20 p-4">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-bold">{item.name}</p><span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${item.enabled ? "bg-[#e4f0eb] text-[#42665d]" : "bg-muted text-muted-foreground"}`}>{item.enabled ? <><Check size={11} /> Enabled</> : "Paused"}</span></div><p className="mt-1 text-xs text-muted-foreground">{frequencyLabels[item.frequency]}{item.lastRunAt ? ` · Last run ${new Date(item.lastRunAt).toLocaleString()}` : " · Never run"}</p>{item.lastError && <p className="mt-2 flex gap-1 text-xs text-destructive"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{item.lastError}</p>}</div>
      <div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(value => !value)}>{editing ? "Close" : "Edit"}</Button><Button variant={item.enabled ? "outline" : "default"} size="sm" onClick={() => onUpdate(item.id, { enabled: !item.enabled })}>{item.enabled ? "Pause" : "Enable"}</Button><Button variant="ghost" size="icon" onClick={() => onDelete(item.id)} aria-label={`Delete ${item.name}`} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button></div>
    </div>
    {editing && <div className="mt-4 border-t pt-4"><div className="grid gap-3 lg:grid-cols-[1fr_180px]"><Input value={name} onChange={e => setName(e.target.value)} maxLength={120} /><select value={frequency} onChange={e => setFrequency(e.target.value as Frequency)} className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">{Object.entries(frequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><Textarea value={instructions} onChange={e => setInstructions(e.target.value)} className="mt-3 min-h-24" maxLength={8000} /><div className="mt-3 flex justify-end"><Button size="sm" onClick={() => { onUpdate(item.id, { name: name.trim(), instructions: instructions.trim(), frequency }); setEditing(false); }}>Save changes</Button></div></div>}
  </div>;
}
