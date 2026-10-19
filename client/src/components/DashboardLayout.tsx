import React, { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/ThemeContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { useLocation, useSearch } from "wouter";
import { ChevronsLeft, ChevronsRight, Coins, LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { adminNavItem, navItems as nav, notificationsNavItem, NavItem } from "@/lib/nav";
import NovaLogo from "./NovaLogo";
import { UsernamePrompt } from "./UsernamePrompt";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { trpc } from "@/lib/trpc";


export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  // Refreshed on window focus and right after a run finalizes (see
  // useWorkspaceChat) instead of a background poll: an idle signed-in tab
  // should not keep waking the database every 30 seconds.
  const credits = trpc.credits.status.useQuery(undefined, { enabled: Boolean(user) });
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  const search = useSearch();
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
  const [usernamePromptSkipped, setUsernamePromptSkipped] = useState(() => {
    try { return window.sessionStorage.getItem("nova.username.prompt.skipped") === "1"; } catch { return false; }
  });
  const dismissUsernamePrompt = () => {
    setUsernamePromptSkipped(true);
    try { window.sessionStorage.setItem("nova.username.prompt.skipped", "1"); } catch {}
  };
  useEffect(() => { setMobileNavOpen(false); }, [location]);

  // All hooks must run before any early return (React error #310).
  const isConsoleOperator = user?.role === "admin" || user?.role === "developer";
  // Error count for the sidebar Notifications entry. The query is admin-gated
  // server-side, and only console operators ever see the entry.
  const notificationsQuery = trpc.admin.apiErrorLogs.useQuery({ limit: 100 }, { enabled: isConsoleOperator, retry: false, refetchInterval: 120_000 });

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-6"><div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.12)] sm:p-8"><NovaLogo size={34} className="mx-auto" /><h1 className="mt-5 text-2xl font-extrabold tracking-tight text-foreground">{t("layout.signInTitle")}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{t("layout.signInBody")}</p><button onClick={() => window.location.assign("/sign-in")} className="pill-btn pill-btn-primary mt-6 w-full">{t("layout.signIn")}</button></div></div>;

  const isActive = (path: string) => path === "/app" ? location === "/app" || location.startsWith("/app?") : location === path || location.startsWith(`${path}?`);
  const go = (path: string) => { setMobileNavOpen(false); setLocation(path); };

  const notificationCount = notificationsQuery.data?.length ?? 0;
  const visibleNav: NavItem[] = isConsoleOperator ? [...nav, adminNavItem, { ...notificationsNavItem, badge: notificationCount }] : nav;
  const navButtons = (onNavigate: () => void, opts?: { collapsed?: boolean }) =>
    visibleNav.map((tab: NavItem) => {
      const label = t(tab.labelKey);
      return (
      <button key={tab.path} onClick={() => { onNavigate(); go(tab.path); }} title={label} aria-label={typeof tab.badge === "number" && tab.badge > 0 ? t("layout.navUnread", { label, count: tab.badge }) : label} aria-current={isActive(tab.path) ? "page" : undefined}
        className={`flex w-full items-center rounded-xl text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60 ${opts?.collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2.5"} ${isActive(tab.path) ? "bg-card text-foreground shadow-sm dark:bg-card dark:text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
        <tab.icon className="size-4 shrink-0" />{!opts?.collapsed && label}
        {typeof tab.badge === "number" && tab.badge > 0 && (
          <span aria-hidden="true" className={`${opts?.collapsed ? "" : "ml-auto "}inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white`}>
            {tab.badge > 99 ? "99+" : tab.badge}
          </span>
        )}
      </button>
      );
    });

  const showUsernamePrompt = user && !user.username && !usernamePromptSkipped;

  return (
    <div className={`dashboard-shell flex min-w-0 flex-col bg-background text-foreground pt-[env(safe-area-inset-top)] ${hasChatId ? "h-svh min-h-0 overflow-hidden" : "min-h-svh overflow-visible md:h-svh md:min-h-0 md:overflow-hidden"}`}>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/88 px-3 backdrop-blur-xl sm:px-5 lg:px-7">
        <div className="flex min-w-0 items-center gap-1">
          <button onClick={() => setMobileNavOpen(true)} aria-label={t("layout.openMenu")} className="grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 md:hidden"><Menu className="size-4.5" /></button>
          <button onClick={() => go("/app")} className="flex min-w-0 items-center gap-2 rounded-xl px-1.5 py-1 outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"><NovaLogo size={30} /><span className="truncate text-[15px] font-extrabold tracking-tight text-foreground">Nova</span></button>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-2">{isChatWorkspace && <span className="hidden items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-emerald-500" />{t("layout.chatWorkspace")}</span>}{credits.data && <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1.5 text-xs font-semibold text-muted-foreground" title={credits.data.unlimited ? t("layout.creditsTitle.unlimited", { cents: credits.data.creditValueCents }) : t("layout.creditsTitle.remaining", { remaining: credits.data.remainingCredits, daily: credits.data.dailyCredits, cents: credits.data.creditValueCents })}><Coins className="size-3.5 text-primary" /><span>{credits.data.unlimited ? t("layout.credits.unlimited") : credits.data.remainingCredits}</span><span className="hidden sm:inline">{t("layout.credits")}</span></span>}<DropdownMenu><DropdownMenuTrigger asChild><button className="rounded-full outline-none transition hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("layout.accountMenu")}><Avatar className="size-8 border border-border"><AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">{user.name?.charAt(0).toUpperCase() || "N"}</AvatarFallback></Avatar></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-[min(15rem,calc(100vw-1rem))] rounded-xl"><div className="border-b border-border px-3 py-3 text-xs text-muted-foreground">{user.email}</div><DropdownMenuItem onClick={toggleTheme} className="cursor-pointer rounded-lg py-2.5">{theme === "light" ? <Moon className="mr-2 size-4" /> : <Sun className="mr-2 size-4" />}{theme === "light" ? t("layout.theme.toDark") : t("layout.theme.toLight")}</DropdownMenuItem><DropdownMenuItem onClick={logout} className="cursor-pointer rounded-lg py-2.5 text-red-500 focus:text-red-500"><LogOut className="mr-2 size-4" />{t("layout.signOut")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      </header>

      {/* Mobile drawer */}
      <div className={`fixed inset-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-40 bg-black/35 md:hidden ${mobileNavOpen ? "" : "pointer-events-none opacity-0"} transition-opacity duration-200`} onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      <aside aria-label={t("layout.workspaceNav")} aria-hidden={!mobileNavOpen} className={`fixed bottom-0 left-0 z-50 flex w-[248px] flex-col border-r border-border bg-muted p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-200 ease-out md:hidden top-[calc(3.5rem+env(safe-area-inset-top))] dark:border-white/5 dark:bg-card ${mobileNavOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}>
        <div className="flex h-9 items-center justify-between">
          <p className="px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("layout.yourSpace")}</p>
          <button onClick={() => setMobileNavOpen(false)} aria-label={t("layout.closeMenu")} className="grid size-9 place-items-center rounded-xl text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" /></button>
        </div>
        <div className="mt-2 space-y-1 overflow-y-auto">{navButtons(() => setMobileNavOpen(false))}</div>
      </aside>

      {/* Desktop rail */}
      <aside aria-label={t("layout.workspaceNav")} className={`fixed bottom-0 left-0 z-30 hidden border-r border-border bg-muted dark:border-white/5 dark:bg-card md:flex top-[calc(3.5rem+env(safe-area-inset-top))] ${sidebarCollapsed ? "w-[68px]" : "w-[204px] lg:w-[228px]"}`}><div className="flex h-full flex-col p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{!sidebarCollapsed && <p className="px-2 pb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("layout.yourSpace")}</p>}<div className="space-y-1">{navButtons(() => {}, { collapsed: sidebarCollapsed })}</div><button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="mt-auto grid size-9 shrink-0 place-items-center self-center rounded-xl text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={sidebarCollapsed ? t("layout.expandMenu") : t("layout.compressMenu")}>{sidebarCollapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}</button></div></aside>

      <main className={`min-h-0 min-w-0 flex-1 ${hasChatId ? `overflow-hidden ${sidebarCollapsed ? "md:pl-[68px]" : "md:pl-[204px] lg:pl-[228px]"}` : `overflow-visible overscroll-contain md:overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1.5rem)] md:pb-[calc(env(safe-area-inset-bottom)+2rem)] ${sidebarCollapsed ? "md:pl-[68px]" : "md:pl-[204px] lg:pl-[228px]"}`}`}>{children}</main>

      {showUsernamePrompt && <UsernamePrompt user={user} onClose={dismissUsernamePrompt} />}
    </div>
  );
}
