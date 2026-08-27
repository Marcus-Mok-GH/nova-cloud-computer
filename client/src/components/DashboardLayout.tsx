import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Folder, HardDrive, LogOut, MessageSquareText, Moon, MoreHorizontal, Rocket, Search, Settings2, Sun } from "lucide-react";
import NovaMark from "./NovaMark";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const nav = [
  { icon: HardDrive, label: "Home", path: "/app" },
  { icon: Folder, label: "Files", path: "/app/files" },
  { icon: MessageSquareText, label: "Chats", path: "/app/chats" },
  { icon: Rocket, label: "Deployments", path: "/app/deployments" },
  { icon: Settings2, label: "Settings", path: "/app/settings" },
];

const moreTab = { icon: MoreHorizontal, label: "More…", path: "/app/more" };
const mobilePrimaryCount = 4;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const recentChats = (computer.data?.chats ?? []).slice(0, 12);

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6 dark:bg-neutral-950">
        <div className="w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-[0_24px_80px_rgba(10,10,10,0.08)] dark:border-white/10 dark:bg-neutral-900">
          <NovaMark size={34} className="mx-auto" />
          <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-neutral-950 dark:text-white">Sign in to continue</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Your private computer and its agent are available after passwordless sign-in.</p>
          <button onClick={() => window.location.assign("/sign-in")} className="pill-btn pill-btn-primary mt-7 w-full">Sign in</button>
        </div>
      </div>
    );
  }

  const isActive = (path: string) => {
    if (path === "/app") return location === "/app" || location.startsWith("/app?");
    return location === path || location.startsWith(`${path}?`);
  };

  const mobileTabs = nav.length > mobilePrimaryCount
    ? [...nav.slice(0, mobilePrimaryCount), moreTab]
    : nav;

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-neutral-200 bg-white/90 px-4 backdrop-blur-md dark:border-white/10 dark:bg-neutral-950/90 lg:px-6">
        <button onClick={() => setLocation("/app")} className="flex items-center gap-2">
          <NovaMark size={22} />
          <span className="text-[15px] font-extrabold tracking-tight">Nova Space</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]" aria-label="Account menu">
              <Avatar className="size-8 border border-neutral-200 dark:border-white/15">
                <AvatarFallback className="bg-[#f97316] text-xs font-bold text-white">{user.name?.charAt(0).toUpperCase() || "N"}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-2 text-xs text-muted-foreground">{user.email}</div>
            <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer">{theme === "light" ? <Moon className="mr-2 size-4" /> : <Sun className="mr-2 size-4" />}Switch to {theme === "light" ? "dark" : "light"} theme</DropdownMenuItem>
            <DropdownMenuItem onClick={logout} className="cursor-pointer text-red-600 focus:text-red-600"><LogOut className="mr-2 size-4" />Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex min-h-[calc(100vh-3.5rem)]">
        {/* Desktop chat sidebar, matching conventional chat applications. */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem-5rem)] w-[280px] shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-white/10 dark:bg-neutral-900 lg:flex">
          <div className="border-b border-neutral-200 p-3 dark:border-white/10">
            <button onClick={() => setLocation("/app")} className="flex w-full items-center gap-2 rounded-xl border border-neutral-200 bg-[#fafafa] px-3 py-2 text-left text-[13px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800">
              <Search className="size-4 shrink-0" />
              <span className="flex-1">Search chats</span>
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            <div className="flex items-center justify-between px-2 pb-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Chats</p>
              <button onClick={() => setLocation("/app/chats")} className="text-[11px] font-semibold text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">View all</button>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {recentChats.length > 0 ? recentChats.map(chat => {
                const active = location.includes(`chatId=${chat.id}`);
                return (
                  <button
                    key={chat.id}
                    onClick={() => setLocation(`/app?chatId=${chat.id}`)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${active ? "bg-neutral-100 text-neutral-950 dark:bg-neutral-800 dark:text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"}`}
                  >
                    <MessageSquareText className="size-3.5 shrink-0 text-[#f97316]" />
                    <span className="truncate">{chat.title}</span>
                  </button>
                );
              }) : (
                <p className="px-3 py-6 text-center text-xs text-neutral-400">No recent chats yet.</p>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-24 sm:pb-28">{children}</main>
      </div>

      <nav aria-label="Workspace navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md dark:border-white/10 dark:bg-neutral-950/95">
        <div className="mx-auto flex w-full max-w-5xl items-stretch justify-center gap-1 overflow-x-auto">
          <div className="flex w-full min-w-max justify-around sm:w-auto sm:min-w-0 sm:gap-1">
            {mobileTabs.map(tab => {
              const active = tab.path === moreTab.path
                ? isActive(moreTab.path) || nav.slice(mobilePrimaryCount).some(item => isActive(item.path))
                : isActive(tab.path);
              return (
                <button
                  key={tab.label}
                  onClick={() => setLocation(tab.path)}
                  className={`flex min-w-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-semibold transition-colors sm:min-w-[72px] sm:flex-none sm:px-4 ${active ? "text-[#f97316]" : "text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"}`}
                >
                  <tab.icon className="size-4 sm:size-[18px]" />
                  <span className="max-w-[68px] truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
