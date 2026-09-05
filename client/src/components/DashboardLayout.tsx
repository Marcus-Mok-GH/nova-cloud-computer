import React, { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Folder, HardDrive, LogOut, MessageSquareText, Moon, MoreHorizontal, Plus, Rocket, Search, Settings2, Sparkles, Sun } from "lucide-react";
import NovaMark from "./NovaMark";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const nav = [
  { icon: HardDrive, label: "Home", path: "/app" },
  { icon: Folder, label: "Files", path: "/app/files" },
  { icon: MessageSquareText, label: "Chats", path: "/app/chats" },
  { icon: Sparkles, label: "Models", path: "/app/models" },
  { icon: Rocket, label: "Deployments", path: "/app/deployments" },
  { icon: Settings2, label: "Settings", path: "/app/settings" },
];
const moreTab = { icon: MoreHorizontal, label: "More…", path: "/app/more" };
const ITEM_WIDTH = 96;
const ITEM_GAP = 4;
const SIDE_PADDING = 16;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const [visibleNavCount, setVisibleNavCount] = useState(nav.length);
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const recentChats = (computer.data?.chats ?? []).slice(0, 12);
  const isChatWorkspace = location.startsWith("/app/chats") || location.startsWith("/app?chatId=");
  const createChat = trpc.chats.create.useMutation({ onSuccess: async () => { await utils.workspace.computer.invalidate(); } });

  useEffect(() => {
    const updateNavCapacity = () => {
      const width = window.innerWidth;
      const available = Math.max(0, width - SIDE_PADDING * 2);
      const capacity = Math.floor((available + ITEM_GAP) / (ITEM_WIDTH + ITEM_GAP));
      setVisibleNavCount(Math.max(1, Math.min(nav.length, capacity)));
    };
    updateNavCapacity();
    window.addEventListener("resize", updateNavCapacity);
    return () => window.removeEventListener("resize", updateNavCapacity);
  }, []);

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <div className="flex min-h-dvh items-center justify-center bg-[#0a0a0a] px-4 py-6 dark:bg-[#0a0a0a]"><div className="w-full max-w-sm rounded-3xl border border-white/8 bg-[#141414] p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.4)] sm:p-8"><NovaMark size={34} className="mx-auto" /><h1 className="mt-5 text-2xl font-extrabold tracking-tight text-white">Sign in to continue</h1><p className="mt-2 text-sm leading-6 text-neutral-400">Your private computer and its agent are available after passwordless sign-in.</p><button onClick={() => window.location.assign("/sign-in")} className="pill-btn pill-btn-primary mt-6 w-full">Sign in</button></div></div>;

  const isActive = (path: string) => path === "/app" ? location === "/app" || location.startsWith("/app?") : location === path || location.startsWith(`${path}?`);
  const showMore = visibleNavCount < nav.length;
  const visibleNav = showMore ? nav.slice(0, Math.max(0, visibleNavCount - 1)) : nav;
  const handleNewChat = async () => { try { const chat = await createChat.mutateAsync({ title: "New workspace conversation" }); setLocation(`/app?chatId=${chat.id}`); } catch {} };

  return (
    <div className="dashboard-shell flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-[#0a0a0a] text-neutral-50">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-white/8 bg-[#0a0a0a]/88 px-3 backdrop-blur-xl sm:px-5 lg:px-7">
        <button onClick={() => setLocation("/app")} className="flex min-w-0 items-center gap-2 rounded-xl px-1.5 py-1 outline-none transition hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[oklch(0.60_0.02_250)]/60"><NovaMark size={22} /><span className="truncate text-[15px] font-extrabold tracking-tight text-white">Nova</span></button>
        <div className="ml-2 flex shrink-0 items-center gap-2">{isChatWorkspace && <span className="hidden items-center gap-2 rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-xs font-medium text-neutral-400 sm:flex"><span className="size-1.5 rounded-full bg-emerald-500" />Chat workspace</span>}<DropdownMenu><DropdownMenuTrigger asChild><button className="rounded-full outline-none transition hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-[oklch(0.60_0.02_250)]" aria-label="Account menu"><Avatar className="size-8 border border-white/10"><AvatarFallback className="bg-[oklch(0.60_0.02_250)] text-xs font-bold text-white">{user.name?.charAt(0).toUpperCase() || "N"}</AvatarFallback></Avatar></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-[min(15rem,calc(100vw-1rem))] rounded-xl"><div className="border-b border-white/5 px-3 py-3 text-xs text-neutral-400">{user.email}</div><DropdownMenuItem onClick={toggleTheme} className="cursor-pointer rounded-lg py-2.5">{theme === "light" ? <Moon className="mr-2 size-4" /> : <Sun className="mr-2 size-4" />}Switch to {theme === "light" ? "dark" : "light"} theme</DropdownMenuItem><DropdownMenuItem onClick={logout} className="cursor-pointer rounded-lg py-2.5 text-red-400 focus:text-red-400"><LogOut className="mr-2 size-4" />Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      </header>

      {isChatWorkspace && <aside className="fixed inset-y-14 bottom-16 left-0 z-30 hidden w-[292px] border-r border-white/8 bg-white/[0.02] lg:block dark:bg-[#0a0a0a]/95"><div className="flex h-full flex-col"><div className="flex items-center justify-between border-b border-white/5 px-4 py-3"><div><p className="text-sm font-bold tracking-tight text-white">Chats</p><p className="mt-0.5 text-[11px] text-neutral-400">Your conversation history</p></div><button onClick={() => setLocation("/app/chats")} className="grid size-8 place-items-center rounded-lg text-neutral-400 hover:bg-white/5" aria-label="Open chats"><MessageSquareText className="size-4" /></button></div><div className="px-3 pt-3"><button onClick={handleNewChat} disabled={createChat.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[oklch(0.60_0.02_250)] px-3 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[oklch(0.54_0.025_250)] disabled:opacity-60"><Plus className="size-3.5" />{createChat.isPending ? "Creating…" : "New chat"}</button></div><div className="px-3 pt-2"><button onClick={() => setLocation("/app/chats")} className="flex w-full items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-left text-xs font-semibold text-neutral-400 hover:border-white/15"><Search className="size-3.5 text-neutral-500" />Search chats</button></div><div className="flex-1 overflow-y-auto px-2 py-3">{recentChats.length > 0 ? <div className="space-y-1">{recentChats.map(chat => <button key={chat.id} onClick={() => setLocation(`/app?chatId=${chat.id}`)} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${location.includes(`chatId=${chat.id}`) ? "bg-white text-neutral-950" : "text-neutral-400 hover:bg-white/5 hover:text-white"}`}><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[oklch(0.60_0.02_250/0.10)] text-[oklch(0.60_0.02_250)]"><MessageSquareText className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{chat.title}</span><span className="block text-[11px] text-neutral-500">Workspace conversation</span></span></button>)}</div> : <p className="px-3 py-2 text-xs text-neutral-500">No conversations yet.</p>}</div></div></aside>}

      <main className={`min-h-0 min-w-0 flex-1 ${isChatWorkspace ? "overflow-hidden pb-16 lg:pb-0 lg:pl-[292px]" : "overflow-y-auto overscroll-contain pb-24 sm:pb-28"}`}>{children}</main>

      <nav aria-label="Workspace navigation" className="fixed inset-x-0 bottom-0 z-50 border-t border-white/8 bg-[#0a0a0a]/95 px-1.5 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl sm:px-2 sm:pt-2">
        <div className="mx-auto flex w-full max-w-[1400px] items-stretch justify-center"><div className="flex w-full min-w-0 justify-center gap-1">
          {visibleNav.map(tab => <button key={tab.label} onClick={() => setLocation(tab.path)} className={`flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-[10px] font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.60_0.02_250)]/60 sm:max-w-24 sm:px-3 ${isActive(tab.path) ? "bg-[oklch(0.60_0.02_250/0.12)] text-[oklch(0.72_0.015_250)]" : "text-neutral-500 hover:bg-white/5 hover:text-white"}`}><tab.icon className="size-[18px] shrink-0" /><span className="max-w-full truncate">{tab.label}</span></button>)}
          {showMore && <button onClick={() => setLocation(moreTab.path)} className={`flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-[10px] font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.60_0.02_250)]/60 sm:max-w-24 sm:px-3 ${isActive(moreTab.path) || nav.slice(visibleNav.length).some(item => isActive(item.path)) ? "bg-[oklch(0.60_0.02_250/0.12)] text-[oklch(0.72_0.015_250)]" : "text-neutral-500 hover:bg-white/5 hover:text-white"}`}><MoreHorizontal className="size-[18px] shrink-0" /><span className="max-w-full truncate">More…</span></button>}
        </div></div>
      </nav>
    </div>
  );
}
