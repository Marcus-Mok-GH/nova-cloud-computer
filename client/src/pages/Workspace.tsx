import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getFolderTrail, getWorkspaceContents } from "@/lib/workspaceBrowser";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  MessageSquareText,
  MoreHorizontal,
  MoveRight,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import React, { FormEvent, useMemo, useState } from "react";
import { useLocation } from "wouter";

const elapsed = (date: Date | undefined) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(date ?? Date.now()).getTime()) / 60000));
  return mins < 2 ? "just now" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
};

export function getAgentVmPollInterval(runs: Array<{ status: string }> | undefined) {
  return runs?.some(run => run.status === "queued" || run.status === "running") ? 1250 : 5000;
}

export default function Workspace() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [vmTask, setVmTask] = useState("");
  const chatId = typeof window === "undefined" ? undefined : Number(new URLSearchParams(window.location.search).get("chatId")) || undefined;
  const folders = computer.data?.folders ?? [];
  const allFiles = computer.data?.files ?? [];
  const visibleContents = useMemo(() => getWorkspaceContents(folders, allFiles, activeFolderId), [activeFolderId, allFiles, folders]);
  const folderTrail = useMemo(() => getFolderTrail(folders, activeFolderId), [activeFolderId, folders]);
  const currentFolder = activeFolderId === null ? undefined : folders.find(folder => folder.id === activeFolderId);
  const savedMessages = trpc.chats.messages.useQuery({ chatId: chatId ?? 1 }, { enabled: Boolean(chatId), retry: false });
  const agentVmStatus = trpc.agentVm.status.useQuery(undefined, { retry: false, refetchInterval: 5000 });
  const agentVmRuns = trpc.agentVm.list.useQuery(undefined, { retry: false, refetchInterval: query => getAgentVmPollInterval(query.state.data) });

  const createFolder = trpc.folders.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: error => toast.error(error.message) });
  const createFile = trpc.files.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: error => toast.error(error.message) });
  const createChat = trpc.chats.create.useMutation({
    onSuccess: chat => {
      utils.workspace.computer.invalidate();
      setLocation(`/app?chatId=${chat.id}`);
    },
    onError: error => toast.error(error.message),
  });
  const renameFolder = trpc.folders.update.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: error => toast.error(error.message) });
  const removeFolder = trpc.folders.delete.useMutation({ onSuccess: () => { setActiveFolderId(null); utils.workspace.computer.invalidate(); }, onError: error => toast.error(error.message) });
  const renameFile = trpc.files.update.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: error => toast.error(error.message) });
  const removeFile = trpc.files.delete.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: error => toast.error(error.message) });
  const send = trpc.chats.send.useMutation({
    onSuccess: result => {
      utils.workspace.computer.invalidate();
      utils.chats.messages.invalidate({ chatId: result.chatId });
    },
    onError: error => toast.error(error.message),
  });
  const startVmRun = trpc.agentVm.start.useMutation({
    onSuccess: result => {
      setVmTask("");
      utils.agentVm.list.invalidate();
      utils.agentVm.status.invalidate();
      utils.workspace.computer.invalidate();
      result.configured ? toast.success(result.message) : toast.message(result.message);
    },
    onError: error => toast.error(error.message),
  });
  const cancelVmRun = trpc.agentVm.cancel.useMutation({
    onSuccess: () => {
      utils.agentVm.list.invalidate();
      toast.success("Agent VM run cancelled.");
    },
    onError: error => toast.error(error.message),
  });

  const make = (kind: "folder" | "file") => {
    const name = window.prompt(`Name this ${kind}`)?.trim();
    if (!name) return;
    if (kind === "folder") createFolder.mutate({ name, parentId: activeFolderId });
    else createFile.mutate({ name, content: "", folderId: activeFolderId });
  };

  const chooseFolder = (excludeId?: number) => {
    const available = folders.filter(folder => folder.id !== excludeId);
    const name = window.prompt(`Move to which folder? Leave blank for Home. Available: ${available.map(folder => folder.name).join(", ")}`)?.trim();
    if (!name) return null;
    const folder = available.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!folder) {
      toast.error("Choose a folder that exists in your workspace.");
      return undefined;
    }
    return folder.id;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || !chatId) return;
    send.mutate({ chatId, content: draft.trim() });
    setDraft("");
  };

  if (computer.isError) return <WorkspaceError onRetry={() => computer.refetch()} />;

  if (chatId) {
    return <DashboardLayout><section className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-4xl flex-col overflow-hidden rounded-[1.45rem] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(57,191,201,0.14),transparent_43%),#111823] shadow-2xl shadow-black/20">
      <header className="flex items-center justify-between border-b border-white/9 px-5 py-4"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={() => setLocation("/app/chats")} className="text-white/55 hover:bg-white/8 hover:text-white"><ArrowLeft className="size-4" /></Button><span className="grid size-8 place-items-center rounded-xl bg-cyan-300 text-slate-950"><MessageSquareText className="size-4" /></span><div><p className="text-sm font-semibold">Nova conversation</p><p className="text-xs text-white/43">Private workspace context</p></div></div><MoreHorizontal className="size-4 text-white/45" /></header>
      <div className="flex flex-1 overflow-y-auto px-6 py-8"><div className="mx-auto flex w-full max-w-2xl flex-col gap-4 self-end">{savedMessages.isLoading ? <p className="text-sm text-white/45">Loading conversation…</p> : savedMessages.data?.map(message => <div key={message.id} className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "ml-auto bg-cyan-300 text-slate-950" : "bg-white/8 text-white/80"}`}>{message.content}</div>)}{send.isPending && <div className="w-fit rounded-2xl bg-white/8 px-4 py-3 text-sm text-white/55">Nova is working…</div>}</div></div>
      <form onSubmit={submit} className="border-t border-white/9 bg-black/10 p-3 sm:p-4"><div className="rounded-2xl border border-white/12 bg-[#0b1018] p-2 focus-within:border-cyan-300/55"><Textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Message Nova about your workspace…" className="min-h-16 resize-none border-0 bg-transparent px-2 py-2 text-sm text-white placeholder:text-white/35 focus-visible:ring-0" /><div className="flex items-center justify-between px-1"><Paperclip className="size-4 text-white/40" /><Button type="submit" disabled={!draft.trim()} className="h-8 rounded-lg bg-cyan-300 px-3 text-xs text-slate-950 hover:bg-cyan-200"><Send className="mr-1.5 size-3.5" />Send</Button></div></div></form>
    </section></DashboardLayout>;
  }

  const vm = agentVmStatus.data;
  const vmCanRun = Boolean(vm?.configured && !vm.allowance.exhausted);
  const itemCount = visibleContents.folders.length + visibleContents.files.length;
  return <DashboardLayout><div className="grid min-h-[calc(100vh-10.5rem)] gap-4 xl:grid-cols-[250px_minmax(0,1fr)_280px]">
    <aside className="rounded-2xl border border-white/9 bg-[#10161f] p-3">
      <div className="mb-3 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/45">Workspace folders</span><Button variant="ghost" size="icon" onClick={() => make("folder")} className="size-7 text-white/55 hover:bg-white/8 hover:text-white"><FolderPlus className="size-4" /></Button></div>
      <div className="space-y-1"><button onClick={() => setActiveFolderId(null)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${activeFolderId === null ? "bg-cyan-300/10 text-cyan-100" : "text-white/62 hover:bg-white/6"}`}><HardDrive className="size-4 text-cyan-300" /><span className="flex-1">Home</span></button>{folders.map(folder => <button key={folder.id} onClick={() => setActiveFolderId(folder.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${activeFolderId === folder.id ? "bg-white/9 text-white" : "text-white/62 hover:bg-white/6"}`}><ChevronRight className="size-3 text-white/28" /><Folder className="size-4 text-amber-200" /><span className="min-w-0 flex-1 truncate">{folder.name}</span></button>)}</div>
      <div className="mt-5 rounded-xl border border-cyan-300/12 bg-cyan-300/[.045] p-3"><p className="text-xs font-medium text-cyan-100">Need a second pair of hands?</p><p className="mt-1 text-[11px] leading-5 text-white/45">Ask Nova to organize items or explicitly use a safe VM task.</p><Button variant="outline" onClick={() => createChat.mutate({ title: "New workspace conversation" })} className="mt-3 w-full border-cyan-200/15 bg-transparent text-xs text-cyan-100 hover:bg-cyan-300/10 hover:text-cyan-50"><MessageSquareText className="mr-1.5 size-3.5" />Ask Nova</Button></div>
    </aside>
    <section className="min-w-0 overflow-hidden rounded-[1.45rem] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(57,191,201,0.14),transparent_43%),#111823] shadow-2xl shadow-black/20">
      <header className="border-b border-white/9 px-5 py-5 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.18em] text-cyan-200/75">Your private computer</p><div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm"><button onClick={() => setActiveFolderId(null)} className="font-medium text-white hover:text-cyan-100">Home</button>{folderTrail.map(folder => <span key={folder.id} className="flex items-center gap-1.5"><ChevronRight className="size-3 text-white/30" /><button onClick={() => setActiveFolderId(folder.id)} className="font-medium text-white/70 hover:text-cyan-100">{folder.name}</button></span>)}</div></div><div className="flex gap-2"><Button variant="outline" onClick={() => make("folder")} className="border-white/12 bg-white/[.03] text-xs text-white/80 hover:bg-white/8 hover:text-white"><FolderPlus className="mr-1.5 size-3.5" />New folder</Button><Button onClick={() => make("file")} className="bg-cyan-300 text-xs text-slate-950 hover:bg-cyan-200"><FilePlus2 className="mr-1.5 size-3.5" />New file</Button></div></div></header>
      <div className="p-5 sm:p-6"><div className="mb-7 flex items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{currentFolder?.name ?? "Workspace"}</h1><p className="mt-1 text-sm text-white/48">{itemCount} item{itemCount === 1 ? "" : "s"} in this location</p></div>{activeFolderId !== null && <Button variant="ghost" onClick={() => setActiveFolderId(currentFolder?.parentId ?? null)} className="text-xs text-white/60 hover:bg-white/8 hover:text-white"><ArrowLeft className="mr-1.5 size-3.5" />Up one level</Button>}</div>
        {computer.isLoading ? <div className="grid min-h-80 place-items-center text-sm text-white/45">Opening your private workspace…</div> : itemCount ? <div className="space-y-7">
          {visibleContents.folders.length > 0 && <div><p className="mb-3 text-[10px] font-semibold uppercase tracking-[.16em] text-white/40">Folders</p><div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{visibleContents.folders.map(folder => <FolderCard key={folder.id} name={folder.name} onOpen={() => setActiveFolderId(folder.id)} onMove={() => { const parentId = chooseFolder(folder.id); if (parentId !== undefined) renameFolder.mutate({ id: folder.id, parentId }); }} onRename={() => { const name = window.prompt("Rename folder", folder.name)?.trim(); if (name) renameFolder.mutate({ id: folder.id, name }); }} onDelete={() => window.confirm(`Delete ${folder.name} and its contents?`) && removeFolder.mutate({ id: folder.id })} />)}</div></div>}
          {visibleContents.files.length > 0 && <div><p className="mb-3 text-[10px] font-semibold uppercase tracking-[.16em] text-white/40">Files</p><div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{visibleContents.files.map(file => <FileCard key={file.id} name={file.name} changed={elapsed(file.updatedAt)} onMove={() => { const folderId = chooseFolder(); if (folderId !== undefined) renameFile.mutate({ id: file.id, folderId }); }} onRename={() => { const name = window.prompt("Rename file", file.name)?.trim(); if (name) renameFile.mutate({ id: file.id, name }); }} onDelete={() => window.confirm(`Delete ${file.name}?`) && removeFile.mutate({ id: file.id })} />)}</div></div>}
        </div> : <EmptyFolder onFolder={() => make("folder")} onFile={() => make("file")} />}
      </div>
    </section>
    <aside className="space-y-4">
      <section className="rounded-2xl border border-white/9 bg-[#10161f] p-4"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/45">Agent VM</p><span className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[.12em] ${vmCanRun ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-200/10 text-amber-100"}`}>{vm?.allowance.exhausted ? "Run cap reached" : vm?.configured ? "Ready" : "Setup needed"}</span></div><p className="mt-3 text-xs leading-5 text-white/52">Nova runs explicit tasks in a short-lived private sandbox. Workspace files are bundled for the run; network access stays blocked.</p><Textarea value={vmTask} onChange={event => setVmTask(event.target.value)} placeholder="Describe a safe workspace task…" className="mt-3 min-h-20 resize-none border-white/10 bg-black/15 text-xs text-white placeholder:text-white/30 focus-visible:ring-cyan-300/30" /><Button onClick={() => startVmRun.mutate({ task: vmTask.trim() })} disabled={!vmTask.trim() || startVmRun.isPending || !vmCanRun} className="mt-2 w-full bg-cyan-300 text-xs text-slate-950 hover:bg-cyan-200">{startVmRun.isPending ? "Starting sandbox…" : "Run in agent VM"}</Button><p className="mt-2 text-[10px] leading-4 text-white/33">{vm?.allowance.usedRuns ?? 0}/{vm?.allowance.maxRuns ?? 0} configured run cap · 1 active run · 30s task limit · polling status</p></section>
      <section className="rounded-2xl border border-white/9 bg-[#10161f] p-4"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/45">Agent activity</p><span className="text-[10px] text-white/30">Private</span></div><div className="mt-3 space-y-3">{agentVmRuns.data?.slice(0, 3).map(run => <div key={run.id} className="rounded-xl border border-white/7 bg-white/[.025] p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-medium text-white/78">{run.task}</p><span className={`text-[10px] ${run.status === "succeeded" ? "text-emerald-200" : run.status === "failed" ? "text-rose-200" : "text-amber-100"}`}>{run.status}</span></div><p className="mt-1 text-[10px] uppercase tracking-[.12em] text-white/30">Daytona VM</p>{run.resultSummary && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/42">{run.resultSummary}</p>}{run.errorMessage && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-rose-100/55">{run.errorMessage}</p>}{(run.status === "queued" || run.status === "running") && <button onClick={() => cancelVmRun.mutate({ id: run.id })} className="mt-2 text-[10px] font-medium text-rose-200/75 hover:text-rose-100">Cancel run</button>}</div>)}{!agentVmRuns.data?.length && <p className="text-xs leading-5 text-white/35">No agent work has run in this workspace.</p>}</div></section>
      <section className="rounded-2xl border border-white/9 bg-[#10161f] p-4"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/45">On this computer</p><div className="mt-4 grid grid-cols-2 gap-2"><Metric value={folders.length} label="folders" /><Metric value={allFiles.length} label="files" /></div><div className="mt-6"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/45">Recently changed</p><span className="text-[10px] text-white/30">Private</span></div><div className="mt-3 space-y-3">{allFiles.slice(0, 5).map(file => <div key={file.id} className="flex gap-2"><FileText className="mt-0.5 size-3.5 text-sky-200" /><div className="min-w-0"><p className="truncate text-xs text-white/70">{file.name}</p><p className="text-[10px] text-white/35">Edited {elapsed(file.updatedAt)}</p></div></div>)}{allFiles.length === 0 && <p className="text-xs leading-5 text-white/35">Your recent work will appear here.</p>}</div></div></section>
    </aside>
  </div></DashboardLayout>;
}

function WorkspaceError({ onRetry }: { onRetry: () => void }) {
  return <DashboardLayout><div className="grid min-h-[65vh] place-items-center text-center"><div><Sparkles className="mx-auto text-cyan-200" /><h1 className="mt-4 text-2xl font-semibold">Nova could not open your computer.</h1><p className="mt-2 text-sm text-white/45">Your files remain private. Try reconnecting to your workspace.</p><Button className="mt-5 bg-cyan-300 text-slate-950" onClick={onRetry}>Try again</Button></div></div></DashboardLayout>;
}

function FolderCard({ name, onOpen, onMove, onRename, onDelete }: { name: string; onOpen: () => void; onMove: () => void; onRename: () => void; onDelete: () => void }) {
  return <div className="rounded-2xl border border-white/9 bg-white/[.035] p-4 transition hover:border-cyan-300/25 hover:bg-white/[.06]"><button onClick={onOpen} className="flex w-full items-center gap-3 text-left"><span className="grid size-10 place-items-center rounded-xl bg-amber-200/10 text-amber-200"><FolderOpen className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white/88">{name}</span><span className="mt-0.5 block text-[11px] text-white/38">Folder</span></span><ChevronRight className="size-4 text-white/30" /></button><ItemActions label={name} onMove={onMove} onRename={onRename} onDelete={onDelete} /></div>;
}

function FileCard({ name, changed, onMove, onRename, onDelete }: { name: string; changed: string; onMove: () => void; onRename: () => void; onDelete: () => void }) {
  return <div className="rounded-2xl border border-white/9 bg-white/[.035] p-4 transition hover:border-sky-200/25 hover:bg-white/[.06]"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-sky-200/10 text-sky-200"><FileText className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white/88">{name}</span><span className="mt-0.5 block text-[11px] text-white/38">Edited {changed}</span></span></div><ItemActions label={name} onMove={onMove} onRename={onRename} onDelete={onDelete} /></div>;
}

function EmptyFolder({ onFolder, onFile }: { onFolder: () => void; onFile: () => void }) {
  return <div className="grid min-h-80 place-items-center rounded-3xl border border-dashed border-white/13 bg-white/[.025] p-8 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-200"><Sparkles className="size-5" /></span><h2 className="mt-4 text-lg font-medium">This folder is ready for your work.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-white/46">Create a file or folder here, or ask Nova to help shape your workspace.</p><div className="mt-6 flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={onFolder} className="border-white/12 bg-transparent text-white/75 hover:bg-white/8 hover:text-white"><FolderPlus className="mr-1.5 size-4" />New folder</Button><Button onClick={onFile} className="bg-cyan-300 text-slate-950 hover:bg-cyan-200"><Plus className="mr-1.5 size-4" />New file</Button></div></div></div>;
}

function ItemActions({ label, onMove, onRename, onDelete }: { label: string; onMove: () => void; onRename: () => void; onDelete: () => void }) {
  return <div className="mt-4 flex justify-end gap-1 border-t border-white/8 pt-3"><button aria-label={`Move ${label}`} onClick={onMove} className="rounded-md p-1.5 text-white/38 transition hover:bg-white/8 hover:text-white"><MoveRight className="size-3.5" /></button><button aria-label={`Rename ${label}`} onClick={onRename} className="rounded-md p-1.5 text-white/38 transition hover:bg-white/8 hover:text-white"><Pencil className="size-3.5" /></button><button aria-label={`Delete ${label}`} onClick={onDelete} className="rounded-md p-1.5 text-rose-200/65 transition hover:bg-rose-300/10 hover:text-rose-100"><Trash2 className="size-3.5" /></button></div>;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="rounded-xl bg-white/5 p-3"><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-[11px] text-white/43">{label}</p></div>;
}
