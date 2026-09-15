import React, { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";
import { ChevronsLeft, ChevronsRight, LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { navItems as nav, NavItem } from "@/lib/nav";
import NovaMark from "./NovaMark";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";


export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const recentFiles = (computer.data?.files ?? []).slice(0, 6);
  const hasChatId = new URLSearchParams(search).has("chatId");
  const isChatWorkspace = location.startsWith("/app/chats") || hasChatId;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = window.localStorage.getItem("nova.sidebar.collapsed");
    if (stored === "1") return true;
    if (stored === "0") return false;
    return window.innerWidth < 1024;
  });
  useEffect(() => { window.localStorage.setItem("nova.sidebar.collapsed", sidebarCollapsed ? "1" : "0"); }, [sidebarCollapsed]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { setMobileNavOpen(false); }, [location]);

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-6"><div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.12)] sm:p-8"><NovaMark size={34} className="mx-auto" /><h1 className="mt-5 text-2xl font-extrabold tracking-tight text-foreground">Sign in to continue</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Your private computer and its agent are available after passwordless sign-in.</p><button onClick={() => window.location.assign("/sign-in")} className="pill-btn pill-btn-primary mt-6 w-full">Sign in</button></div></div>;

  const isActive = (path: string) => path === "/app" ? location === "/app" || location.startsWith("/app?") : location === path || location.startsWith(`${path}?`);
  const go = (path: string) => { setMobileNavOpen(false); setLocation(path); };

  const navButtons = (onNavigate: () => void, opts?: { collapsed?: boolean }) =>
    nav.map((tab: NavItem) => (
      <button key={tab.label} onClick={() => { onNavigate(); go(tab.path); }} title={tab.label} aria-label={tab.label} aria-current={isActive(tab.path) ? "page" : undefined}
        className={`flex w-full items-center rounded-xl text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60 ${opts?.collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2.5"} ${isActive(tab.path) ? "bg-card text-foreground shadow-sm dark:bg-card dark:text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
        <tab.icon className="size-4 shrink-0" />{!opts?.collapsed && tab.label}
      </button>
    ));

  const recentBlock = (onNavigate: () => void) => (
    <div className="mt-8 border-t border-border pt-3 dark:border-white/5">
      <p className="px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Recent</p>
      <div className="mt-2 space-y-0.5">
        {recentFiles.length
          ? recentFiles.map(file => <button key={file.id} onClick={() => { onNavigate(); go("/app/files"); }} className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground">{file.name}</button>)
          : <p className="px-2 py-1.5 text-xs text-muted-foreground">No files yet.</p>}
      </div>
    </div>
  );

  return (
    <div className="dashboard-shell flex h-svh min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/88 px-3 backdrop-blur-xl sm:px-5 lg:px-7">
        <div className="flex min-w-0 items-center gap-1">
          <button onClick={() => setMobileNavOpen(true)} aria-label="Open workspace menu" className="grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 md:hidden"><Menu className="size-4.5" /></button>
          <button onClick={() => go("/app")} className="flex min-w-0 items-center gap-2 rounded-xl px-1.5 py-1 outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"><NovaMark size={22} /><span className="truncate text-[15px] font-extrabold tracking-tight text-foreground">Nova</span></button>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-2">{isChatWorkspace && <span className="hidden items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-emerald-500" />Chat workspace</span>}<DropdownMenu><DropdownMenuTrigger asChild><button className="rounded-full outline-none transition hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu"><Avatar className="size-8 border border-border"><AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">{user.name?.charAt(0).toUpperCase() || "N"}</AvatarFallback></Avatar></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-[min(15rem,calc(100vw-1rem))] rounded-xl"><div className="border-b border-border px-3 py-3 text-xs text-muted-foreground">{user.email}</div><DropdownMenuItem onClick={toggleTheme} className="cursor-pointer rounded-lg py-2.5">{theme === "light" ? <Moon className="mr-2 size-4" /> : <Sun className="mr-2 size-4" />}Switch to {theme === "light" ? "dark" : "light"} theme</DropdownMenuItem><DropdownMenuItem onClick={logout} className="cursor-pointer rounded-lg py-2.5 text-red-500 focus:text-red-500"><LogOut className="mr-2 size-4" />Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      </header>

      {/* Mobile drawer */}
      <div className={`fixed inset-0 top-14 z-40 bg-black/35 md:hidden ${mobileNavOpen ? "" : "pointer-events-none opacity-0"} transition-opacity duration-200`} onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      <aside aria-label="Workspace navigation" aria-hidden={!mobileNavOpen} className={`fixed inset-y-14 bottom-0 left-0 z-50 flex w-[248px] flex-col border-r border-border bg-muted p-3 transition-transform duration-200 ease-out md:hidden dark:border-white/5 dark:bg-card ${mobileNavOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}>
        <div className="flex h-9 items-center justify-between">
          <p className="px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Your space</p>
          <button onClick={() => setMobileNavOpen(false)} aria-label="Close menu" className="grid size-9 place-items-center rounded-xl text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" /></button>
        </div>
        <div className="mt-2 space-y-1 overflow-y-auto">{navButtons(() => setMobileNavOpen(false))}</div>
        {recentBlock(() => setMobileNavOpen(false))}
      </aside>

      {/* Desktop rail */}
      <aside aria-label="Workspace navigation" className={`fixed inset-y-14 bottom-0 left-0 z-30 hidden border-r border-border bg-muted dark:border-white/5 dark:bg-card md:flex ${sidebarCollapsed ? "w-[68px]" : "w-[204px] lg:w-[228px]"}`}><div className="flex h-full flex-col p-3">{!sidebarCollapsed && <p className="px-2 pb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Your space</p>}<div className="space-y-1">{navButtons(() => {}, { collapsed: sidebarCollapsed })}</div>{!sidebarCollapsed && recentBlock(() => {})}<button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="mt-auto grid size-9 shrink-0 place-items-center self-center rounded-xl text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={sidebarCollapsed ? "Expand menu" : "Compress menu"}>{sidebarCollapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}</button></div></aside>

      <main className={`min-h-0 min-w-0 flex-1 ${hasChatId ? `overflow-hidden ${sidebarCollapsed ? "md:pl-[68px]" : "md:pl-[204px] lg:pl-[228px]"}` : `overflow-y-auto overscroll-contain pb-6 md:pb-8 ${sidebarCollapsed ? "md:pl-[68px]" : "md:pl-[204px] lg:pl-[228px]"}`}`}>{children}</main>

    </div>
  );
}
