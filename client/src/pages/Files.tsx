import CodeEditor, { type EditorCursor } from "@/components/CodeEditor";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { detectLanguage, languageLabel } from "@/lib/syntaxHighlight";
import { getFolderTrail } from "@/lib/workspaceBrowser";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, ChevronsDownUp, File, FilePlus2, Folder, FolderOpen, FolderPlus, HardDrive, Trash2, X } from "lucide-react";
import React, { useMemo, useState } from "react";

type OpenFile = { id: number; name: string; content: string; mimeType?: string | null; folderId?: number | null };
type Creating = { kind: "file" | "folder"; parentId: number | null };
type TreeProps = { folders: any[]; files: any[]; parentId: number | null; depth: number; activeFolderId: number | null; expanded: Set<number>; setExpanded: React.Dispatch<React.SetStateAction<Set<number>>>; selectFolder: (id: number | null) => void; open: (file: OpenFile) => void; remove: (file: any, e?: React.MouseEvent) => void; creating: Creating | null; finishCreate: (name: string) => void; cancelCreate: () => void };

export default function Files() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState<Creating | null>(null);
  const [tabs, setTabs] = useState<OpenFile[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [cursor, setCursor] = useState<EditorCursor>({ line: 1, column: 1 });
  const folders = computer.data?.folders ?? [];
  const files = computer.data?.files ?? [];
  const activeFile = tabs.find(tab => tab.id === activeId) ?? null;
  const draft = activeFile ? (drafts[activeFile.id] ?? activeFile.content) : "";
  const isDirty = (tab: OpenFile) => drafts[tab.id] !== undefined && drafts[tab.id] !== tab.content;
  const language = activeFile ? detectLanguage(activeFile.name, activeFile.mimeType) : "text";
  const breadcrumb = useMemo(() => getFolderTrail(folders, activeFile?.folderId ?? null), [folders, activeFile?.folderId]);

  const createFolder = trpc.folders.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const createFile = trpc.files.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const deleteFile = trpc.files.delete.useMutation({
    onSuccess: (_, vars) => { setTabs(prev => prev.filter(tab => tab.id !== vars.id)); if (activeId === vars.id) setActiveId(null); utils.workspace.computer.invalidate(); toast.success("File deleted"); },
    onError: e => toast.error(e.message),
  });
  const saveFile = trpc.files.update.useMutation({
    onSuccess: (_, vars) => {
      setDrafts(prev => { const next = { ...prev }; delete next[vars.id]; return next; });
      setTabs(prev => prev.map(tab => tab.id === vars.id ? { ...tab, content: vars.content ?? "" } : tab));
      utils.workspace.computer.invalidate();
      toast.success("File saved");
    },
    onError: e => toast.error(e.message),
  });

  // VS Code style: new file/folder opens an inline input inside the selected folder.
  const make = (kind: "file" | "folder") => {
    if (activeFolderId !== null) setExpanded(p => new Set(p).add(activeFolderId));
    setCreating({ kind, parentId: activeFolderId });
  };
  const finishCreate = (name: string) => {
    const target = creating;
    setCreating(null);
    if (!target) return;
    if (target.kind === "folder") { const pid = target.parentId; createFolder.mutate({ name, parentId: pid }); if (pid !== null) setExpanded(p => new Set(p).add(pid)); }
    else createFile.mutate({ name, content: "", folderId: target.parentId });
  };
  const collapseAll = () => { setExpanded(new Set()); setActiveFolderId(null); setCreating(null); };
  const open = (file: OpenFile) => {
    setTabs(prev => prev.some(tab => tab.id === file.id) ? prev : [...prev, { id: file.id, name: file.name, content: file.content ?? "", mimeType: file.mimeType, folderId: file.folderId }]);
    setActiveId(file.id);
  };
  const closeTab = (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const index = tabs.findIndex(tab => tab.id === id);
    const next = tabs.filter(tab => tab.id !== id);
    if (id === activeId) setActiveId(next[index]?.id ?? next[index - 1]?.id ?? null);
    setTabs(next);
    setDrafts(prev => { const draft = { ...prev }; delete draft[id]; return draft; });
  };
  const changeDraft = (value: string) => { if (activeFile) setDrafts(prev => ({ ...prev, [activeFile.id]: value })); };
  const save = () => { if (activeFile && isDirty(activeFile)) saveFile.mutate({ id: activeFile.id, content: draft }); };
  const selectFolder = (id: number | null) => { setActiveFolderId(id); if (id !== null) setExpanded(p => new Set(p).add(id)); };
  const remove = (file: any, e?: React.MouseEvent) => { e?.stopPropagation(); if (window.confirm(`Delete “${file.name}”? This cannot be undone.`)) deleteFile.mutate({ id: file.id }); };

  if (computer.isError) return <DashboardLayout><div className="grid min-h-[65vh] place-items-center"><div className="text-center"><h1 className="text-xl font-bold">Nova could not open your files.</h1><Button onClick={() => computer.refetch()} className="mt-4">Try again</Button></div></div></DashboardLayout>;

  return <DashboardLayout>
    <div className="mx-auto flex h-[calc(100svh-5rem)] min-h-0 max-w-none flex-col overflow-hidden border-0 sm:mx-4 sm:my-1 sm:rounded-2xl sm:border sm:border-border sm:shadow-[0_1px_2px_rgba(10,10,10,0.03)] md:h-full lg:mx-6 lg:flex-row dark:sm:border-white/10">
      <aside className="flex h-44 w-full shrink-0 flex-col sm:h-56 border-b border-border bg-muted/70 lg:h-auto lg:w-[248px] lg:border-b-0 lg:border-r dark:border-white/10 dark:bg-card/40">
        <div className="flex h-9 shrink-0 items-center justify-between gap-1 px-2"><span className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Explorer</span><div className="flex shrink-0 items-center gap-0.5"><button onClick={() => make("file")} title="New file" aria-label="New file" className="grid size-6 max-sm:size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-neutral-200/70 hover:text-foreground dark:hover:bg-card/10 dark:hover:text-white"><FilePlus2 className="size-3.5" /></button><button onClick={() => make("folder")} title="New folder" aria-label="New folder" className="grid size-6 max-sm:size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-neutral-200/70 hover:text-foreground dark:hover:bg-card/10 dark:hover:text-white"><FolderPlus className="size-3.5" /></button><button onClick={collapseAll} title="Collapse folders" aria-label="Collapse folders" className="grid size-6 max-sm:size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-neutral-200/70 hover:text-foreground dark:hover:bg-card/10 dark:hover:text-white"><ChevronsDownUp className="size-3.5" /></button></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1 pt-0.5 text-[13px]">
          <button onClick={() => selectFolder(null)} className={`flex h-[26px] max-sm:h-9 w-full items-center gap-1.5 rounded-sm px-2 text-left transition ${activeFolderId === null ? "bg-neutral-200/80 text-foreground dark:bg-card/10 dark:text-foreground" : "text-muted-foreground hover:bg-neutral-200/50 dark:text-foreground/80 dark:hover:bg-card/5"}`}><HardDrive className="size-3.5 shrink-0" /><span className="min-w-0 truncate font-semibold">NOVA WORKSPACE</span></button>
          <Tree folders={folders} files={files} parentId={null} depth={0} activeFolderId={activeFolderId} expanded={expanded} setExpanded={setExpanded} selectFolder={selectFolder} open={open} remove={remove} creating={creating} finishCreate={finishCreate} cancelCreate={() => setCreating(null)} />
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-card dark:bg-background">
        {activeFile ? <>
          <div role="tablist" aria-label="Open files" className="flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-border bg-muted/40 dark:border-white/10 dark:bg-card/30">
            {tabs.map(tab => {
              const isActive = tab.id === activeId;
              const dirty = isDirty(tab);
              return <div key={tab.id} role="tab" aria-selected={isActive} className={`group relative flex min-w-0 max-w-[220px] shrink-0 items-center gap-1.5 border-r border-border/70 px-3 text-[13px] transition dark:border-white/10 ${isActive ? "bg-card text-foreground shadow-[inset_0_2px_0_0_var(--primary)] dark:bg-[#0d0d0d]" : "text-muted-foreground hover:bg-neutral-200/40 dark:hover:bg-card/10"}`}>
                <button onClick={() => setActiveId(tab.id)} className="flex min-w-0 items-center gap-1.5 py-2" title={tab.name}>
                  <File className={`size-3.5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`min-w-0 truncate ${dirty ? "italic" : ""}`}>{tab.name}</span>
                </button>
                {dirty && <span className="size-2 shrink-0 rounded-full bg-foreground/70 group-hover:hidden" aria-label="Unsaved changes" />}
                <button onClick={e => closeTab(tab.id, e)} aria-label={`Close ${tab.name}`} className={`grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground transition hover:bg-neutral-200/80 dark:hover:bg-card/20 ${dirty ? "hidden group-hover:grid" : isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}><X className="size-3.5" /></button>
              </div>;
            })}
          </div>
          <div className="flex h-8 shrink-0 items-center gap-1 overflow-hidden border-b border-border bg-card px-3 text-xs text-muted-foreground dark:border-white/10 dark:bg-[#0d0d0d]">
            <Folder className="size-3 shrink-0 text-primary/70" /><span className="truncate">workspace</span>
            {breadcrumb.map(folder => <React.Fragment key={folder.id}><ChevronRight className="size-3 shrink-0" /><span className="truncate hover:text-foreground dark:hover:text-white">{folder.name}</span></React.Fragment>)}
            <ChevronRight className="size-3 shrink-0" /><File className="size-3 shrink-0 text-primary/70" /><span className="truncate font-medium text-foreground/80 dark:text-foreground">{activeFile.name}</span>
          </div>
          <CodeEditor value={draft} language={language} onChange={changeDraft} onCursorChange={setCursor} onSave={save} ariaLabel={`Edit ${activeFile.name}`} />
          <div className="flex h-6 shrink-0 items-center justify-between gap-3 bg-primary px-3 text-[11px] font-medium text-primary-foreground">
            <div className="flex min-w-0 items-center gap-3">
              {isDirty(activeFile) && <span className="flex items-center gap-1" title="Unsaved changes"><span className="size-1.5 rounded-full bg-primary-foreground/80" />Unsaved</span>}
              <span className="truncate">Ln {cursor.line}, Col {cursor.column}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span>{draft.length} characters</span>
              <span className="hidden sm:inline">Spaces: 2</span>
              <span className="hidden sm:inline">UTF-8</span>
              <span className="hidden md:inline">LF</span>
              <button onClick={save} disabled={!isDirty(activeFile) || saveFile.isPending} className="rounded px-1.5 transition hover:bg-primary-foreground/15 disabled:opacity-60">{saveFile.isPending ? "Saving…" : "Save"}</button>
              <span>{languageLabel(language)}</span>
            </div>
          </div>
        </> : <><div className="flex h-12 shrink-0 items-center border-b border-border bg-card px-4 text-xs font-semibold text-muted-foreground dark:border-white/10 dark:bg-card dark:text-foreground/80">{activeFolderId === null ? "NOVA WORKSPACE" : folders.find(f => f.id === activeFolderId)?.name}</div><div className="flex flex-1 items-center justify-center text-sm text-muted-foreground"><div className="text-center"><span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15"><FolderOpen className="size-7" /></span><p className="text-muted-foreground dark:text-muted-foreground">Select a file from the Explorer to open it.</p></div></div></>}
      </main>
    </div>
  </DashboardLayout>;
}

function CreateRow({ kind, depth, finish, cancel }: { kind: "file" | "folder"; depth: number; finish: (name: string) => void; cancel: () => void }) {
  const [name, setName] = useState("");
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (name.trim()) finish(name.trim()); else cancel(); };
  return <form onSubmit={submit} className="flex h-[26px] max-sm:h-9 w-full items-center gap-1" style={{ paddingLeft: `${6 + depth * 12}px` }}>
    {kind === "folder" ? <Folder className="size-3.5 shrink-0 text-primary/80" /> : <File className="size-3.5 shrink-0 text-muted-foreground" />}
    <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={cancel} onKeyDown={e => e.key === "Escape" && cancel()} spellCheck={false} placeholder={kind === "file" ? "file.md" : "folder"} aria-label={kind === "file" ? "New file name" : "New folder name"} className="h-[22px] max-sm:h-7 min-w-0 flex-1 rounded-sm border border-primary/40 bg-background px-1.5 text-[16px] text-foreground outline-none focus:border-primary sm:h-[22px] sm:text-[13px] dark:text-foreground" />
  </form>;
}

function Tree({ folders, files, parentId, depth, activeFolderId, expanded, setExpanded, selectFolder, open, remove, creating, finishCreate, cancelCreate }: TreeProps) {
  const childFolders = folders.filter(f => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const childFiles = files.filter(f => f.folderId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  return <>
    {creating && creating.parentId === parentId && <CreateRow kind={creating.kind} depth={depth} finish={finishCreate} cancel={cancelCreate} />}
    {childFolders.map(folder => { const isOpen = expanded.has(folder.id); const hasChildren = folders.some(f => f.parentId === folder.id) || files.some(f => f.folderId === folder.id); return <React.Fragment key={folder.id}><button onClick={() => { selectFolder(folder.id); setExpanded(p => { const n = new Set(p); isOpen ? n.delete(folder.id) : n.add(folder.id); return n; }); }} className={`flex h-[26px] max-sm:h-9 w-full items-center gap-1 rounded-sm text-left transition hover:bg-neutral-200/50 dark:hover:bg-card/5 ${activeFolderId === folder.id ? "bg-neutral-200/80 text-foreground dark:bg-card/10 dark:text-foreground" : "text-foreground/80 dark:text-foreground/80"}`} style={{ paddingLeft: `${8 + depth * 12}px` }}>{hasChildren ? (isOpen ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />) : <span className="size-3 shrink-0" />}{isOpen ? <FolderOpen className="size-3.5 shrink-0 text-primary/80" /> : <Folder className="size-3.5 shrink-0 text-primary/80" />}<span className="min-w-0 truncate">{folder.name}</span></button>{isOpen && <Tree folders={folders} files={files} parentId={folder.id} depth={depth + 1} activeFolderId={activeFolderId} expanded={expanded} setExpanded={setExpanded} selectFolder={selectFolder} open={open} remove={remove} creating={creating} finishCreate={finishCreate} cancelCreate={cancelCreate} />}</React.Fragment>; })}
    {childFiles.map(file => <div key={`file-${file.id}`} className="group flex h-[26px] max-sm:h-9 w-full items-center rounded-sm transition hover:bg-neutral-200/50 dark:hover:bg-card/5" style={{ paddingLeft: `${22 + depth * 12}px` }}><button onClick={() => open(file)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-foreground/80 dark:text-foreground/80"><File className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">{file.name}</span></button><button onClick={e => remove(file, e)} className="mr-1 hidden rounded-sm p-1 max-sm:mr-1.5 max-sm:p-1.5 text-muted-foreground transition hover:text-red-600 max-sm:block group-hover:block dark:hover:text-red-400" title={`Delete ${file.name}`} aria-label={`Delete ${file.name}`}><Trash2 className="size-3.5" /></button></div>)}
  </>;
}
