import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Cloud, MessageSquareText, Rocket, Settings2, Sparkles } from "lucide-react";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const tabs = [
  { icon: Sparkles, label: "Workspace", path: "/app" },
  { icon: Rocket, label: "Deployments", path: "/app/deployments" },
  { icon: MessageSquareText, label: "Chats", path: "/app/chats" },
  { icon: Settings2, label: "Settings", path: "/app/settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  const [location, setLocation] = useLocation();

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d12] px-6 text-white">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl bg-cyan-300 text-[#07212b]"><Cloud className="size-6" /></div>
          <h1 className="text-2xl font-semibold">Sign in to continue</h1>
          <p className="mt-2 text-sm leading-6 text-white/55">Your private computer and its agent are available after passwordless sign-in.</p>
          <Button onClick={() => window.location.assign("/sign-in")} className="mt-7 w-full bg-cyan-300 text-[#07212b] hover:bg-cyan-200">Sign in</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d12] text-[#eef5f3] selection:bg-cyan-300 selection:text-[#071015]">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#0a0d12]/86 px-4 backdrop-blur-xl md:px-7">
        <div className="mx-auto flex h-15 max-w-[1600px] items-center justify-between gap-4">
          <button onClick={() => setLocation("/app")} className="flex items-center gap-2.5 text-left">
            <span className="flex size-8 items-center justify-center rounded-xl bg-cyan-300 text-[#06131a]"><Cloud className="size-4" /></span>
            <span><span className="block text-sm font-semibold tracking-tight">Nova</span><span className="block text-[10px] uppercase tracking-[0.16em] text-white/40">Personal computer</span></span>
          </button>
          <div className="hidden items-center gap-2 text-xs text-white/50 sm:flex"><span className="size-1.5 rounded-full bg-emerald-300" /> Agent online</div>
          <div className="flex items-center gap-2 rounded-xl px-1.5 py-1">
            <Avatar className="size-7 border border-white/15"><AvatarFallback className="bg-white/8 text-[10px] text-white">{user.name?.charAt(0).toUpperCase() || "N"}</AvatarFallback></Avatar>
            <span className="hidden max-w-36 truncate text-xs text-white/70 sm:block">{user.email}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto min-h-[calc(100vh-120px)] max-w-[1600px] px-4 pb-24 pt-4 md:px-7 md:pt-7">{children}</main>

      <nav aria-label="Workspace navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0f141d]/94 px-3 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
        <div className="mx-auto grid max-w-xl grid-cols-4 gap-1">
          {tabs.map(tab => {
            const active = location === tab.path;
            return <button key={tab.path} onClick={() => setLocation(tab.path)} className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-medium transition ${active ? "bg-cyan-300 text-[#07131a]" : "text-white/52 hover:bg-white/7 hover:text-white"}`}><tab.icon className="size-4" />{tab.label}</button>;
          })}
        </div>
      </nav>
    </div>
  );
}
