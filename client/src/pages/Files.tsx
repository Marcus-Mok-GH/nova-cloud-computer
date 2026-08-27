import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getFolderTrail, getWorkspaceContents } from "@/lib/workspaceBrowser";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, File, FilePlus2, Folder, FolderOpen, FolderPlus, HardDrive, MoreHorizontal, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import React, { useMemo, useState } from "react";

type OpenFile = { id: number; name: string; content?: string | null; mimeType?: string | null; updatedAt?: Date; folderId?: number | null };

export default function Files() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [draft, setDraft] = useState("");
  const folders = computer.data?.folders ?? [];
  const files = computer.data?.files ?? [];
  const contents = useMemo(() => getWorkspaceContents(folders, files, activeFolderId), [folders, files, activeFolderId]);
  const trail = useMemo(() => getFolderTrail(folders, activeFolderId), [folders, activeFolderId]);

  const createFolder = trpc.folders.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const createFile = trpc.files.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const renameFolder = trpc.folders.update.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const deleteFolder = trpc.folders.delete.useMutation({ onSuccess: () => { setActiveFolderId(null); utils.workspace.computer.invalidate(); }, onError: e => toast.error(e.message) });
  const renameFile = trpc.files.update.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const deleteFile = trpc.files.delete.useMutation({ onSuccess: () => { setOpenFile(null); utils.workspace.computer.invalidate(); }, onError: e => toast.error(e.message) });
  const saveFile = trpc.files.update.useMutation({ onSuccess: async () => { await utils.workspace.computer.invalidate(); toast.success("File saved"); }, onError: e => toast.error(e.message) });

  const make = (kind: "file" | "folder") => {
    const name = window.prompt(`Name this ${kind}`)?.trim();
    if (!name) return;
    if (kind === "folder") createFolder.mutate({ name, parentId: activeFolderId });
    else createFile.mutate({ name, content: "", folderId: activeFolderId });
  };

  const open = (file: OpenFile) => { setOpenFile(file); setDraft(file.content ?? ""); };
  const selectFolder = (id: number | null) => { setActiveFolderId(id); if (id !== null) setExpanded(prev => new Set(prev).add(id)); };
  const childrenOf = (id: number | null) => folders.filter(folder => folder.parentId === id).sort((a, b) => a.name.localeCompare(b.name));
  const filesOf = (id: number | null) => files.filter(file => file.folderId === id).sort((a, b) => a.name.localeCompare(b.name));

  if (computer.isError) return <DashboardLayout><div className="grid min-h-[65vh] place-items-center"><div className="text-center"><h1 className="text-xl font-bold">Nova could not open your files.</h1><Button onClick={() => computer.refetch()} className="mt-4">Try again</Button></div></div></DashboardLayout>;

  return <DashboardLayout>
    <div className="flex h-[calc(100vh-3.5rem-6rem)] min-h-[560px] flex-col overflow-hidden bg-white dark:bg-neutral-950 lg:flex-row">
      {/* VS Code-style explorer */}
      <aside className="w-full shrink-0 border-b border-neutral-200 bg-[#f8f8f8] dark:border-white/10 dark:bg-[#181818] lg:w-[270px] lg:border-b-0 lg:border-r">
        <div className="flex h-11 items-center justify-between border-b border-neutral-200 px-3 dark:border-white/10">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Explorer</span>
          <div className="flex items-center gap-0.5"><button onClick={() => make("file")} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-white/10" title="New file"><FilePlus2 className="size-4" /></button><button onClick={() => make("folder")} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-white/10" title="New folder"><FolderPlus className="size-4" /></button></div>
        </div>
        <div className="max-h-[calc(100vh-13rem)] overflow-y-auto py-1 font-mono text-[12px]">
          <button onClick={() => selectFolder(null)} className={`flex w-full items-center gap-1 px-2 py-1.5 text-left ${activeFolderId === null ? "bg-[#e8e8e8] text-neutral-950 dark:bg-white/10 dark:text-white" : "text-neutral-600 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-white/5"}`}><HardDrive className="ml-1 mr-1 size-3.5" /><span className="font-semibold">NOVA WORKSPACE</span></button>
          <Tree folders={folders} files={files} parentId={null} depth={0} activeFolderId={activeFolderId} expanded={expanded} setExpanded={setExpanded} selectFolder={selectFolder} open={open} />
        </div>
      </aside>

      {/* Main editor / file area */}
      <section className="flex min-w-0 flex-1 flex-col bg-white dark:bg-neutral-950">
        <div className="flex h-11 shrink-0 items-center border-b border-neutral-200 bg-[#fafafa] dark:border-white/10 dark:bg-[#181818]">
          {openFile ? <div className="flex h-full max-w-[260px] items-center gap-2 border-r border-neutral-200 bg-white px-3 text-xs dark:border-white/10 dark:bg-neutral-950"><File className="size-3.5 text-neutral-500" /><span className="max-w-[190px] truncate font-medium">{openFile.name}</span><button onClick={() => setOpenFile(null)} className="ml-1 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10"><X className="size-3.5" /></button></div> : <div className="px-4 text-xs text-neutral-400">No file open</div>}
        </div>

        {openFile ? <div className="flex min-h-0 flex-1 flex-col"><div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2 text-[11px] text-neutral-400 dark:border-white/5"><div className="flex min-w-0 items-center gap-1">{trail.map((folder, i) => <React.Fragment key={folder.id}><span className="truncate">{folder.name}</span><ChevronRight className="size-3 shrink-0" /></React.Fragment>)}<span className="truncate text-neutral-600 dark:text-neutral-300">{openFile.name}</span></div><span>{openFile.mimeType ?? "Plain text"}</span></div><textarea value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} className="min-h-0 flex-1 resize-none border-0 bg-white p-5 font-mono text-[13px] leading-6 text-neutral-900 outline-none dark:bg-neutral-950 dark:text-neutral-100" aria-label={`Edit ${openFile.name}`} /><div className="flex items-center justify-between border-t border-neutral-200 bg-[#f8f8f8] px-3 py-2 dark:border-white/10 dark:bg-[#181818]"><div className="text-[11px] text-neutral-400">{draft.length} characters</div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setOpenFile(null)}><X className="mr-1.5 size-3.5" />Close</Button><Button size="sm" disabled={saveFile.isPending} onClick={() => saveFile.mutate({ id: openFile.id, content: draft })} className="bg-[#f97316] hover:bg-[#ea580c]"><Save className="mr-1.5 size-3.5" />{saveFile.isPending ? "Saving…" : "Save"}</Button></div></div></div> : <div className="flex flex-1 flex-col"><div className="border-b border-neutral-100 px-5 py-4 dark:border-white/5"><div className="flex items-center gap-1 text-xs text-neutral-400"><span>workspace</span>{trail.map(folder => <React.Fragment key={folder.id}><ChevronRight className="size-3" /><span>{folder.name}</span></React.Fragment>)}</div><h1 className="mt-2 text-lg font-semibold">{activeFolderId === null ? "NOVA WORKSPACE" : folders.find(f => f.id === activeFolderId)?.name}</h1></div><div className="flex-1 overflow-auto p-5"><div className="max-w-4xl"><div className="mb-3 flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{contents.folders.length + contents.files.length} items</span><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => make("folder")}><FolderPlus className="mr-1.5 size-3.5" />Folder</Button><Button variant="ghost" size="sm" onClick={() => make("file")}><Plus className="mr-1.5 size-3.5" />File</Button></div></div><div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-white/5 dark:border-white/10">{contents.folders.map(folder => <button key={folder.id} onDoubleClick={() => selectFolder(folder.id)} onClick={() => selectFolder(folder.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-white/5"><Folder className="size-4 text-[#f97316]" /><span className="flex-1 truncate">{folder.name}</span><span className="text-xs text-neutral-400">Folder</span><ChevronRight className="size-3.5 text-neutral-300" /></button>)}{contents.files.map(file => <button key={file.id} onClick={() => open(file as OpenFile)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-white/5"><File className="size-4 text-neutral-500" /><span className="flex-1 truncate">{file.name}</span><span className="text-xs text-neutral-400">File</span></button>)}{contents.folders.length + contents.files.length === 0 && <div className="px-4 py-12 text-center text-sm text-neutral-400">This folder is empty.</div>}</div></div></div></div>}
      </section>
    </div>

    <Dialog open={false} onOpenChange={() => {}}><DialogContent><DialogHeader><DialogTitle>File</DialogTitle></DialogHeader></DialogContent></Dialog>
  </DashboardLayout>;
}

function Tree({ folders, files, parentId, depth, activeFolderId, expanded, setExpanded, selectFolder, open }: any) {
  const children = folders.filter((f: any) => f.parentId === parentId).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const childFiles = files.filter((f: any) => f.folderId === parentId).sort((a: any, b: any) => a.name.localeCompare(b.name));
  return <>{children.map((folder: any) => { const isOpen = expanded.has(folder.id); const hasChildren = folders.some((f: any) => f.parentId === folder.id) || files.some((f: any) => f.folderId === folder.id); return <React.Fragment key={folder.id}><button onClick={() => { selectFolder(folder.id); setExpanded((prev: Set<number>) => { const next = new Set(prev); isOpen ? next.delete(folder.id) : next.add(folder.id); return next; }); }} className={`flex w-full items-center gap-1 py-1.5 text-left hover:bg-neutral-200/70 dark:hover:bg-white/5 ${activeFolderId === folder.id ? "bg-[#e8e8e8] dark:bg-white/10" : ""}`} style={{ paddingLeft: `${8 + depth * 16}px` }}>{hasChildren ? (isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />) : <span className="size-3.5" />} {isOpen ? <FolderOpen className="size-4 text-[#f97316]" /> : <Folder className="size-4 text-[#f97316]" />}<span className="min-w-0 truncate">{folder.name}</span></button>{isOpen && <Tree folders={folders} files={files} parentId={folder.id} depth={depth + 1} activeFolderId={activeFolderId} expanded={expanded} setExpanded={setExpanded} selectFolder={selectFolder} open={open} />}</React.Fragment>})}{childFiles.map((file: any) => <button key={`file-${file.id}`} onClick={() => open(file)} className="flex w-full items-center gap-1.5 py-1.5 text-left text-neutral-600 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-white/5" style={{ paddingLeft: `${24 + depth * 16}px` }}><File className="size-3.5 shrink-0 text-neutral-400" /><span className="min-w-0 truncate">{file.name}</span></button>)}</>;
}
