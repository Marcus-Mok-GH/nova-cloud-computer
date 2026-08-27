import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { getFolderTrail } from "@/lib/workspaceBrowser";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, File, FilePlus2, Folder, FolderOpen, FolderPlus, HardDrive, Save, Trash2, X } from "lucide-react";
import React, { useMemo, useState } from "react";

type OpenFile = { id: number; name: string; content?: string | null; mimeType?: string | null; updatedAt?: Date; folderId?: number | null };
type TreeProps = { folders: any[]; files: any[]; parentId: number | null; depth: number; activeFolderId: number | null; expanded: Set<number>; setExpanded: React.Dispatch<React.SetStateAction<Set<number>>>; selectFolder: (id: number | null) => void; open: (file: OpenFile) => void; deleteFile: (file: any, event?: React.MouseEvent) => void };

export default function Files() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [draft, setDraft] = useState("");
  const folders = computer.data?.folders ?? [];
  const files = computer.data?.files ?? [];
  const trail = useMemo(() => getFolderTrail(folders, activeFolderId), [folders, activeFolderId]);

  const createFolder = trpc.folders.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const createFile = trpc.files.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const deleteFile = trpc.files.delete.useMutation({
    onSuccess: (_, variables) => { if (openFile?.id === variables.id) setOpenFile(null); utils.workspace.computer.invalidate(); toast.success("File deleted"); },
    onError: e => toast.error(e.message),
  });
  const saveFile = trpc.files.update.useMutation({
    onSuccess: async () => { await utils.workspace.computer.invalidate(); toast.success("File saved"); },
    onError: e => toast.error(e.message),
  });

  const make = (kind: "file" | "folder") => {
    const name = window.prompt(`Name this ${kind}`)?.trim();
    if (!name) return;
    if (kind === "folder") createFolder.mutate({ name, parentId: activeFolderId });
    else createFile.mutate({ name, content: "", folderId: activeFolderId });
  };
  const open = (file: OpenFile) => { setOpenFile(file); setDraft(file.content ?? ""); };
  const selectFolder = (id: number | null) => { setActiveFolderId(id); if (id !== null) setExpanded(prev => new Set(prev).add(id)); };
  const confirmDeleteFile = (file: any, event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (!window.confirm(`Delete “${file.name}”? This cannot be undone.`)) return;
    deleteFile.mutate({ id: file.id });
  };

  if (computer.isError) return <DashboardLayout><div className="grid min-h-[65vh] place-items-center"><div className="text-center"><h1 className="text-xl font-bold">Nova could not open your files.</h1><Button onClick={() => computer.refetch()} className="mt-4">Try again</Button></div></div></DashboardLayout>;

  return <DashboardLayout>
    <div className="flex h-[calc(100vh-3.5rem-6rem)] min-h-[560px] overflow-hidden bg-white dark:bg-[#1e1e1e]">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-neutral-200 bg-[#f3f3f3] dark:border-[#2b2b2b] dark:bg-[#181818]">
        <div className="flex h-10 shrink-0 items-center justify-between px-4">
          <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Explorer</span>
          <div className="flex items-center gap-0.5">
            <button onClick={() => make("file")} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-white/10" title="New file"><FilePlus2 className="size-4" /></button>
            <button onClick={() => make("folder")} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-white/10" title="New folder"><FolderPlus className="size-4" /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1 text-[13px]">
          <button onClick={() => selectFolder(null)} className={`flex h-7 w-full items-center gap-1.5 px-2 text-left ${activeFolderId === null ? "bg-[#dcdcdc] text-neutral-950 dark:bg-[#37373d] dark:text-white" : "text-neutral-700 hover:bg-[#e7e7e7] dark:text-neutral-300 dark:hover:bg-[#2a2d2e]"}`}>
            <HardDrive className="ml-1 size-3.5 shrink-0" /><span className="truncate font-medium">NOVA WORKSPACE</span>
          </button>
          <Tree folders={folders} files={files} parentId={null} depth={0} activeFolderId={activeFolderId} expanded={expanded} setExpanded={setExpanded} selectFolder={selectFolder} open={open} deleteFile={confirmDeleteFile} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#1e1e1e]">
        {openFile ? <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center border-b border-neutral-200 bg-[#f3f3f3] dark:border-[#2b2b2b] dark:bg-[#181818]">
            <div className="flex h-full max-w-[300px] items-center gap-2 border-r border-neutral-200 bg-white px-3 text-xs dark:border-[#2b2b2b] dark:bg-[#1e1e1e]">
              <File className="size-3.5 text-neutral-500" /><span className="max-w-[220px] truncate">{openFile.name}</span>
              <button onClick={() => setOpenFile(null)} className="ml-1 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/10" title="Close"><X className="size-3.5" /></button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-4 py-2 text-[11px] text-neutral-400 dark:border-[#2b2b2b]">
              <div className="flex min-w-0 items-center gap-1"><span>workspace</span>{trail.map(folder => <React.Fragment key={folder.id}><ChevronRight className="size-3 shrink-0" /><span className="truncate">{folder.name}</span></React.Fragment>)}<ChevronRight className="size-3 shrink-0" /><span className="truncate text-neutral-600 dark:text-neutral-300">{openFile.name}</span></div>
              <span>{openFile.mimeType ?? "Plain text"}</span>
            </div>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} className="min-h-0 flex-1 resize-none border-0 bg-white p-5 font-mono text-[13px] leading-6 text-neutral-900 outline-none dark:bg-[#1e1e1e] dark:text-neutral-100" aria-label={`Edit ${openFile.name}`} />
            <div className="flex shrink-0 items-center justify-between border-t border-neutral-200 bg-[#f3f3f3] px-3 py-2 dark:border-[#2b2b2b] dark:bg-[#181818]">
              <span className="text-[11px] text-neutral-400">{draft.length} characters</span>
              <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setOpenFile(null)}><X className="mr-1.5 size-3.5" />Close</Button><Button size="sm" disabled={saveFile.isPending} onClick={() => saveFile.mutate({ id: openFile.id, content: draft })} className="bg-[#f97316] hover:bg-[#ea580c]"><Save className="mr-1.5 size-3.5" />{saveFile.isPending ? "Saving…" : "Save"}</Button></div>
            </div>
          </div>
        </div> : <div className="flex flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center border-b border-neutral-200 bg-[#f3f3f3] px-4 dark:border-[#2b2b2b] dark:bg-[#181818]"><span className="text-xs text-neutral-500 dark:text-neutral-400">{activeFolderId === null ? "NOVA WORKSPACE" : folders.find(f => f.id === activeFolderId)?.name}</span></div>
          <div className="flex flex-1 items-center justify-center text-center text-sm text-neutral-400"><div><FolderOpen className="mx-auto mb-3 size-10 opacity-40" /><p>Select a file from the Explorer to open it.</p></div></div>
        </div>}
      </main>
    </div>
  </DashboardLayout>;
}

function Tree({ folders, files, parentId, depth, activeFolderId, expanded, setExpanded, selectFolder, open, deleteFile }: TreeProps) {
  const children = folders.filter(folder => folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const childFiles = files.filter(file => file.folderId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  return <>
    {children.map(folder => {
      const isOpen = expanded.has(folder.id);
      const hasChildren = folders.some(f => f.parentId === folder.id) || files.some(f => f.folderId === folder.id);
      return <React.Fragment key={folder.id}>
        <button onClick={() => { selectFolder(folder.id); setExpanded(prev => { const next = new Set(prev); isOpen ? next.delete(folder.id) : next.add(folder.id); return next; }); }} className={`group flex h-7 w-full items-center gap-1 text-left hover:bg-[#e7e7e7] dark:hover:bg-[#2a2d2e] ${activeFolderId === folder.id ? "bg-[#dcdcdc] dark:bg-[#37373d]" : ""}`} style={{ paddingLeft: `${8 + depth * 16}px` }}>
          {hasChildren ? (isOpen ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />) : <span className="size-3.5 shrink-0" />}
          {isOpen ? <FolderOpen className="size-4 shrink-0 text-[#d88900]" /> : <Folder className="size-4 shrink-0 text-[#d88900]" />}
          <span className="min-w-0 truncate">{folder.name}</span>
        </button>
        {isOpen && <Tree folders={folders} files={files} parentId={folder.id} depth={depth + 1} activeFolderId={activeFolderId} expanded={expanded} setExpanded={setExpanded} selectFolder={selectFolder} open={open} deleteFile={deleteFile} />}
      </React.Fragment>;
    })}
    {childFiles.map(file => <div key={`file-${file.id}`} className="group relative flex h-7 w-full items-center hover:bg-[#e7e7e7] dark:hover:bg-[#2a2d2e]" style={{ paddingLeft: `${24 + depth * 16}px` }}>
      <button onClick={() => open(file)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-neutral-700 dark:text-neutral-300"><File className="size-3.5 shrink-0 text-neutral-400" /><span className="min-w-0 truncate">{file.name}</span></button>
      <button onClick={event => deleteFile(file, event)} disabled={false} className="mr-1 hidden rounded p-1 text-neutral-400 hover:bg-neutral-300 hover:text-red-600 group-hover:block dark:hover:bg-white/10 dark:hover:text-red-400" title={`Delete ${file.name}`} aria-label={`Delete ${file.name}`}><Trash2 className="size-3.5" /></button>
    </div>)}
  </>;
}
