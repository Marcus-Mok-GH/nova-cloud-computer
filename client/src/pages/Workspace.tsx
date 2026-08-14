/** Nova workspace: an authenticated, persistent project and task control room. */
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Check, Circle, ClipboardList, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

type TaskState = "todo" | "in_progress" | "done";

const statusCopy: Record<TaskState, { label: string; className: string }> = {
  todo: { label: "To do", className: "bg-stone-100 text-stone-600 dark:bg-white/10 dark:text-stone-300" },
  in_progress: { label: "In progress", className: "bg-amber-100 text-amber-800 dark:bg-amber-300/15 dark:text-amber-100" },
  done: { label: "Done", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-300/15 dark:text-emerald-100" },
};

function TaskStatusButton({ status, onClick }: { status: TaskState; onClick: () => void }) {
  const active = statusCopy[status];
  return <button type="button" onClick={onClick} title="Advance task status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors ${active.className}`}>{status === "done" ? <Check size={12} /> : <Circle size={11} />} {active.label}</button>;
}

export default function Workspace() {
  const utils = trpc.useUtils();
  const dashboard = trpc.workspace.dashboard.useQuery(undefined, { retry: false });
  const [projectOpen, setProjectOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [taskProjectId, setTaskProjectId] = useState("");

  const projects = dashboard.data?.projects ?? [];
  const tasks = dashboard.data?.tasks ?? [];
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);
  const openTasks = tasks.filter(task => task.status !== "done");
  const completedTasks = tasks.filter(task => task.status === "done");

  const refresh = async () => { await utils.workspace.dashboard.invalidate(); };
  const createProject = trpc.projects.create.useMutation({ onSuccess: async project => { await refresh(); setProjectName(""); setProjectDescription(""); setProjectOpen(false); setTaskProjectId(String(project.id)); toast.success("Project created in your Nova space."); }, onError: error => toast.error(error.message) });
  const createTask = trpc.tasks.create.useMutation({ onSuccess: async () => { await refresh(); setTaskTitle(""); setTaskNotes(""); setTaskOpen(false); toast.success("Task added to your Nova space."); }, onError: error => toast.error(error.message) });
  const updateTask = trpc.tasks.updateStatus.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const removeTask = trpc.tasks.delete.useMutation({ onSuccess: async () => { await refresh(); toast.success("Task removed."); }, onError: error => toast.error(error.message) });

  const submitProject = (event: FormEvent) => { event.preventDefault(); createProject.mutate({ name: projectName, description: projectDescription || null }); };
  const submitTask = (event: FormEvent) => { event.preventDefault(); if (!taskProjectId) { toast.error("Create a project first, then choose it for this task."); return; } createTask.mutate({ projectId: Number(taskProjectId), title: taskTitle, notes: taskNotes || null }); };
  const nextStatus = (status: TaskState): TaskState => status === "todo" ? "in_progress" : status === "in_progress" ? "done" : "todo";

  if (dashboard.isError) {
    return <DashboardLayout><div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center"><section className="rounded-3xl border bg-card p-8 text-center shadow-sm"><Sparkles className="mx-auto text-[#75a79a]" size={24} /><p className="mt-4 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Your space is taking a breath</p><h1 className="mt-2 font-[DM_Serif_Display] text-3xl">Nova couldn’t load this workspace.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Your data has not been changed. Check your connection, then try loading the space again.</p><Button className="mt-6" onClick={() => dashboard.refetch()}>Try again</Button></section></div></DashboardLayout>;
  }

  return <DashboardLayout>
    <div className="mx-auto max-w-6xl space-y-7 pb-12 pt-3">
      <section className="relative overflow-hidden rounded-3xl border border-stone-200 bg-[#f2f2ea] px-6 py-8 shadow-sm dark:border-white/10 dark:bg-[#1d292a] sm:px-9 sm:py-10">
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#b6d7d0]/60 blur-3xl dark:bg-[#3d807a]/35" /><div className="absolute -bottom-28 left-1/4 h-48 w-48 rounded-full bg-[#f1c6b4]/50 blur-3xl dark:bg-[#a66055]/25" />
        <div className="relative flex flex-col justify-between gap-6 sm:flex-row sm:items-end"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-stone-500 dark:text-stone-300">Your persistent workspace</p><h1 className="mt-3 font-[DM_Serif_Display] text-4xl tracking-tight text-stone-800 dark:text-stone-100 sm:text-5xl">{dashboard.data?.workspace.name ?? "Your Nova Space"}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-stone-600 dark:text-stone-300">A private place for the projects and next actions that matter right now.</p></div><div className="flex flex-wrap gap-2"><ProjectDialog open={projectOpen} onOpenChange={setProjectOpen} name={projectName} description={projectDescription} onNameChange={setProjectName} onDescriptionChange={setProjectDescription} onSubmit={submitProject} loading={createProject.isPending} /><TaskDialog open={taskOpen} onOpenChange={setTaskOpen} title={taskTitle} notes={taskNotes} projectId={taskProjectId} projects={projects} onTitleChange={setTaskTitle} onNotesChange={setTaskNotes} onProjectChange={setTaskProjectId} onSubmit={submitTask} loading={createTask.isPending} disabled={!projects.length} /></div></div>
      </section>

      {dashboard.isLoading ? <div className="flex min-h-64 items-center justify-center rounded-3xl border border-dashed"><Loader2 className="animate-spin text-muted-foreground" /></div> : <>
        <section className="grid gap-4 md:grid-cols-3"><StatCard icon={<ClipboardList size={17} />} label="Active projects" value={projects.filter(project => project.status === "active").length} detail="Containers for your work" /><StatCard icon={<Circle size={16} />} label="Open tasks" value={openTasks.length} detail="The next useful moves" /><StatCard icon={<Check size={17} />} label="Completed" value={completedTasks.length} detail="Small proof of progress" /></section>
        <section className="grid gap-7 lg:grid-cols-[1.35fr_.65fr]"><div className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Today</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Your next moves</h2></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">{openTasks.length} open</span></div>{openTasks.length ? <div className="space-y-2">{openTasks.map(task => <TaskRow key={task.id} task={task} projectName={projectById.get(task.projectId)?.name ?? "Project"} onAdvance={() => updateTask.mutate({ id: task.id, status: nextStatus(task.status) })} onRemove={() => removeTask.mutate({ id: task.id })} busy={updateTask.isPending || removeTask.isPending} />)}</div> : <EmptyTasks onAdd={() => setTaskOpen(true)} disabled={!projects.length} />}</div>
        <aside className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-6"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Projects</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Work in orbit</h2><div className="mt-5 space-y-3">{projects.length ? projects.map(project => { const total = tasks.filter(task => task.projectId === project.id).length; const done = tasks.filter(task => task.projectId === project.id && task.status === "done").length; return <article key={project.id} className="rounded-2xl border border-border/70 bg-muted/35 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold">{project.name}</h3>{project.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{project.description}</p>}</div><Sparkles size={15} className="mt-0.5 text-[#739f95]" /></div><div className="mt-4 flex items-center justify-between text-[10px] font-semibold text-muted-foreground"><span>{done} / {total} complete</span><span className="text-[#5d887f]">Active</span></div></article>; }) : <div className="rounded-2xl border border-dashed p-5 text-sm leading-6 text-muted-foreground">Create a project to give your first task a home.</div>}</div></aside></section>
      </>}
    </div>
  </DashboardLayout>;
}

function StatCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: number; detail: string }) { return <article className="rounded-2xl border bg-card p-5 text-card-foreground shadow-sm"><div className="flex items-center gap-2 text-[#638f84]">{icon}<span className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{label}</span></div><p className="mt-3 font-[DM_Serif_Display] text-4xl leading-none">{value}</p><p className="mt-2 text-xs text-muted-foreground">{detail}</p></article>; }

function TaskRow({ task, projectName, onAdvance, onRemove, busy }: { task: { id: number; title: string; status: TaskState; notes: string | null }; projectName: string; onAdvance: () => void; onRemove: () => void; busy: boolean }) { return <article className="group flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-3 transition-colors hover:bg-muted/35"><TaskStatusButton status={task.status} onClick={onAdvance} /><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-bold">{task.title}</h3><p className="mt-1 truncate text-xs text-muted-foreground">{projectName}{task.notes ? ` · ${task.notes}` : ""}</p></div><button type="button" onClick={onRemove} disabled={busy} aria-label={`Remove ${task.title}`} className="rounded-lg p-2 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 group-hover:opacity-100"><Trash2 size={15} /></button></article>; }

function EmptyTasks({ onAdd, disabled }: { onAdd: () => void; disabled: boolean }) { return <div className="rounded-2xl border border-dashed px-5 py-11 text-center"><Sparkles className="mx-auto text-[#75a79a]" size={22} /><h3 className="mt-3 font-[DM_Serif_Display] text-2xl">A clear canvas.</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{disabled ? "Begin by naming a project. Then add the first small action that will move it forward." : "Add the next small action that will help your work take shape."}</p><Button className="mt-5" onClick={onAdd} disabled={disabled}><Plus size={15} /> Add a task</Button></div>; }

function ProjectDialog({ open, onOpenChange, name, description, onNameChange, onDescriptionChange, onSubmit, loading }: { open: boolean; onOpenChange: (open: boolean) => void; name: string; description: string; onNameChange: (value: string) => void; onDescriptionChange: (value: string) => void; onSubmit: (event: FormEvent) => void; loading: boolean }) { return <Dialog open={open} onOpenChange={onOpenChange}><DialogTrigger asChild><Button variant="outline" className="rounded-full"><Plus size={15} /> New project</Button></DialogTrigger><DialogContent><form onSubmit={onSubmit}><DialogHeader><DialogTitle className="font-[DM_Serif_Display] text-3xl">Name a project</DialogTitle><DialogDescription>Give the work a useful home. You can add its first task next.</DialogDescription></DialogHeader><div className="mt-5 space-y-4"><div className="space-y-2"><Label htmlFor="project-name">Project name</Label><Input id="project-name" value={name} onChange={event => onNameChange(event.target.value)} placeholder="A thoughtful project" required maxLength={160} /></div><div className="space-y-2"><Label htmlFor="project-description">A little context <span className="text-muted-foreground">(optional)</span></Label><Textarea id="project-description" value={description} onChange={event => onDescriptionChange(event.target.value)} placeholder="What would make this feel complete?" maxLength={2000} /></div></div><DialogFooter className="mt-6"><Button type="submit" disabled={loading}>{loading && <Loader2 className="animate-spin" size={15} />} Create project</Button></DialogFooter></form></DialogContent></Dialog>; }

function TaskDialog({ open, onOpenChange, title, notes, projectId, projects, onTitleChange, onNotesChange, onProjectChange, onSubmit, loading, disabled }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; notes: string; projectId: string; projects: { id: number; name: string }[]; onTitleChange: (value: string) => void; onNotesChange: (value: string) => void; onProjectChange: (value: string) => void; onSubmit: (event: FormEvent) => void; loading: boolean; disabled: boolean }) { return <Dialog open={open} onOpenChange={onOpenChange}><DialogTrigger asChild><Button className="rounded-full" disabled={disabled}><Plus size={15} /> Add task</Button></DialogTrigger><DialogContent><form onSubmit={onSubmit}><DialogHeader><DialogTitle className="font-[DM_Serif_Display] text-3xl">Add a next move</DialogTitle><DialogDescription>Tasks stay private to this Nova space and can be moved through their status whenever you are ready.</DialogDescription></DialogHeader><div className="mt-5 space-y-4"><div className="space-y-2"><Label htmlFor="task-project">Project</Label><select id="task-project" value={projectId} onChange={event => onProjectChange(event.target.value)} required className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"><option value="">Choose a project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div><div className="space-y-2"><Label htmlFor="task-title">Task</Label><Input id="task-title" value={title} onChange={event => onTitleChange(event.target.value)} placeholder="The next useful thing" required maxLength={240} /></div><div className="space-y-2"><Label htmlFor="task-notes">Note <span className="text-muted-foreground">(optional)</span></Label><Textarea id="task-notes" value={notes} onChange={event => onNotesChange(event.target.value)} placeholder="A little clarity for later" maxLength={4000} /></div></div><DialogFooter className="mt-6"><Button type="submit" disabled={loading}>{loading && <Loader2 className="animate-spin" size={15} />} Add task</Button></DialogFooter></form></DialogContent></Dialog>; }
