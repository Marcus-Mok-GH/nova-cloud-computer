import DashboardLayout from "@/components/DashboardLayout";
import NovaMark from "@/components/NovaMark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getFolderTrail, getWorkspaceContents } from "@/lib/workspaceBrowser";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ChevronRight, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, HardDrive, MoveRight, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import React, { useMemo, useState } from "react";

const elapsed = (date: Date | undefined) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(date ?? Date.now()).getTime()) / 60000));
  return mins < 2 ? "just now" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
};

type OpenFile = { id: number; name: string; content?: string | null; mimeType?: string | null; updatedAt?: Date };

export default function Files() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const folders = computer.data?.folders ?? [];
  const allFiles = computer.data?.files ?? [];
  const visibleContents = useMemo(() => getWorkspaceContents(folders, allFiles, activeFolderId), [activeFolderId, allFiles, folders]);
  const folderTrail = useMemo(() => getFolderTrail(folders, activeFolderId), [activeFolderId, folders]);
  const currentFolder = activeFolderId === null ? undefined : folders.find(folder => folder.id === activeFolderId);
  const itemCount = visibleContents.folders.length + visibleContents.files.length;

  const createFolder = trpc.folders.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: error => toast.error(error.message) });
  const createFile = trpc.files.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: error => toast.error(error.message) });
  const renameFolder = trpc.folders.update.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: error => toast.error(error.message) });
  const removeFolder = trpc.folders.delete.useMutation({ onSuccess: () => { setActiveFolderId(null); utils.workspace.computer.invalidate(); }, onError: error => toast.error(error.message) });
  const renameFile = trpc.files.update.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: error => toast.error(error.message) });
  const removeFile = trpc.files.delete.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: error => toast.error(error.message) });
  const saveFile = trpc.files.update.useMutation({ onSuccess: async () => { await utils.workspace.computer.invalidate(); toast.success("File saved"); setOpenFile(null); }, onError: error => toast.error(error.message) });

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
    if (!folder) { toast.error("Choose a folder that exists in your workspace."); return undefined; }
    return folder.id;
  };

  const open = (file: OpenFile) => { setOpenFile(file); setDraftContent(file.content ?? ""); };

  if (computer.isError) return <FilesError onRetry={() => computer.refetch()} />;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1200px] p-4 md:p-6">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Workspace files</p><h1 className="mt-2 text-2xl font-extrabold tracking-tight text-neutral-950 dark:text-white">Files</h1><p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Browse and organize everything in your private workspace.</p></div>
          <div className="flex gap-2"><Button variant="outline" onClick={() => make("folder")} className="rounded-full border-neutral-200 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 hover:text-neutral-950 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-white"><FolderPlus className="mr-1.5 size-3.5" />New folder</Button><Button onClick={() => make("file")} className="rounded-full bg-[#f97316] text-xs font-semibold hover:bg-[#ea580c]"><FilePlus2 className="mr-1.5 size-3.5" />New file</Button></div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-neutral-200 bg-white p-3 dark:border-white/10 dark:bg-neutral-900">
            <div className="mb-2 flex items-center justify-between px-2"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Workspace folders</span><button onClick={() => make("folder")} className="grid size-7 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="New folder"><FolderPlus className="size-4" /></button></div>
            <div className="space-y-0.5"><button onClick={() => setActiveFolderId(null)} className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium ${activeFolderId === null ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"}`}><HardDrive className={`size-4 ${activeFolderId === null ? "text-[#fb923c]" : "text-neutral-400"}`} /><span className="flex-1">Home</span></button>{folders.map(folder => <button key={folder.id} onClick={() => setActiveFolderId(folder.id)} className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium ${activeFolderId === folder.id ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"}`}><ChevronRight className="size-3 text-neutral-300" /><Folder className="size-4 text-[#f97316]" /><span className="min-w-0 flex-1 truncate">{folder.name}</span></button>)}</div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_50px_rgba(10,10,10,0.05)] dark:border-white/10 dark:bg-neutral-900">
            <header className="border-b border-neutral-100 px-5 py-4 sm:px-6 dark:border-white/5"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Your private files</p><div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm"><button onClick={() => setActiveFolderId(null)} className="font-bold text-neutral-950 hover:text-[#f97316] dark:text-white">Home</button>{folderTrail.map(folder => <span key={folder.id} className="flex items-center gap-1.5"><ChevronRight className="size-3 text-neutral-300" /><button onClick={() => setActiveFolderId(folder.id)} className="font-medium text-neutral-500 hover:text-[#f97316] dark:text-neutral-400">{folder.name}</button></span>)}</div></div><span className="rounded-full bg-neutral-100 px-3 py-1.5 text-[11px] font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">{itemCount} {itemCount === 1 ? "item" : "items"}</span></div></header>
            <div className="p-5 sm:p-6"><div className="mb-5 flex items-center justify-between gap-4"><div><h2 className="text-xl font-extrabold tracking-tight text-neutral-950 dark:text-white">{currentFolder?.name ?? "Home"}</h2><p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{currentFolder ? "Files in this folder" : "Your root workspace"}</p></div><Button onClick={() => make("file")} className="rounded-full bg-[#f97316] text-xs font-semibold hover:bg-[#ea580c]"><Plus className="mr-1.5 size-3.5" />Add file</Button></div>
              {computer.isLoading ? <div className="grid min-h-80 place-items-center text-sm text-neutral-400">Opening your private workspace…</div> : itemCount > 0 ? <div className="space-y-7">{visibleContents.folders.length > 0 && <div><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Folders</p><div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{visibleContents.folders.map(folder => <FolderCard key={folder.id} name={folder.name} onOpen={() => setActiveFolderId(folder.id)} onMove={() => { const folderId = chooseFolder(folder.id); if (folderId !== undefined) renameFolder.mutate({ id: folder.id, parentId: folderId }); }} onRename={() => { const name = window.prompt("Rename folder", folder.name)?.trim(); if (name) renameFolder.mutate({ id: folder.id, name }); }} onDelete={() => window.confirm(`Delete ${folder.name}?`) && removeFolder.mutate({ id: folder.id })} />)}</div></div>}{visibleContents.files.length > 0 && <div><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Files</p><div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{visibleContents.files.map(file => <FileCard key={file.id} file={file as OpenFile} onOpen={() => open(file as OpenFile)} onMove={() => { const folderId = chooseFolder(); if (folderId !== undefined) renameFile.mutate({ id: file.id, folderId }); }} onRename={() => { const name = window.prompt("Rename file", file.name)?.trim(); if (name) renameFile.mutate({ id: file.id, name }); }} onDelete={() => window.confirm(`Delete ${file.name}?`) && removeFile.mutate({ id: file.id })} />)}</div></div>}</div> : <EmptyFolder onFolder={() => make("folder")} onFile={() => make("file")} />}
            </div>
          </section>
        </div>
      </div>

      <Dialog open={openFile !== null} onOpenChange={open => { if (!open) setOpenFile(null); }}>
        <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4"><DialogTitle className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4 text-neutral-500" />{openFile?.name}</DialogTitle></DialogHeader>
          <textarea value={draftContent} onChange={event => setDraftContent(event.target.value)} spellCheck={false} className="min-h-[55vh] w-full resize-none border-0 bg-white p-5 font-mono text-sm leading-6 text-neutral-900 outline-none dark:bg-neutral-950 dark:text-neutral-100" aria-label={`Contents of ${openFile?.name ?? "file"}`} />
          <div className="flex items-center justify-between border-t bg-neutral-50 px-5 py-3 dark:border-white/10 dark:bg-neutral-900"><span className="text-xs text-neutral-400">{openFile?.mimeType ?? "Plain text file"}</span><div className="flex gap-2"><Button variant="outline" onClick={() => setOpenFile(null)} className="rounded-full">Close</Button><Button disabled={!openFile || saveFile.isPending} onClick={() => openFile && saveFile.mutate({ id: openFile.id, content: draftContent })} className="rounded-full bg-[#f97316] hover:bg-[#ea580c]">{saveFile.isPending ? "Saving…" : "Save"}</Button></div></div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function FilesError({ onRetry }: { onRetry: () => void }) { return <DashboardLayout><div className="grid min-h-[65vh] place-items-center text-center"><div><NovaMark size={40} className="mx-auto" /><h1 className="mt-4 text-2xl font-extrabold tracking-tight">Nova could not open your files.</h1><p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Your files remain private. Try reconnecting to your workspace.</p><Button className="mt-5 rounded-full bg-[#f97316] hover:bg-[#ea580c]" onClick={onRetry}>Try again</Button></div></div></DashboardLayout>; }
function FolderCard({ name, onOpen, onMove, onRename, onDelete }: { name: string; onOpen: () => void; onMove: () => void; onRename: () => void; onDelete: () => void }) { return <div className="rounded-xl border border-neutral-200 bg-[#fafafa] p-4 transition hover:border-neutral-300 hover:bg-white hover:shadow-sm dark:border-white/10 dark:bg-neutral-950 dark:hover:border-white/20"><button onClick={onOpen} className="flex w-full items-center gap-3 text-left"><span className="grid size-10 place-items-center rounded-xl bg-[#f97316]/10 text-[#f97316]"><FolderOpen className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-neutral-900 dark:text-white">{name}</span><span className="mt-0.5 block text-[11px] text-neutral-400">Folder</span></span><ChevronRight className="size-4 text-neutral-300" /></button><ItemActions label={name} onMove={onMove} onRename={onRename} onDelete={onDelete} /></div>; }
function FileCard({ file, onOpen, onMove, onRename, onDelete }: { file: OpenFile; onOpen: () => void; onMove: () => void; onRename: () => void; onDelete: () => void }) { return <div className="rounded-xl border border-neutral-200 bg-[#fafafa] p-4 transition hover:border-neutral-300 hover:bg-white hover:shadow-sm dark:border-white/10 dark:bg-neutral-950 dark:hover:border-white/20"><button onClick={onOpen} className="flex w-full items-center gap-3 text-left" aria-label={`Open ${file.name}`}><span className="grid size-10 place-items-center rounded-xl bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300"><FileText className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-neutral-900 dark:text-white">{file.name}</span><span className="mt-0.5 block text-[11px] text-neutral-400">Edited {elapsed(file.updatedAt)}</span></span><ChevronRight className="size-4 text-neutral-300" /></button><ItemActions label={file.name} onMove={onMove} onRename={onRename} onDelete={onDelete} /></div>; }
function EmptyFolder({ onFolder, onFile }: { onFolder: () => void; onFile: () => void }) { return <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-neutral-200 bg-[#fafafa] p-8 text-center dark:border-white/10 dark:bg-neutral-950"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#f97316]/10 text-[#f97316]"><Sparkles className="size-5" /></span><h2 className="mt-4 text-lg font-bold tracking-tight">This folder is ready for your work.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-neutral-500 dark:text-neutral-400">Create a file or folder here to begin organizing your workspace.</p><div className="mt-6 flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={onFolder} className="rounded-full border-neutral-200 font-semibold"> <FolderPlus className="mr-1.5 size-4" />New folder</Button><Button onClick={onFile} className="rounded-full bg-[#f97316] font-semibold hover:bg-[#ea580c]"><Plus className="mr-1.5 size-4" />New file</Button></div></div></div>; }
function ItemActions({ label, onMove, onRename, onDelete }: { label: string; onMove: () => void; onRename: () => void; onDelete: () => void }) { return <div className="mt-4 flex justify-end gap-1 border-t border-neutral-100 pt-3 dark:border-white/5"><button aria-label={`Move ${label}`} onClick={onMove} className="rounded-md p-1.5 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"><MoveRight className="size-3.5" /></button><button aria-label={`Rename ${label}`} onClick={onRename} className="rounded-md p-1.5 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"><Pencil className="size-3.5" /></button><button aria-label={`Delete ${label}`} onClick={onDelete} className="rounded-md p-1.5 text-red-400/70 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300"><Trash2 className="size-3.5" /></button></div>; }
