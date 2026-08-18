import DashboardLayout from "@/components/DashboardLayout";
import NovaMark from "@/components/NovaMark";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getFolderTrail, getWorkspaceContents } from "@/lib/workspaceBrowser";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
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
  const chatId = typeof window === "undefined" ? undefined : Number(new URLSearchParams(window.location.search).get("chatId")) || undefined;
  const folders = computer.data?.folders ?? [];
  const allFiles = computer.data?.files ?? [];
  const visibleContents = useMemo(() => getWorkspaceContents(folders, allFiles, activeFolderId), [activeFolderId, allFiles, folders]);
  const folderTrail = useMemo(() => getFolderTrail(folders, activeFolderId), [activeFolderId, folders]);
  const currentFolder = activeFolderId === null ? undefined : folders.find(folder => folder.id === activeFolderId);
  const savedMessages = trpc.chats.messages.useQuery({ chatId: chatId ?? 1 }, { enabled: Boolean(chatId), retry: false });
  const agentVmStatus = trpc.agentVm.status.useQuery(undefined, { retry: false, refetchInterval: 5000 });
  const nvidiaStatus = trpc.nvidia.status.useQuery(undefined, { retry: false, refetchInterval: 30000 });

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
    return (
      <DashboardLayout>
        <section className="mx-auto flex h-[calc(100vh-6.5rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_50px_rgba(10,10,10,0.06)] lg:h-[calc(100vh-3rem)] dark:border-white/10 dark:bg-neutral-900">
          <header className="flex items-center justify-between border-b border-neutral-100 px-5 py-3.5 dark:border-white/5">
            <div className="flex items-center gap-3">
              <button onClick={() => setLocation("/app/chats")} className="grid size-8 place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white" aria-label="Back to chats"><ArrowLeft className="size-4" /></button>
              <span className="grid size-9 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316]"><MessageSquareText className="size-4" /></span>
              <div>
                <p className="text-sm font-bold tracking-tight">Nova conversation</p>
                <p className="text-xs text-neutral-400">Private workspace context</p>
              </div>
            </div>
            <MoreHorizontal className="size-4 text-neutral-400" />
          </header>
          <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 self-end">
              {savedMessages.isLoading ? (
                <p className="text-sm text-neutral-400">Loading conversation…</p>
              ) : (
                savedMessages.data?.map(message => (
                  message.role === "user" ? (
                    <div key={message.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-neutral-950 px-4 py-2.5 text-sm leading-6 text-white dark:bg-white dark:text-neutral-950">{message.content}</div>
                  ) : (
                    <div key={message.id} className="flex items-start gap-2.5">
                      <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316]"><NovaMark size={12} /></span>
                      <div className="max-w-[85%]">
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nova App</p>
                        <div className="rounded-2xl rounded-tl-md bg-neutral-100 px-4 py-2.5 text-sm leading-6 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">{message.content}</div>
                      </div>
                    </div>
                  )
                ))
              )}
              {send.isPending && <div className="flex items-start gap-2.5"><span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[#f97316]/10 text-[#f97316]"><NovaMark size={12} /></span><div className="rounded-2xl rounded-tl-md bg-neutral-100 px-4 py-2.5 text-sm text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Nova is working…</div></div>}
            </div>
          </div>
          <form onSubmit={submit} className="border-t border-neutral-100 bg-white p-3 dark:border-white/5 dark:bg-neutral-900">
            <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-[#fafafa] px-4 py-2 transition focus-within:border-[#f97316] focus-within:ring-4 focus-within:ring-[#f97316]/10 dark:border-white/10 dark:bg-neutral-950">
              <Paperclip className="size-4 shrink-0 text-neutral-400" />
              <Textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask Nova…" className="min-h-9 flex-1 resize-none border-0 bg-transparent px-0 py-1.5 text-sm placeholder:text-neutral-400 focus-visible:ring-0" />
              <span className="hidden items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 ring-1 ring-neutral-200 sm:inline-flex dark:bg-neutral-900 dark:text-neutral-200 dark:ring-white/10">Claude <ChevronDown className="size-3" /></span>
              <button type="submit" disabled={!draft.trim() || send.isPending} className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f97316] text-white transition hover:bg-[#ea580c] disabled:opacity-40" aria-label="Go"><ArrowUp className="size-4" /></button>
            </div>
          </form>
        </section>
      </DashboardLayout>
    );
  }

  const vm = agentVmStatus.data;
  const nvidia = nvidiaStatus.data;
  const itemCount = visibleContents.folders.length + visibleContents.files.length;
  return (
    <DashboardLayout>
      <div className="mx-auto grid max-w-[1200px] gap-4 p-4 md:p-6 xl:grid-cols-[230px_minmax(0,1fr)_290px]">
        <aside className="h-fit rounded-2xl border border-neutral-200 bg-white p-3 dark:border-white/10 dark:bg-neutral-900">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Workspace folders</span>
            <button onClick={() => make("folder")} className="grid size-7 place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white" aria-label="New folder"><FolderPlus className="size-4" /></button>
          </div>
          <div className="space-y-0.5">
            <button onClick={() => setActiveFolderId(null)} className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${activeFolderId === null ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"}`}>
              <HardDrive className={`size-4 ${activeFolderId === null ? "text-[#fb923c]" : "text-neutral-400"}`} />
              <span className="flex-1">Home</span>
            </button>
            {folders.map(folder => (
              <button key={folder.id} onClick={() => setActiveFolderId(folder.id)} className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${activeFolderId === folder.id ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"}`}>
                <ChevronRight className="size-3 text-neutral-300 dark:text-neutral-600" />
                <Folder className="size-4 text-[#f97316]" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-xl bg-[#f97316]/8 p-3">
            <p className="text-xs font-bold text-[#c2410c] dark:text-[#fdba74]">Need a second pair of hands?</p>
            <p className="mt-1 text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">Ask Nova to organize items without leaving your workspace.</p>
            <Button variant="outline" onClick={() => createChat.mutate({ title: "New workspace conversation" })} className="mt-3 w-full rounded-full border-neutral-200 bg-white text-xs text-neutral-800 hover:bg-neutral-50 hover:text-neutral-950 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800">
              <MessageSquareText className="mr-1.5 size-3.5" />Ask Nova
            </Button>
          </div>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_50px_rgba(10,10,10,0.05)] dark:border-white/10 dark:bg-neutral-900">
          <header className="border-b border-neutral-100 px-5 py-4 sm:px-6 dark:border-white/5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Your private computer</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
                  <button onClick={() => setActiveFolderId(null)} className="font-bold text-neutral-950 hover:text-[#f97316] dark:text-white">Home</button>
                  {folderTrail.map(folder => (
                    <span key={folder.id} className="flex items-center gap-1.5">
                      <ChevronRight className="size-3 text-neutral-300 dark:text-neutral-600" />
                      <button onClick={() => setActiveFolderId(folder.id)} className="font-medium text-neutral-500 hover:text-[#f97316] dark:text-neutral-400">{folder.name}</button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => make("folder")} className="rounded-full border-neutral-200 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 hover:text-neutral-950 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"><FolderPlus className="mr-1.5 size-3.5" />New folder</Button>
                <Button onClick={() => make("file")} className="rounded-full bg-[#f97316] text-xs font-semibold hover:bg-[#ea580c]"><FilePlus2 className="mr-1.5 size-3.5" />New file</Button>
              </div>
            </div>
          </header>
          <div className="p-5 sm:p-6">
            <div className="mb-7 flex items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">{currentFolder?.name ?? "Home"}</h1>
                <p className="mt-1 text-sm text-neutral-400">{itemCount} item{itemCount === 1 ? "" : "s"} in this location</p>
              </div>
              {activeFolderId !== null && (
                <Button variant="ghost" onClick={() => setActiveFolderId(currentFolder?.parentId ?? null)} className="text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white">
                  <ArrowLeft className="mr-1.5 size-3.5" />Up one level
                </Button>
              )}
            </div>
            {computer.isLoading ? (
              <div className="grid min-h-80 place-items-center text-sm text-neutral-400">Opening your private workspace…</div>
            ) : itemCount ? (
              <div className="space-y-7">
                {visibleContents.folders.length > 0 && (
                  <div>
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Folders</p>
                    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                      {visibleContents.folders.map(folder => (
                        <FolderCard key={folder.id} name={folder.name} onOpen={() => setActiveFolderId(folder.id)} onMove={() => { const parentId = chooseFolder(folder.id); if (parentId !== undefined) renameFolder.mutate({ id: folder.id, parentId }); }} onRename={() => { const name = window.prompt("Rename folder", folder.name)?.trim(); if (name) renameFolder.mutate({ id: folder.id, name }); }} onDelete={() => window.confirm(`Delete ${folder.name} and its contents?`) && removeFolder.mutate({ id: folder.id })} />
                      ))}
                    </div>
                  </div>
                )}
                {visibleContents.files.length > 0 && (
                  <div>
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Files</p>
                    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                      {visibleContents.files.map(file => (
                        <FileCard key={file.id} name={file.name} changed={elapsed(file.updatedAt)} onMove={() => { const folderId = chooseFolder(); if (folderId !== undefined) renameFile.mutate({ id: file.id, folderId }); }} onRename={() => { const name = window.prompt("Rename file", file.name)?.trim(); if (name) renameFile.mutate({ id: file.id, name }); }} onDelete={() => window.confirm(`Delete ${file.name}?`) && removeFile.mutate({ id: file.id })} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <EmptyFolder onFolder={() => make("folder")} onFile={() => make("file")} />
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Usage</p>
              <span className="text-[10px] text-neutral-300 dark:text-neutral-600">This workspace</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric value={`${nvidia?.allowance.usedRequests ?? 0}/${nvidia?.allowance.maxRequests ?? 0}`} label="NVIDIA requests" />
              <Metric value={`${vm?.allowance.usedRuns ?? 0}/${vm?.allowance.maxRuns ?? 0}`} label="VM runs" />
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">On this computer</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric value={folders.length} label="folders" />
              <Metric value={allFiles.length} label="files" />
            </div>
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Recently changed</p>
                <span className="text-[10px] text-neutral-300 dark:text-neutral-600">Private</span>
              </div>
              <div className="mt-3 space-y-3">
                {allFiles.slice(0, 5).map(file => (
                  <div key={file.id} className="flex gap-2">
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-[#f97316]" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-neutral-700 dark:text-neutral-300">{file.name}</p>
                      <p className="text-[10px] text-neutral-400">Edited {elapsed(file.updatedAt)}</p>
                    </div>
                  </div>
                ))}
                {allFiles.length === 0 && <p className="text-xs leading-5 text-neutral-400">Your recent work will appear here.</p>}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </DashboardLayout>
  );
}

function WorkspaceError({ onRetry }: { onRetry: () => void }) {
  return <DashboardLayout><div className="grid min-h-[65vh] place-items-center text-center"><div><NovaMark size={40} className="mx-auto" /><h1 className="mt-4 text-2xl font-extrabold tracking-tight">Nova could not open your computer.</h1><p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Your files remain private. Try reconnecting to your workspace.</p><Button className="mt-5 rounded-full bg-[#f97316] hover:bg-[#ea580c]" onClick={onRetry}>Try again</Button></div></div></DashboardLayout>;
}

function FolderCard({ name, onOpen, onMove, onRename, onDelete }: { name: string; onOpen: () => void; onMove: () => void; onRename: () => void; onDelete: () => void }) {
  return <div className="rounded-xl border border-neutral-200 bg-[#fafafa] p-4 transition hover:border-neutral-300 hover:bg-white hover:shadow-sm dark:border-white/10 dark:bg-neutral-950 dark:hover:border-white/20"><button onClick={onOpen} className="flex w-full items-center gap-3 text-left"><span className="grid size-10 place-items-center rounded-xl bg-[#f97316]/10 text-[#f97316]"><FolderOpen className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-neutral-900 dark:text-white">{name}</span><span className="mt-0.5 block text-[11px] text-neutral-400">Folder</span></span><ChevronRight className="size-4 text-neutral-300 dark:text-neutral-600" /></button><ItemActions label={name} onMove={onMove} onRename={onRename} onDelete={onDelete} /></div>;
}

function FileCard({ name, changed, onMove, onRename, onDelete }: { name: string; changed: string; onMove: () => void; onRename: () => void; onDelete: () => void }) {
  return <div className="rounded-xl border border-neutral-200 bg-[#fafafa] p-4 transition hover:border-neutral-300 hover:bg-white hover:shadow-sm dark:border-white/10 dark:bg-neutral-950 dark:hover:border-white/20"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300"><FileText className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-neutral-900 dark:text-white">{name}</span><span className="mt-0.5 block text-[11px] text-neutral-400">Edited {changed}</span></span></div><ItemActions label={name} onMove={onMove} onRename={onRename} onDelete={onDelete} /></div>;
}

function EmptyFolder({ onFolder, onFile }: { onFolder: () => void; onFile: () => void }) {
  return <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-neutral-200 bg-[#fafafa] p-8 text-center dark:border-white/10 dark:bg-neutral-950"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#f97316]/10 text-[#f97316]"><Sparkles className="size-5" /></span><h2 className="mt-4 text-lg font-bold tracking-tight">This folder is ready for your work.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-neutral-500 dark:text-neutral-400">Create a file or folder here, or ask Nova to help shape your workspace.</p><div className="mt-6 flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={onFolder} className="rounded-full border-neutral-200 font-semibold text-neutral-700 hover:bg-neutral-50 hover:text-neutral-950 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"><FolderPlus className="mr-1.5 size-4" />New folder</Button><Button onClick={onFile} className="rounded-full bg-[#f97316] font-semibold hover:bg-[#ea580c]"><Plus className="mr-1.5 size-4" />New file</Button></div></div></div>;
}

function ItemActions({ label, onMove, onRename, onDelete }: { label: string; onMove: () => void; onRename: () => void; onDelete: () => void }) {
  return <div className="mt-4 flex justify-end gap-1 border-t border-neutral-100 pt-3 dark:border-white/5"><button aria-label={`Move ${label}`} onClick={onMove} className="rounded-md p-1.5 text-neutral-300 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"><MoveRight className="size-3.5" /></button><button aria-label={`Rename ${label}`} onClick={onRename} className="rounded-md p-1.5 text-neutral-300 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"><Pencil className="size-3.5" /></button><button aria-label={`Delete ${label}`} onClick={onDelete} className="rounded-md p-1.5 text-red-400/70 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300"><Trash2 className="size-3.5" /></button></div>;
}

function Metric({ value, label }: { value: React.ReactNode; label: string }) {
  return <div className="rounded-xl bg-[#fafafa] p-3 dark:bg-neutral-950"><p className="text-2xl font-extrabold tracking-tight">{value}</p><p className="mt-1 text-[11px] text-neutral-400">{label}</p></div>;
}
