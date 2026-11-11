import React, { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/ThemeContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { useLocation, useSearch } from "wouter";
import { ChevronsLeft, ChevronsRight, Check, ChevronDown, Coins, Lock, LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { adminNavItem, navItems as nav, notificationsNavItem, NavItem } from "@/lib/nav";
import NovaLogo from "./NovaLogo";
import { UsernamePrompt } from "./UsernamePrompt";
import { OnboardingModal } from "./OnboardingModal";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { trpc } from "@/lib/trpc";
import type { TranslationKey } from "@/i18n";

/**
 * The plans an account can be on, lowest first. The header trigger shows the
 * highest one the account holds; the menu lists them all so the next tier up is
 * visible (locked) to an account that does not have it yet. Extend this (and
 * the i18n keys) when a plan ships.
 */
const ACCOUNT_PLANS: ReadonlyArray<{ id: "free" | "pro" | "admin"; labelKey: TranslationKey }> = [
  { id: "free", labelKey: "layout.plan.free" },
  { id: "pro", labelKey: "layout.plan.pro" },
  { id: "admin", labelKey: "layout.plan.admin" },
];

export type PlanRow = { id: "free" | "pro" | "admin"; labelKey: TranslationKey; current: boolean; locked: boolean };

/**
 * The rows the plan menu renders. Every account holds Free; Pro is locked to
 * an account without Pro access — selecting it offers the upgrade rather
 * than switching plan. The admin tier is held by the account's role, not its
 * subscription, so it only appears for console operators and is never locked.
 * Pulled out of the component because the menu bodies render in a portal,
 * which a static render cannot see.
 * `proAccess` is the server's effective Pro entitlement (a paid plan or a
 * console-operator role): it - not the raw plan - is what locks the Pro row,
 * so an operator on a free subscription reads Pro unlocked.
 */
export function planRows(proAccess: boolean, isAdmin: boolean): PlanRow[] {
  // The highest tier the account holds is its current one: the admin tier for
  // an operator, Pro for an account with Pro access, and every account is at
  // least Free.
  const currentId = isAdmin ? "admin" : proAccess ? "pro" : "free";
  return ACCOUNT_PLANS.map(plan => ({
    id: plan.id,
    labelKey: plan.labelKey,
    current: plan.id === currentId,
    locked: plan.id === "admin" ? false : !proAccess && plan.id !== "free",
  })).filter(row => row.id !== "admin" || isAdmin);
}


export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  // Refreshed on window focus and right after a run finalizes (see
  // useWorkspaceChat) instead of a background poll: an idle signed-in tab
  // should not keep waking the database every 30 seconds.
  const credits = trpc.credits.status.useQuery(undefined, { enabled: Boolean(user) });
  // Starter questions for brand-new accounts. Shown once until the user
  // completes (or skips) onboarding; a skip leaves it open to ask again later.
  const onboarding = trpc.auth.onboarding.useQuery(undefined, { enabled: Boolean(user), retry: false });
  // The account's plan, for the badge beside the wordmark. Same query the
  // billing page reads, so the two never disagree.
  const subscription = trpc.billing.subscription.useQuery(undefined, { enabled: Boolean(user), retry: false });
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
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
  // The plan menu rows, and the highest plan the account holds (the trigger's
  // label). `plan` is the server's own active-then-paid verdict, so a lapsed
  // subscription reads Free without any client-side date maths. Both stay
  // undefined until the query resolves, which keeps the badge empty on first
  // paint instead of flashing "Free" at a paying account.
  // Pro access is the server's effective entitlement (paid plan or
  // console-operator role), reported beside the raw plan.
  const proAccess = subscription.data?.proAccess ?? false;
  // The admin tier is role-based, not subscription-based: console operators
  // (the same gate that owns the Admin and Notifications entries) hold it.
  const rows = subscription.data ? planRows(proAccess, isConsoleOperator) : undefined;
  const topPlan = rows?.find(row => row.current);

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
          <span aria-hidden="true" className={`${opts?.collapsed ? "" : "ms-auto "}inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white`}>
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
          {/* The account's plan, beside the wordmark: only the highest plan
              the account holds, in the display serif. Selecting it opens
              billing. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t("layout.plan.aria")}
                className="nova-display flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[15px] text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {topPlan ? t(topPlan.labelKey) : null}
                {topPlan && <ChevronDown className="size-3.5 font-sans" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 rounded-xl">
              <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {t("layout.plan.menuLabel")}
              </DropdownMenuLabel>
              {(rows ?? []).map(plan => {
                const { current, locked } = plan;
                return (
                  <DropdownMenuItem
                    key={plan.id}
                    onSelect={event => {
                      event.preventDefault();
                      // A locked tier is not selectable — tapping it offers the
                      // upgrade instead, which is where the decision belongs.
                      if (locked) go("/app/billing");
                    }}
                    className={`flex items-center gap-2.5 rounded-lg py-2.5 ${
                      locked ? "cursor-pointer opacity-70" : ""
                    }`}
                  >
                    <span className="grid size-4 shrink-0 place-items-center">
                      {locked ? (
                        <Lock className="size-3.5 text-muted-foreground" />
                      ) : current ? (
                        <Check className="size-4 text-primary" />
                      ) : null}
                    </span>
                    <span className="nova-display flex-1 text-base">
                      {t(plan.labelKey)}
                    </span>
                    {current && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-sans font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                        {t("layout.plan.current")}
                      </span>
                    )}
                    {locked && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-sans font-bold uppercase tracking-wide text-muted-foreground">
                        {t("layout.plan.locked")}
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={event => {
                  event.preventDefault();
                  go("/app/billing");
                }}
                className="cursor-pointer rounded-lg py-2.5 text-xs font-semibold text-muted-foreground"
              >
                {t("layout.plan.manage")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="ms-2 flex shrink-0 items-center gap-2">{isChatWorkspace && <span className="hidden items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-emerald-500" />{t("layout.chatWorkspace")}</span>}{credits.data && <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1.5 text-xs font-semibold text-muted-foreground" title={credits.data.unlimited ? t("layout.creditsTitle.unlimited", { cents: credits.data.creditValueCents }) : t("layout.creditsTitle.remaining", { remaining: credits.data.remainingCredits, daily: credits.data.dailyCredits, cents: credits.data.creditValueCents })}><Coins className="size-3.5 text-primary" /><span>{credits.data.unlimited ? t("layout.credits.unlimited") : credits.data.remainingCredits}</span><span className="hidden sm:inline">{t("layout.credits")}</span></span>}<DropdownMenu><DropdownMenuTrigger asChild><button className="rounded-full outline-none transition hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("layout.accountMenu")}><Avatar className="size-8 border border-border"><AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">{user.name?.charAt(0).toUpperCase() || "N"}</AvatarFallback></Avatar></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-[min(15rem,calc(100vw-1rem))] rounded-xl"><div className="border-b border-border px-3 py-3 text-xs text-muted-foreground">{user.email}</div><DropdownMenuItem onClick={toggleTheme} className="cursor-pointer rounded-lg py-2.5">{theme === "light" ? <Moon className="me-2 size-4" /> : <Sun className="me-2 size-4" />}{theme === "light" ? t("layout.theme.toDark") : t("layout.theme.toLight")}</DropdownMenuItem><DropdownMenuItem onClick={logout} className="cursor-pointer rounded-lg py-2.5 text-red-500 focus:text-red-500"><LogOut className="me-2 size-4" />{t("layout.signOut")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      </header>

      {/* Mobile drawer */}
      <div className={`fixed inset-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-40 bg-black/35 md:hidden ${mobileNavOpen ? "" : "pointer-events-none opacity-0"} transition-opacity duration-200`} onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      <aside aria-label={t("layout.workspaceNav")} aria-hidden={!mobileNavOpen} className={`fixed bottom-0 start-0 z-50 flex w-[248px] flex-col border-e border-border bg-muted p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-200 ease-out md:hidden top-[calc(3.5rem+env(safe-area-inset-top))] dark:border-white/5 dark:bg-card ${mobileNavOpen ? "translate-x-0 shadow-2xl" : "ltr:-translate-x-full rtl:translate-x-full"}`}>
        <div className="flex h-9 items-center justify-between">
          <p className="px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("layout.yourSpace")}</p>
          <button onClick={() => setMobileNavOpen(false)} aria-label={t("layout.closeMenu")} className="grid size-9 place-items-center rounded-xl text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" /></button>
        </div>
        <div className="mt-2 space-y-1 overflow-y-auto">{navButtons(() => setMobileNavOpen(false))}</div>
      </aside>

      {/* Desktop rail */}
      <aside aria-label={t("layout.workspaceNav")} className={`fixed bottom-0 start-0 z-30 hidden border-e border-border bg-muted dark:border-white/5 dark:bg-card md:flex top-[calc(3.5rem+env(safe-area-inset-top))] ${sidebarCollapsed ? "w-[68px]" : "w-[204px] lg:w-[228px]"}`}><div className="flex h-full flex-col p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{!sidebarCollapsed && <p className="px-2 pb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("layout.yourSpace")}</p>}<div className="space-y-1">{navButtons(() => {}, { collapsed: sidebarCollapsed })}</div><button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="mt-auto grid size-9 shrink-0 place-items-center self-center rounded-xl text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={sidebarCollapsed ? t("layout.expandMenu") : t("layout.compressMenu")}>{sidebarCollapsed ? <ChevronsRight className="size-4 rtl:-scale-x-100" /> : <ChevronsLeft className="size-4 rtl:-scale-x-100" />}</button></div></aside>

      <main className={`min-h-0 min-w-0 flex-1 ${hasChatId ? `overflow-hidden ${sidebarCollapsed ? "md:ps-[68px]" : "md:ps-[204px] lg:ps-[228px]"}` : `overflow-visible overscroll-contain md:overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1.5rem)] md:pb-[calc(env(safe-area-inset-bottom)+2rem)] ${sidebarCollapsed ? "md:ps-[68px]" : "md:ps-[204px] lg:ps-[228px]"}`}`}>{children}</main>

      {showUsernamePrompt && <UsernamePrompt user={user} onClose={dismissUsernamePrompt} />}
      {user && onboarding.data && !onboarding.data.completed && !onboardingDismissed && (
        <OnboardingModal onClose={() => setOnboardingDismissed(true)} />
      )}
    </div>
  );
}
