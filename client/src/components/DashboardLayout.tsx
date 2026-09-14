import React, { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";
import { ChevronsLeft, ChevronsRight, LogOut, MessageSquareText, Moon, Plus, Search, Sun } from "lucide-react";
import { navItems as nav } from "@/lib/nav";
import NovaMark from "./NovaMark";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";


export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const recentChats = (computer.data?.chats ?? []).slice(0, 12);
  const recentFiles = (computer.data?.files ?? []).slice(0, 6);
  const isChatWorkspace = location.startsWith("/app/chats") || new URLSearchParams(search).has("chatId");
  const createChat = trpc.chats.create.useMutation({ onSuccess: async () => { await utils.workspace.computer.invalidate(); } });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = window.localStorage.getItem("nova.sidebar.collapsed");
    if (stored === "1") return true;
    if (stored === "0") return false;
    return window.innerWidth < 768;
  });
  useEffect(() => { window.localStorage.setItem("nova.sidebar.collapsed", sidebarCollapsed ? "1" : "0"); }, [sidebarCollapsed]);


  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-6"><div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.12)] sm:p-8"><NovaMark size={34} className="mx-auto" /><h1 className="mt-5 text-2xl font-extrabold tracking-tight text-foreground">Sign in to continue</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Your private computer and its agent are available after passwordless sign-in.</p><button onClick={() => window.location.assign("/sign-in")} className="pill-btn pill-btn-primary mt-6 w-full">Sign in</button></div></div>;

  const isActive = (path: string) => path === "/app" ? location === "/app" || location.startsWith("/app?") : location === path || location.startsWith(`${path}?`);
  const handleNewChat = async () => { try { const chat = await createChat.mutateAsync({ title: "New workspace conversation" }); setLocation(`/app?chatId=${chat.id}`); } catch {} };

  return (
    <div className="dashboard-shell flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/88 px-3 backdrop-blur-xl sm:px-5 lg:px-7">
        <button onClick={() => setLocation("/app")} className="flex min-w-0 items-center gap-2 rounded-xl px-1.5 py-1 outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"><NovaMark size={22} /><span className="truncate text-[15px] font-extrabold tracking-tight text-foreground">Nova</span></button>
        <div className="ml-2 flex shrink-0 items-center gap-2">{isChatWorkspace && <span className="hidden items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-emerald-500" />Chat workspace</span>}<DropdownMenu><DropdownMenuTrigger asChild><button className="rounded-full outline-none transition hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu"><Avatar className="size-8 border border-border"><AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">{user.name?.charAt(0).toUpperCase() || "N"}</AvatarFallback></Avatar></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-[min(15rem,calc(100vw-1rem))] rounded-xl"><div className="border-b border-border px-3 py-3 text-xs text-muted-foreground">{user.email}</div><DropdownMenuItem onClick={toggleTheme} className="cursor-pointer rounded-lg py-2.5">{theme === "light" ? <Moon className="mr-2 size-4" /> : <Sun className="mr-2 size-4" />}Switch to {theme === "light" ? "dark" : "light"} theme</DropdownMenuItem><DropdownMenuItem onClick={logout} className="cursor-pointer rounded-lg py-2.5 text-red-500 focus:text-red-500"><LogOut className="mr-2 size-4" />Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      </header>

      {!isChatWorkspace && <aside aria-label="Workspace navigation" className={`fixed inset-y-14 bottom-0 left-0 z-30 border-r border-border bg-muted/40 dark:border-white/5 dark:bg-card/40 ${sidebarCollapsed ? "w-[68px]" : "w-[176px] sm:w-[204px] lg:w-[228px]"}`}><div className="flex h-full flex-col p-3">{!sidebarCollapsed && <p className="px-2 pb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Your space</p>}<div className="space-y-1">{nav.map(tab => <button key={tab.label} onClick={() => setLocation(tab.path)} title={tab.label} aria-label={tab.label} className={`flex w-full items-center rounded-xl text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60 ${sidebarCollapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2.5"} ${isActive(tab.path) ? "bg-card text-foreground shadow-sm dark:bg-card dark:text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}><tab.icon className="size-4" />{!sidebarCollapsed && tab.label}</button>)}</div>{!sidebarCollapsed && <div className="mt-8 border-t border-border pt-3 dark:border-white/5"><p className="px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Recent</p><div className="mt-2 space-y-0.5">{recentFiles.length ? recentFiles.map(file => <button key={file.id} onClick={() => setLocation("/app/files")} className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground">{file.name}</button>) : <p className="px-2 py-1.5 text-xs text-muted-foreground">No files yet.</p>}</div></div>}<button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="mt-auto grid size-9 shrink-0 place-items-center self-center rounded-xl text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={sidebarCollapsed ? "Expand menu" : "Compress menu"}>{sidebarCollapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}</button></div></aside>}

      {isChatWorkspace && <aside className="fixed inset-y-14 bottom-0 left-0 z-30 w-[224px] border-r border-border bg-background/95 sm:w-[260px] lg:w-[292px]"><div className="flex h-full flex-col"><div className="flex items-center justify-between border-b border-border px-4 py-3"><div><p className="text-sm font-bold tracking-tight text-foreground">Chats</p><p className="mt-0.5 text-[11px] text-muted-foreground">Your conversation history</p></div><button onClick={() => setLocation("/app/chats")} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent" aria-label="Open chats"><MessageSquareText className="size-4" /></button></div><div className="px-3 pt-3"><button onClick={handleNewChat} disabled={createChat.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60"><Plus className="size-3.5" />{createChat.isPending ? "Creating…" : "New chat"}</button></div><div className="px-3 pt-2"><button onClick={() => setLocation("/app/chats")} className="flex w-full items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground hover:border-ring/40 hover:text-foreground"><Search className="size-3.5" />Search chats</button></div><div className="flex-1 overflow-y-auto px-2 py-3">{recentChats.length > 0 ? <div className="space-y-1">{recentChats.map(chat => <button key={chat.id} onClick={() => setLocation(`/app?chatId=${chat.id}`)} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${location.includes(`chatId=${chat.id}`) ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><MessageSquareText className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{chat.title}</span><span className="block text-[11px] text-muted-foreground">Workspace conversation</span></span></button>)}</div> : <p className="px-3 py-2 text-xs text-muted-foreground">No conversations yet.</p>}</div></div></aside>}

      <main className={`min-h-0 min-w-0 flex-1 ${isChatWorkspace ? "overflow-hidden pl-[224px] sm:pl-[260px] lg:pl-[292px]" : sidebarCollapsed ? "overflow-y-auto overscroll-contain pb-6 pl-[68px] lg:pb-8" : "overflow-y-auto overscroll-contain pb-6 pl-[176px] sm:pl-[204px] lg:pb-8 lg:pl-[228px]"}`}>{children}</main>

    </div>
  );
}
