import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Bot, ChevronRight, FileText, Folder, FolderPlus, MoreHorizontal, Paperclip, Pencil, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

const elapsed = (date: Date) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  return mins < 2 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
};

export default function Workspace() {
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState("");
  const [chatId, setChatId] = useState<number | undefined>(() => Number(new URLSearchParams(window.location.search).get("chatId")) || undefined);
  const [conversation, setConversation] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const folders = computer.data?.folders ?? [];
  const files = useMemo(() => computer.data?.files.slice(0, 6) ?? [], [computer.data?.files]);
  const createFolder = trpc.folders.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const createFile = trpc.files.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const createChat = trpc.chats.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const renameFolder = trpc.folders.update.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const removeFolder = trpc.folders.delete.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const renameFile = trpc.files.update.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const removeFile = trpc.files.delete.useMutation({ onSuccess: () => utils.workspace.computer.invalidate(), onError: e => toast.error(e.message) });
  const savedMessages = trpc.chats.messages.useQuery({ chatId: chatId ?? 1 }, { enabled: Boolean(chatId), retry: false });
  const send = trpc.chats.send.useMutation({ onSuccess: result => { setChatId(result.chatId); setConversation(current => [...current, { role: "assistant", content: result.message?.content ?? "I’m ready to help with this workspace." }]); utils.workspace.computer.invalidate(); }, onError: error => toast.error(error.message) });
  const make = (kind: "folder" | "file") => {
    const name = window.prompt(`Name this ${kind}`)?.trim();
    if (!name) return;
    kind === "folder" ? createFolder.mutate({ name }) : createFile.mutate({ name, content: "" });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    setConversation(current => [...current, { role: "user", content: draft.trim() }]);
    send.mutate({ chatId, content: draft.trim() });
    setDraft("");
  };
  const visibleMessages = chatId && savedMessages.data ? savedMessages.data.map(message => ({ role: message.role, content: message.content })) : conversation;
  if (computer.isError) return <DashboardLayout><div className="grid min-h-[65vh] place-items-center text-center"><div><Sparkles className="mx-auto text-cyan-200" /><h1 className="mt-4 text-2xl font-semibold">Nova could not open your computer.</h1><Button className="mt-5 bg-cyan-300 text-slate-950" onClick={() => computer.refetch()}>Try again</Button></div></div></DashboardLayout>;

  return <DashboardLayout><div className="grid min-h-[calc(100vh-10.5rem)] gap-4 xl:grid-cols-[250px_minmax(0,1fr)_280px]">
    <aside className="order-2 rounded-2xl border border-white/9 bg-[#10161f] p-3 xl:order-1">
      <div className="mb-3 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/45">Your computer</span><Button variant="ghost" size="icon" onClick={() => make("folder")} className="size-7 text-white/55 hover:bg-white/8 hover:text-white"><FolderPlus className="size-4" /></Button></div>
      <div className="space-y-1"><div className="flex items-center gap-2 rounded-lg bg-cyan-300/10 px-2.5 py-2 text-sm text-cyan-100"><Folder className="size-4 text-cyan-300" />Home</div>{folders.map(folder => <div key={folder.id} className="group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-white/62 hover:bg-white/6"><ChevronRight className="size-3 text-white/28" /><Folder className="size-4 text-amber-200" /><span className="min-w-0 flex-1 truncate">{folder.name}</span><button onClick={() => { const name = window.prompt("Rename folder", folder.name)?.trim(); if (name) renameFolder.mutate({ id: folder.id, name }); }} className="hidden text-white/35 group-hover:block"><Pencil className="size-3" /></button><button onClick={() => window.confirm(`Delete ${folder.name} and its contents?`) && removeFolder.mutate({ id: folder.id })} className="hidden text-rose-200/70 group-hover:block"><Trash2 className="size-3" /></button></div>)}</div>
      <p className="mt-5 px-2 text-[10px] font-semibold uppercase tracking-[.16em] text-white/40">Recent files</p>
      <div className="mt-2 space-y-1">{files.length ? files.map(file => <div key={file.id} className="group flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-white/60 hover:bg-white/6 hover:text-white"><FileText className="size-4 text-sky-200" /><span className="min-w-0 flex-1 truncate">{file.name}</span><button onClick={() => { const name = window.prompt("Rename file", file.name)?.trim(); if (name) renameFile.mutate({ id: file.id, name }); }} className="hidden text-white/35 group-hover:block"><Pencil className="size-3" /></button><button onClick={() => window.confirm(`Delete ${file.name}?`) && removeFile.mutate({ id: file.id })} className="hidden text-rose-200/70 group-hover:block"><Trash2 className="size-3" /></button></div>) : <p className="px-2 py-3 text-xs leading-5 text-white/35">Add files or folders. Nova can help you keep them organized.</p>}</div>
      <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => make("file")} className="border-white/10 bg-transparent text-xs text-white/70 hover:bg-white/7 hover:text-white"><Plus className="mr-1 size-3" />File</Button><Button variant="outline" onClick={() => createChat.mutate({ title: "New workspace conversation" })} className="border-white/10 bg-transparent text-xs text-white/70 hover:bg-white/7 hover:text-white"><Plus className="mr-1 size-3" />Chat</Button></div>
    </aside>

    <section className="flex min-h-[610px] flex-col overflow-hidden rounded-[1.45rem] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(57,191,201,0.14),transparent_43%),#111823] shadow-2xl shadow-black/20">
      <div className="flex items-center justify-between border-b border-white/9 px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-xl bg-cyan-300 text-slate-950"><Bot className="size-4" /></span><div><p className="text-sm font-semibold">Nova agent</p><p className="text-xs text-white/43">Workspace-aware assistant</p></div></div><MoreHorizontal className="size-4 text-white/45" /></div>
      <div className="flex flex-1 overflow-y-auto px-6 py-10">{visibleMessages.length ? <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 self-end">{visibleMessages.map((message, index) => <div key={index} className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "ml-auto bg-cyan-300 text-slate-950" : "bg-white/8 text-white/80"}`}>{message.content}</div>)}{send.isPending && <div className="w-fit rounded-2xl bg-white/8 px-4 py-3 text-sm text-white/55">Nova is working…</div>}</div> : <div className="m-auto max-w-xl text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-cyan-300/12 text-cyan-200"><Sparkles className="size-5" /></span><p className="mt-5 text-[11px] font-semibold uppercase tracking-[.18em] text-cyan-200/75">Your private workspace</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">What would you like to make?</h1><p className="mt-3 text-sm leading-6 text-white/52">Ask Nova to think with you, write a file, or organize what is already on your computer.</p><div className="mt-7 flex flex-wrap justify-center gap-2"><button onClick={() => setDraft("Create a project brief in a new folder") } className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65 hover:bg-white/10 hover:text-white">Create a project brief</button><button onClick={() => setDraft("Organize my workspace files") } className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65 hover:bg-white/10 hover:text-white">Organize my files</button></div></div>}</div>
      <form onSubmit={submit} className="border-t border-white/9 bg-black/10 p-3 sm:p-4"><div className="rounded-2xl border border-white/12 bg-[#0b1018] p-2 focus-within:border-cyan-300/55"><Textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Message Nova about your workspace…" className="min-h-16 resize-none border-0 bg-transparent px-2 py-2 text-sm text-white placeholder:text-white/35 focus-visible:ring-0" /><div className="flex items-center justify-between px-1"><Paperclip className="size-4 text-white/40" /><Button type="submit" disabled={!draft.trim()} className="h-8 rounded-lg bg-cyan-300 px-3 text-xs text-slate-950 hover:bg-cyan-200"><Send className="mr-1.5 size-3.5" />Send</Button></div></div></form>
    </section>

    <aside className="rounded-2xl border border-white/9 bg-[#10161f] p-4"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/45">On this computer</p><div className="mt-4 grid grid-cols-2 gap-2"><Metric value={folders.length} label="folders" /><Metric value={computer.data?.files.length ?? 0} label="files" /></div><div className="mt-6"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/45">Recent activity</p><span className="text-[10px] text-white/30">Private</span></div><div className="mt-3 space-y-3">{files.length ? files.map(file => <div key={file.id} className="flex gap-2"><FileText className="mt-0.5 size-3.5 text-sky-200" /><div className="min-w-0"><p className="truncate text-xs text-white/70">{file.name}</p><p className="text-[10px] text-white/35">Edited {elapsed(file.updatedAt)}</p></div></div>) : <p className="text-xs leading-5 text-white/35">Your work will appear here.</p>}</div></div></aside>
  </div></DashboardLayout>;
}

function Metric({ value, label }: { value: number; label: string }) { return <div className="rounded-xl bg-white/5 p-3"><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-[11px] text-white/43">{label}</p></div>; }
