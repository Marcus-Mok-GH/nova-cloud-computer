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
import {
  Folder,
  HardDrive,
  LogOut,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  Plus,
  Rocket,
  Search,
  Settings2,
  Sun,
} from "lucide-react";
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
  const utils = trpc.useUtils();
  const recentChats = (computer.data?.chats ?? []).slice(0, 12);
  const mobileTabs = nav.length > mobilePrimaryCount ? [...nav.slice(0, mobilePrimaryCount), moreTab] : nav;
  const isChatWorkspace = location.startsWith("/app/chats") || location.startsWith("/app?chatId=");
  const createChat = trpc.chats.create.useMutation({
    onSuccess: async () => {
      await utils.workspace.computer.invalidate();
    },
  });

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

  const handleNewChat = async () => {
    try {
      const chat = await createChat.mutateAsync({ title: "New workspace conversation" });
      setLocation(`/app?chatId=${chat.id}`);
    } catch {
      // The chats page owns the detailed error toast; keep the shell quiet on failure.
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-neutral-200/90 bg-white/90 px-4 shadow-[0_1px_12px_rgba(10,10,10,0.03)] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/90 dark:shadow-none sm:px-5 lg:px-7">
        <button onClick={() => setLocation("/app")} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 outline-none transition hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-[#f97316]/60 dark:hover:bg-white/5">
          <NovaMark size={22} />
          <span className="text-[15px] font-extrabold tracking-tight">Nova Space</span>
        </button>

        <div className="flex items-center gap-2">
          {isChatWorkspace && (
            <span className="hidden items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-500 sm:flex dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-400">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Chat workspace
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full outline-none ring-offset-2 transition hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-[#f97316]" aria-label="Account menu">
                <Avatar className="size-8 border border-neutral-200 shadow-sm dark:border-white/15">
                  <AvatarFallback className="bg-[#f97316] text-xs font-bold text-white">{user.name?.charAt(0).toUpperCase() || "N"}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-xl">
              <div className="border-b border-neutral-100 px-3 py-3 text-xs text-muted-foreground dark:border-white/10">{user.email}</div>
              <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer rounded-lg py-2.5">{theme === "light" ? <Moon className="mr-2 size-4" /> : <Sun className="mr-2 size-4" />}Switch to {theme === "light" ? "dark" : "light"} theme</DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="cursor-pointer rounded-lg py-2.5 text-red-600 focus:text-red-600"><LogOut className="mr-2 size-4" />Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {isChatWorkspace && (
        <aside className="fixed inset-y-14 left-0 bottom-16 z-30 hidden w-[292px] border-r border-neutral-200 bg-white/95 lg:block dark:border-white/10 dark:bg-neutral-900/95">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-white/5">
              <div>
                <p className="text-sm font-bold tracking-tight">Chats</p>
                <p className="mt-0.5 text-[11px] text-neutral-400">Your conversation history</p>
              </div>
              <button onClick={() => setLocation("/app/chats")} className="grid size-8 place-items-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]/60 dark:hover:bg-white/5 dark:hover:text-white" aria-label="Open chats"><MessageSquareText className="size-4" /></button>
            </div>

            <div className="px-3 pt-3">
              <button onClick={handleNewChat} disabled={createChat.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#f97316] px-3 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#ea580c] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]/50">
                <Plus className="size-3.5" />
                {createChat.isPending ? "Creating…" : "New chat"}
              </button>
            </div>

            <div className="px-3 pt-2">
              <button onClick={() => setLocation("/app/chats")} className="flex w-full items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-left text-xs font-semibold text-neutral-600 transition hover:border-neutral-300 hover:bg-white hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]/50 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white">
                <Search className="size-3.5 text-neutral-400" />
                Search chats
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-3">
              {recentChats.length > 0 ? (
                <div className="space-y-1">
                  {recentChats.map(chat => {
                    const active = location.includes(`chatId=${chat.id}`);
                    return (
                      <button
                        key={chat.id}
                        onClick={() => setLocation(`/app?chatId=${chat.id}`)}
                        className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? "bg-neutral-950 text-white shadow-sm dark:bg-white dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-white"}`}
                      >
                        <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${active ? "bg-white/15 dark:bg-black/10" : "bg-[#f97316]/10 text-[#f97316]"}`}><MessageSquareText className="size-3.5" /></span>
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{chat.title}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="px-3 py-8 text-center">
                  <MessageSquareText className="mx-auto size-5 text-neutral-300 dark:text-neutral-600" />
                  <p className="mt-3 text-xs leading-5 text-neutral-400">No conversations yet.</p>
                  <button onClick={handleNewChat} className="mt-3 text-xs font-semibold text-[#f97316] hover:underline">Create your first chat</button>
                </div>
              )}
            </div>

            <div className="border-t border-neutral-100 p-3 dark:border-white/5">
              <button onClick={() => setLocation("/app/chats")} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-white">
                <span>View all chats</span>
                <span>→</span>
              </button>
            </div>
          </div>
        </aside>
      )}

      <main className={`min-h-[calc(100vh-3.5rem)] pb-24 sm:pb-28 ${isChatWorkspace ? "lg:pl-[292px]" : ""}`}>
        {children}
      </main>

      <nav aria-label="Workspace navigation" className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200/90 bg-white/95 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(10,10,10,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/95 dark:shadow-none">
        <div className="mx-auto flex w-full max-w-5xl items-stretch justify-center">
          <div className="flex w-full min-w-0 justify-around gap-1 sm:w-auto sm:gap-1">
            {mobileTabs.map(tab => {
              const active = tab.path === moreTab.path
                ? isActive(moreTab.path) || nav.slice(mobilePrimaryCount).some(item => isActive(item.path))
                : isActive(tab.path);
              return (
                <button
                  key={tab.label}
                  onClick={() => setLocation(tab.path)}
                  className={`flex min-w-[58px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[10px] font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]/60 sm:min-w-[78px] sm:flex-none sm:px-4 ${active ? "bg-[#f97316]/10 text-[#c2410c] dark:bg-[#f97316]/12 dark:text-[#fb923c]" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-white"}`}
                >
                  <tab.icon className="size-4 sm:size-[18px]" />
                  <span className="max-w-[72px] truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
