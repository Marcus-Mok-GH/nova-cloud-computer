import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { detectLanguage, HighlightedCode, languageLabel } from "@/lib/syntaxHighlight";
import { getFolderTrail } from "@/lib/workspaceBrowser";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, File, FilePlus2, Folder, FolderOpen, FolderPlus, HardDrive, Pencil, Save, Trash2, X } from "lucide-react";
import React, { useMemo, useState } from "react";

type OpenFile = { id: number; name: string; content?: string | null; mimeType?: string | null; folderId?: number | null };
type TreeProps = { folders: any[]; files: any[]; parentId: number | null; depth: number; activeFolderId: number | null; expanded: Set<number>; setExpanded: React.Dispatch<React.SetStateAction<Set<number>>>; selectFolder: (id: number | null) => void; open: (file: OpenFile) => void; remove: (file: any, e?: React.MouseEvent) => void };

export default function Files() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const folders = computer.data?.folders ?? [];
  const files = computer.data?.files ?? [];
  const trail = useMemo(() => getFolderTrail(folders, activeFolderId), [folders, activeFolderId]);
  const language = openFile ? detectLanguage(openFile.name, openFile.mimeType) : "text";

  const createFolder = trpc.folders.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const createFile = trpc.files.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const deleteFile = trpc.files.delete.useMutation({
    onSuccess: (_, vars) => { if (openFile?.id === vars.id) setOpenFile(null); utils.workspace.computer.invalidate(); toast.success("File deleted"); },
    onError: e => toast.error(e.message),
  });
  const saveFile = trpc.files.update.useMutation({
    onSuccess: async () => { if (openFile) setOpenFile({ ...openFile, content: draft }); setEditing(false); await utils.workspace.computer.invalidate(); toast.success("File saved"); },
    onError: e => toast.error(e.message),
  });

  const make = (kind: "file" | "folder") => {
    const name = window.prompt(`Name this ${kind}`)?.trim();
    if (!name) return;
    kind === "folder" ? createFolder.mutate({ name, parentId: activeFolderId }) : createFile.mutate({ name, content: "", folderId: activeFolderId });
  };
  const open = (file: OpenFile) => { setOpenFile(file); setDraft(file.content ?? ""); setEditing(false); };
  const selectFolder = (id: number | null) => { setActiveFolderId(id); if (id !== null) setExpanded(p => new Set(p).add(id)); };
  const remove = (file: any, e?: React.MouseEvent) => { e?.stopPropagation(); if (window.confirm(`Delete “${file.name}”? This cannot be undone.`)) deleteFile.mutate({ id: file.id }); };

  if (computer.isError) return <DashboardLayout><div className="grid min-h-[65vh] place-items-center"><div className="text-center"><h1 className="text-xl font-bold">Nova could not open your files.</h1><Button onClick={() => computer.refetch()} className="mt-4">Try again</Button></div></div></DashboardLayout>;

  return <DashboardLayout>
    <div className="mx-auto flex h-full min-h-0 max-w-none flex-col overflow-hidden border-0 sm:mx-4 sm:my-1 sm:rounded-2xl sm:border sm:border-border sm:shadow-[0_1px_2px_rgba(10,10,10,0.03)] lg:mx-6 lg:flex-row dark:sm:border-white/10">
      <aside className="flex h-56 w-full shrink-0 flex-col border-b border-border bg-muted/70 lg:h-auto lg:w-[248px] lg:border-b-0 lg:border-r dark:border-white/10 dark:bg-card/40">
        <div className="flex h-12 shrink-0 items-center justify-between px-3"><span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Explorer</span><div className="flex gap-1"><button onClick={() => make("file")} title="New file" aria-label="New file" className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-neutral-200/70 hover:text-foreground dark:hover:bg-card/10 dark:hover:text-white"><FilePlus2 className="size-4" /></button><button onClick={() => make("folder")} title="New folder" aria-label="New folder" className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-neutral-200/70 hover:text-foreground dark:hover:bg-card/10 dark:hover:text-white"><FolderPlus className="size-4" /></button></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1 text-[13px]">
          <button onClick={() => selectFolder(null)} className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition ${activeFolderId === null ? "bg-neutral-200/80 text-foreground dark:bg-card/10 dark:text-foreground" : "text-muted-foreground hover:bg-neutral-200/50 dark:text-foreground/80 dark:hover:bg-card/5"}`}><HardDrive className="ml-0.5 size-3.5" /><span className="font-semibold">NOVA WORKSPACE</span></button>
          <Tree folders={folders} files={files} parentId={null} depth={0} activeFolderId={activeFolderId} expanded={expanded} setExpanded={setExpanded} selectFolder={selectFolder} open={open} remove={remove} />
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-card dark:bg-background">
        {openFile ? <>
          <div className="flex h-12 shrink-0 items-center border-b border-border bg-card px-3 dark:border-white/10 dark:bg-card"><div className="flex h-full items-center gap-2 text-sm"><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><File className="size-4" /></span><div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><span className="hover:text-foreground dark:hover:text-white">workspace</span>{trail.map(f => <React.Fragment key={f.id}><ChevronRight className="size-3" /><span className="truncate">{f.name}</span></React.Fragment>)}<ChevronRight className="size-3" /><span className="max-w-[280px] truncate font-semibold text-foreground/80 dark:text-foreground">{openFile.name}</span></div></div><button onClick={() => setOpenFile(null)} aria-label="Close file" className="ml-auto grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-neutral-100 hover:text-foreground dark:hover:bg-card/10 dark:hover:text-white"><X className="size-4" /></button></div>
          <div className="flex min-h-0 flex-1 flex-col">
            {editing ? <textarea value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} className="min-h-0 flex-1 resize-none border-0 bg-card p-5 font-mono text-[13px] leading-6 outline-none dark:bg-background dark:text-foreground" aria-label={`Edit ${openFile.name}`} /> : <div className="min-h-0 flex-1 overflow-auto bg-card dark:bg-background"><pre className="m-0 min-h-full whitespace-pre p-5 font-mono text-[13px] leading-6 text-foreground dark:text-foreground"><HighlightedCode code={draft} language={language} /></pre></div>}
            <div className="flex shrink-0 items-center justify-between border-t border-border bg-muted/70 px-4 py-2.5 dark:border-white/10 dark:bg-card/40"><span className="text-[11px] text-muted-foreground">{draft.length} characters · {languageLabel(language)}</span><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setOpenFile(null)}><X className="mr-1.5 size-3.5" />Close</Button>{editing ? <Button size="sm" disabled={saveFile.isPending} onClick={() => saveFile.mutate({ id: openFile.id, content: draft })} className="bg-primary hover:bg-primary/90"><Save className="mr-1.5 size-3.5" />{saveFile.isPending ? "Saving…" : "Save"}</Button> : <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="mr-1.5 size-3.5" />Edit</Button>}</div></div>
          </div>
        </> : <><div className="flex h-12 shrink-0 items-center border-b border-border bg-card px-4 text-xs font-semibold text-muted-foreground dark:border-white/10 dark:bg-card dark:text-foreground/80">{activeFolderId === null ? "NOVA WORKSPACE" : folders.find(f => f.id === activeFolderId)?.name}</div><div className="flex flex-1 items-center justify-center text-sm text-muted-foreground"><div className="text-center"><FolderOpen className="mx-auto mb-3 size-10 text-[oklch(0.60_0.02_250/0.50)]" /><p className="text-muted-foreground dark:text-muted-foreground">Select a file from the Explorer to open it.</p></div></div></>}
      </main>
    </div>
  </DashboardLayout>;
}

function Tree({ folders, files, parentId, depth, activeFolderId, expanded, setExpanded, selectFolder, open, remove }: TreeProps) {
  const childFolders = folders.filter(f => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const childFiles = files.filter(f => f.folderId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  return <>
    {childFolders.map(folder => { const isOpen = expanded.has(folder.id); const hasChildren = folders.some(f => f.parentId === folder.id) || files.some(f => f.folderId === folder.id); return <React.Fragment key={folder.id}><button onClick={() => { selectFolder(folder.id); setExpanded(p => { const n = new Set(p); isOpen ? n.delete(folder.id) : n.add(folder.id); return n; }); }} className={`flex h-8 w-full items-center gap-1.5 rounded-md text-left transition hover:bg-neutral-200/50 dark:hover:bg-card/5 ${activeFolderId === folder.id ? "bg-neutral-200/80 text-foreground dark:bg-card/10 dark:text-foreground" : "text-foreground/80 dark:text-foreground/80"}`} style={{ paddingLeft: `${10 + depth * 16}px` }}>{hasChildren ? (isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />) : <span className="size-3.5" />}{isOpen ? <FolderOpen className="size-4 shrink-0 text-primary/80" /> : <Folder className="size-4 shrink-0 text-primary/80" />}<span className="min-w-0 truncate">{folder.name}</span></button>{isOpen && <Tree folders={folders} files={files} parentId={folder.id} depth={depth + 1} activeFolderId={activeFolderId} expanded={expanded} setExpanded={setExpanded} selectFolder={selectFolder} open={open} remove={remove} />}</React.Fragment>; })}
    {childFiles.map(file => <div key={`file-${file.id}`} className="group flex h-8 w-full items-center rounded-md transition hover:bg-neutral-200/50 dark:hover:bg-card/5" style={{ paddingLeft: `${26 + depth * 16}px` }}><button onClick={() => open(file)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-foreground/80 dark:text-foreground/80"><File className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">{file.name}</span></button><button onClick={e => remove(file, e)} className="mr-1 hidden rounded-md p-1 text-muted-foreground transition hover:text-red-600 group-hover:block dark:hover:text-red-400" title={`Delete ${file.name}`} aria-label={`Delete ${file.name}`}><Trash2 className="size-3.5" /></button></div>)}
  </>;
}
