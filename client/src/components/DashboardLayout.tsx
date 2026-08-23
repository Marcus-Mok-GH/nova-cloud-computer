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
import { Folder, HardDrive, LogOut, MessageSquareText, Moon, Rocket, Search, Settings2, Sparkles, Sun } from "lucide-react";
import NovaMark from "./NovaMark";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const nav = [
  { icon: HardDrive, label: "Home", path: "/app" },
  { icon: Folder, label: "Files", path: "/app/files" },
  { icon: MessageSquareText, label: "Chats", path: "/app/chats" },
  { icon: Rocket, label: "Deployments", path: "/app/deployments" },
  { icon: Settings2, label: "Settings", path: "/app/settings" },
];

const mobileTabs = [
  { icon: Sparkles, label: "Home", path: "/app" },
  { icon: Folder, label: "Files", path: "/app/files" },
  { icon: MessageSquareText, label: "Chats", path: "/app/chats" },
  { icon: Rocket, label: "Deploys", path: "/app/deployments" },
  { icon: Settings2, label: "Settings", path: "/app/settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const computer = trpc.workspace.computer.useQuery(undefined, { retry: false });
  const recentChats = (computer.data?.chats ?? []).slice(0, 4);

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

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-neutral-200 bg-white/90 px-4 backdrop-blur-md lg:hidden dark:border-white/10 dark:bg-neutral-950/90">
        <button onClick={() => setLocation("/app")} className="flex items-center gap-2">
          <NovaMark size={20} />
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

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-neutral-200 bg-white lg:flex dark:border-white/10 dark:bg-neutral-900">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <button onClick={() => setLocation("/app")} className="flex items-center gap-2.5">
            <NovaMark size={24} />
            <span className="text-[16px] font-extrabold tracking-tight">Nova Space</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3">
          <nav className="space-y-0.5 pt-2" aria-label="Workspace navigation">
            {nav.map(item => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.label}
                  onClick={() => setLocation(item.path)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${active ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"}`}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-4 flex items-center gap-2.5 rounded-full border border-neutral-200 bg-[#fafafa] px-3.5 py-2 dark:border-white/10 dark:bg-neutral-950">
            <Search className="size-3.5 shrink-0 text-neutral-400" />
            <span className="text-[13px] text-neutral-400">Search chats</span>
          </div>

          {recentChats.length > 0 && (
            <>
              <div className="flex items-center justify-between px-2 pb-1 pt-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Recent</p>
                <button onClick={() => setLocation("/app/chats")} className="text-[11px] font-semibold text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">View all</button>
              </div>
              <div className="space-y-0.5">
                {recentChats.map(chat => (
                  <button
                    key={chat.id}
                    onClick={() => setLocation(`/app?chatId=${chat.id}`)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-[#f97316]/10 text-[#f97316]"><MessageSquareText className="size-3" /></span>
                    <span className="truncate">{chat.title}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-neutral-200 p-3 dark:border-white/10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Account menu">
                <Avatar className="size-8 border border-neutral-200 dark:border-white/15">
                  <AvatarFallback className="bg-neutral-950 text-xs font-bold text-white dark:bg-white dark:text-neutral-950">{user.name?.charAt(0).toUpperCase() || "N"}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{user.name || "Nova user"}</span>
                  <span className="block truncate text-[11px] text-neutral-400">Personal space</span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <div className="px-2 py-2 text-xs text-muted-foreground">{user.email}</div>
              <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer">{theme === "light" ? <Moon className="mr-2 size-4" /> : <Sun className="mr-2 size-4" />}Switch to {theme === "light" ? "dark" : "light"} theme</DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="cursor-pointer text-red-600 focus:text-red-600"><LogOut className="mr-2 size-4" />Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Content */}
      <main className="min-h-screen pb-24 lg:pb-10 lg:pl-[264px]">{children}</main>

      {/* Mobile bottom tabs */}
      <nav aria-label="Workspace navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 px-3 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden dark:border-white/10 dark:bg-neutral-950/95">
        <div className="mx-auto grid max-w-xl grid-cols-5 gap-1">
          {mobileTabs.map(tab => {
            const active = isActive(tab.path);
            return (
              <button
                key={tab.label}
                onClick={() => setLocation(tab.path)}
                className={`flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-semibold transition-colors ${active ? "text-[#f97316]" : "text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"}`}
              >
                <tab.icon className="size-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
