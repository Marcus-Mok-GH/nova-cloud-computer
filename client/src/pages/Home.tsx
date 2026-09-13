import React from "react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  Cloud,
  Database,
  Folder,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  MessageSquareText,
  Moon,
  Rocket,
  Server,
  Settings2,
  Sun,
  Timer,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import NovaMark from "@/components/NovaMark";

type Feature = { icon: LucideIcon; eyebrow: string; title: string; body: string };

const features: Feature[] = [
  { icon: FolderOpen, eyebrow: "Workspace", title: "A place that remembers", body: "Keep files, notes, and small projects together so you can pick up where you left off." },
  { icon: MessageSquareText, eyebrow: "Conversations", title: "Useful help, in context", body: "Talk through a problem with the files and history around it, not in a blank chat window." },
  { icon: Timer, eyebrow: "Automations", title: "Less work to repeat", body: "Turn the small recurring jobs into routines that keep moving while you get on with the day." },
];

const steps = [
  { title: "Bring the work in", body: "Start with a file, a note, or a task you already have in mind." },
  { title: "Work alongside Nova", body: "Ask questions, make changes, and keep the useful context in one place." },
  { title: "Leave it ready", body: "Save the result, hand off the next step, or let a routine take it from here." },
];

function Home() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const enterNova = () => {
    setMenuOpen(false);
    setLocation(isAuthenticated ? "/app" : "/sign-in");
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f5f1] text-[#1f2529] dark:bg-[#121514] dark:text-[#f4f0e8]">
      <header className="sticky top-0 z-40 border-b border-[#dfdcd4]/90 bg-[#f7f5f1]/95 backdrop-blur dark:border-white/10 dark:bg-[#121514]/95">
        <div className="mx-auto flex h-[70px] max-w-6xl items-center justify-between gap-5 px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5" aria-label="Nova home">
            <NovaMark size={27} />
            <span className="text-[17px] font-bold tracking-[-0.02em]">Nova</span>
            <span className="hidden border-l border-[#d6d2c9] pl-2.5 text-[11px] font-medium text-[#77766f] sm:inline dark:border-white/15 dark:text-[#a7aaa4]">cloud computer</span>
          </a>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
            <a href="#product" className="rounded-lg px-3 py-2 text-sm font-medium text-[#686a65] transition hover:bg-[#ece9e2] hover:text-[#1f2529] dark:text-[#a7aaa4] dark:hover:bg-white/8 dark:hover:text-white">What it does</a>
            <a href="#how-it-works" className="rounded-lg px-3 py-2 text-sm font-medium text-[#686a65] transition hover:bg-[#ece9e2] hover:text-[#1f2529] dark:text-[#a7aaa4] dark:hover:bg-white/8 dark:hover:text-white">How it works</a>
            <a href="#use-cases" className="rounded-lg px-3 py-2 text-sm font-medium text-[#686a65] transition hover:bg-[#ece9e2] hover:text-[#1f2529] dark:text-[#a7aaa4] dark:hover:bg-white/8 dark:hover:text-white">Use cases</a>
          </nav>
          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleTheme} className="grid size-9 place-items-center rounded-full border border-[#d9d6ce] text-[#686a65] transition hover:bg-[#ece9e2] hover:text-[#1f2529] dark:border-white/15 dark:text-[#a7aaa4] dark:hover:bg-white/8 dark:hover:text-white" aria-label={theme === "light" ? "Use dark theme" : "Use light theme"}>
              {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </button>
            <button type="button" onClick={enterNova} className="hidden rounded-full bg-[#26343a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#34474f] sm:inline-flex dark:bg-[#e9e5db] dark:text-[#1f2529] dark:hover:bg-white">{isAuthenticated ? "Open workspace" : "Sign in"}</button>
            <button type="button" onClick={() => setMenuOpen(open => !open)} className="grid size-9 place-items-center rounded-full border border-[#d9d6ce] text-[#686a65] md:hidden dark:border-white/15 dark:text-[#a7aaa4]" aria-label={menuOpen ? "Close navigation" : "Open navigation"}>
              <span className="text-lg leading-none">{menuOpen ? "×" : "☰"}</span>
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-[#dfdcd4] px-5 py-3 md:hidden dark:border-white/10">
            <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
              <a href="#product" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-[#4f5553] dark:text-[#d6d8d2]">What it does</a>
              <a href="#how-it-works" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-[#4f5553] dark:text-[#d6d8d2]">How it works</a>
              <a href="#use-cases" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-[#4f5553] dark:text-[#d6d8d2]">Use cases</a>
              <button type="button" onClick={enterNova} className="mt-2 rounded-lg bg-[#26343a] px-3 py-2.5 text-left text-sm font-semibold text-white dark:bg-[#e9e5db] dark:text-[#1f2529]">{isAuthenticated ? "Open workspace" : "Sign in"}</button>
            </nav>
          </div>
        )}
      </header>

      <section id="top" className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16 lg:pb-28">
        <div className="max-w-xl">
          <p className="text-sm font-semibold tracking-[0.04em] text-[#b65f38] dark:text-[#e59468]">A calmer way to work online</p>
          <h1 className="mt-5 max-w-lg text-[clamp(2.8rem,6vw,5.25rem)] font-semibold leading-[0.98] tracking-[-0.065em] text-[#1f2529] dark:text-[#f4f0e8]">Your work, in one calm place.</h1>
          <p className="mt-6 max-w-lg text-[17px] leading-8 text-[#626660] dark:text-[#b5b8b0]">Nova is a persistent cloud computer for the work that lives between your tabs: files to organize, ideas to untangle, and small jobs that need doing.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button type="button" onClick={enterNova} className="inline-flex items-center gap-2 rounded-full bg-[#b65f38] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(182,95,56,0.2)] transition hover:-translate-y-0.5 hover:bg-[#9f4f2d]">{isAuthenticated ? "Open your workspace" : "Create your workspace"}<ArrowUpRight className="size-4" /></button>
            <a href="#how-it-works" className="inline-flex items-center gap-1.5 rounded-full px-4 py-3 text-sm font-semibold text-[#4e5758] transition hover:bg-[#ece9e2] dark:text-[#d7d9d2] dark:hover:bg-white/8">See how it works<ChevronRight className="size-4" /></a>
          </div>
          <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#858780] dark:text-[#969b94]">
            <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-[#6f8d75]" />Persistent workspace</span>
            <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-[#6f8d75]" />Sign in with a code</span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -right-8 -top-8 size-32 rounded-full bg-[#e3b59e]/35 blur-3xl dark:bg-[#a5674c]/20" />
          <div className="relative rounded-[2rem] border border-[#d8d5cc] bg-[#ece9e2] p-3 shadow-[0_24px_70px_rgba(47,46,39,0.12)] dark:border-white/10 dark:bg-[#1d2422] dark:shadow-none">
            <div className="overflow-hidden rounded-[1.45rem] border border-[#d4d1c8] bg-[#fbfaf7] dark:border-white/10 dark:bg-[#151a19]">
              <div className="flex items-center justify-between border-b border-[#e3e0d8] px-4 py-3 dark:border-white/10"><div className="flex items-center gap-2"><span className="flex gap-1"><i className="size-2 rounded-full bg-[#d98e6b]" /><i className="size-2 rounded-full bg-[#d6bc72]" /><i className="size-2 rounded-full bg-[#8ca48d]" /></span><span className="ml-2 text-[11px] font-semibold text-[#777a73] dark:text-[#aeb3aa]">Nova / Workspace</span></div><span className="text-[10px] font-medium text-[#9b9d96]">Today</span></div>
              <div className="flex min-h-[440px] flex-col">
                <div className="flex items-center justify-between border-b border-[#e3e0d8] px-4 py-2.5 dark:border-white/10"><div className="flex items-center gap-2"><NovaMark size={15} /><span className="text-[13px] font-extrabold tracking-tight text-[#283336] dark:text-[#f4f0e8]">Nova</span></div><span className="grid size-6 place-items-center rounded-full bg-[#26343a] text-[9px] font-bold text-white dark:bg-[#e9e5db] dark:text-[#1f2529]">M</span></div>

                <div className="flex-1 p-4 sm:p-5">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#b65f38] dark:text-[#e59468]">Your workspace</p>
                      <h3 className="mt-1 text-xl font-extrabold tracking-tight text-[#283336] dark:text-[#f4f0e8]">Workspace</h3>
                      <p className="mt-1 text-[10px] text-[#858780] dark:text-[#aeb3aa]">Files, conversations, and ongoing work in one place.</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <span className="hidden items-center gap-1 rounded-lg border border-[#ddd9d0] bg-white px-2 py-1.5 text-[9px] font-bold text-[#59615f] shadow-sm sm:inline-flex dark:border-white/10 dark:bg-white/5 dark:text-[#d3d6cf]"><MessageSquareText className="size-3" />Open conversations</span>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[#b65f38] px-2 py-1.5 text-[9px] font-bold text-white shadow-sm dark:bg-[#e59468] dark:text-[#1f2529]"><Folder className="size-3" />Browse workspace</span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-[#e3e0d8] bg-white p-2.5 dark:border-white/10 dark:bg-white/5"><div className="grid size-6 place-items-center rounded-lg bg-[#f0ddd4] text-[#b65f38] dark:bg-[#a5674c]/20 dark:text-[#e59468]"><MessageSquareText className="size-3" /></div><p className="mt-2 text-[8px] font-bold uppercase tracking-[0.12em] text-[#9a9c94]">Conversations</p><p className="text-base font-extrabold tracking-tight text-[#283336] dark:text-[#f4f0e8]">12</p><p className="text-[9px] text-[#9a9c94]">saved in this computer</p></div>
                    <div className="rounded-xl border border-[#e3e0d8] bg-white p-2.5 dark:border-white/10 dark:bg-white/5"><div className="grid size-6 place-items-center rounded-lg bg-[#f0ddd4] text-[#b65f38] dark:bg-[#a5674c]/20 dark:text-[#e59468]"><TrendingUp className="size-3" /></div><p className="mt-2 text-[8px] font-bold uppercase tracking-[0.12em] text-[#9a9c94]">Open work</p><p className="text-base font-extrabold tracking-tight text-[#283336] dark:text-[#f4f0e8]">4</p><p className="text-[9px] text-[#9a9c94]">67% completed</p></div>
                    <div className="rounded-xl border border-[#e3e0d8] bg-white p-2.5 dark:border-white/10 dark:bg-white/5"><div className="grid size-6 place-items-center rounded-lg bg-[#f0ddd4] text-[#b65f38] dark:bg-[#a5674c]/20 dark:text-[#e59468]"><Database className="size-3" /></div><p className="mt-2 text-[8px] font-bold uppercase tracking-[0.12em] text-[#9a9c94]">Files &amp; folders</p><p className="text-base font-extrabold tracking-tight text-[#283336] dark:text-[#f4f0e8]">18</p><p className="text-[9px] text-[#9a9c94]">12 files · 6 folders</p></div>
                    <div className="rounded-xl border border-[#e3e0d8] bg-white p-2.5 dark:border-white/10 dark:bg-white/5"><div className="grid size-6 place-items-center rounded-lg bg-[#f0ddd4] text-[#b65f38] dark:bg-[#a5674c]/20 dark:text-[#e59468]"><Bot className="size-3" /></div><p className="mt-2 text-[8px] font-bold uppercase tracking-[0.12em] text-[#9a9c94]">Agent runs</p><p className="text-base font-extrabold tracking-tight text-[#283336] dark:text-[#f4f0e8]">6</p><p className="text-[9px] text-[#9a9c94]">no failed runs</p></div>
                  </div>

                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                    <div className="rounded-xl border border-[#e3e0d8] bg-white p-3 dark:border-white/10 dark:bg-white/5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-lg bg-[#f0ddd4] text-[#b65f38] dark:bg-[#a5674c]/20 dark:text-[#e59468]"><BarChart3 className="size-3" /></span><p className="text-[10px] font-bold text-[#374447] dark:text-[#d3d6cf]">Your week</p></div><span className="rounded-full bg-[#f3f1eb] px-2 py-0.5 text-[8px] font-bold text-[#9a9c94] dark:bg-white/10">Updated as you work</span></div><div className="mt-3 flex h-24 items-end gap-1.5">{[3, 5, 2, 6, 4, 1, 3].map((count, i) => <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1"><div className="flex h-16 w-full items-end rounded-md bg-[#f3f1eb] dark:bg-white/10"><div className="w-full rounded-md bg-[#b65f38] dark:bg-[#e59468]" style={{ height: (count / 6) * 100 + "%", minHeight: "4px" }} /></div><span className="text-[8px] font-semibold text-[#9a9c94]">{"MTWTFSS"[i]}</span></div>)}</div></div>
                    <div className="rounded-xl border border-[#e3e0d8] bg-white p-3 dark:border-white/10 dark:bg-white/5"><div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-lg bg-[#e4efe4] text-[#6f8d75] dark:bg-[#6f8d75]/20 dark:text-[#9dc4a1]"><Activity className="size-3" /></span><p className="text-[10px] font-bold text-[#374447] dark:text-[#d3d6cf]">Workspace status</p></div><div className="mt-3 space-y-2">{[{ icon: Cloud, label: "Persistent workspace", value: "Ready", pct: 100 }, { icon: Server, label: "Agent provider", value: "NVIDIA NIM", pct: 100 }, { icon: Rocket, label: "Automations", value: "3 active", pct: 60 }, { icon: HardDrive, label: "Current model", value: "Default", pct: 100 }].map(row => { const RowIcon = row.icon; return <div key={row.label}><div className="flex items-center justify-between text-[9px]"><span className="flex items-center gap-1.5 font-semibold text-[#59615f] dark:text-[#d3d6cf]"><RowIcon className="size-2.5 text-[#9a9c94]" />{row.label}</span><span className="font-bold text-[#9a9c94]">{row.value}</span></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-[#f3f1eb] dark:bg-white/10"><div className="h-full rounded-full bg-[#b65f38] dark:bg-[#e59468]" style={{ width: row.pct + "%" }} /></div></div>; })}</div></div>
                  </div>

                  <div className="mt-2.5 rounded-xl bg-[#26343a] p-3.5 text-[#f4f0e8] dark:bg-white/10"><p className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.14em] text-[#e9a17b]"><TrendingUp className="size-3" />Next up</p><div className="mt-1 flex items-center justify-between gap-2"><p className="text-[11px] font-semibold tracking-tight">What would you like to work on next?</p><span className="shrink-0 rounded-lg bg-[#f4f0e8] px-2 py-1 text-[9px] font-bold text-[#26343a]">Start a conversation</span></div></div>
                </div>

                <div className="border-t border-[#e3e0d8] bg-[#f3f1eb] px-2 py-2 dark:border-white/10 dark:bg-[#1b211f]"><div className="flex items-stretch justify-center gap-1">{[{ icon: LayoutGrid, label: "Overview", active: true }, { icon: Folder, label: "Files", active: false }, { icon: MessageSquareText, label: "Chats", active: false }, { icon: Rocket, label: "Deployments", active: false }, { icon: Settings2, label: "Settings", active: false }].map(tab => { const TabIcon = tab.icon; return <div key={tab.label} className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 ${tab.active ? "bg-[#b65f38]/10 text-[#b65f38] dark:bg-[#e59468]/10 dark:text-[#e59468]" : "text-[#9a9c94]"}`}><TabIcon className="size-3.5" /><span className={`text-[8px] ${tab.active ? "font-bold" : "font-semibold"}`}>{tab.label}</span></div>; })}</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="border-y border-[#dfdcd4] bg-[#efede7] py-20 dark:border-white/10 dark:bg-[#191e1c] sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8"><div className="max-w-2xl"><p className="text-sm font-semibold text-[#b65f38] dark:text-[#e59468]">The useful parts stay close</p><h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#293336] dark:text-[#f4f0e8] sm:text-4xl">A little less juggling. A lot more follow-through.</h2><p className="mt-4 text-base leading-7 text-[#6e716b] dark:text-[#adb1a9]">Nova is designed around the way work actually accumulates: one file, one conversation, one small job at a time.</p></div><div className="mt-12 grid gap-4 md:grid-cols-3">{features.map(feature => { const Icon = feature.icon; return <article key={feature.title} className="rounded-2xl border border-[#d9d6ce] bg-[#faf9f6] p-6 dark:border-white/10 dark:bg-[#202623]"><div className="grid size-10 place-items-center rounded-xl bg-[#f0ddd4] text-[#b65f38] dark:bg-[#a5674c]/20 dark:text-[#e59468]"><Icon className="size-[18px]" /></div><p className="mt-7 text-xs font-bold uppercase tracking-[0.13em] text-[#8b8d86]">{feature.eyebrow}</p><h3 className="mt-2 text-lg font-semibold tracking-[-0.025em] text-[#293336] dark:text-[#f4f0e8]">{feature.title}</h3><p className="mt-3 text-sm leading-6 text-[#70736d] dark:text-[#adb1a9]">{feature.body}</p></article>; })}</div></div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24"><div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20"><div><p className="text-sm font-semibold text-[#b65f38] dark:text-[#e59468]">How it works</p><h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#293336] dark:text-[#f4f0e8] sm:text-4xl">Start with the thing in front of you.</h2><p className="mt-4 max-w-md text-base leading-7 text-[#6e716b] dark:text-[#adb1a9]">No elaborate setup or blank-canvas ceremony. Nova becomes more useful as your workspace fills with the things you are already doing.</p></div><div className="divide-y divide-[#dfdcd4] border-y border-[#dfdcd4] dark:divide-white/10 dark:border-white/10">{steps.map((step, index) => <div key={step.title} className="grid gap-4 py-6 sm:grid-cols-[56px_1fr] sm:items-start"><span className="text-sm font-semibold text-[#b65f38] dark:text-[#e59468]">{String(index + 1).padStart(2, "0")}</span><div><h3 className="text-lg font-semibold tracking-[-0.025em] text-[#293336] dark:text-[#f4f0e8]">{step.title}</h3><p className="mt-2 max-w-lg text-sm leading-6 text-[#70736d] dark:text-[#adb1a9]">{step.body}</p></div></div>)}</div></div></section>

      <section id="use-cases" className="mx-auto max-w-6xl px-5 pb-20 sm:px-8 sm:pb-28"><div className="rounded-[2rem] bg-[#26343a] px-6 py-12 text-[#f4f0e8] sm:px-12 sm:py-14"><div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end"><div><p className="text-sm font-semibold text-[#e9a17b]">For the work between the tabs</p><h2 className="mt-4 max-w-lg text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">Make room for the work that keeps getting postponed.</h2></div><div className="grid gap-3 sm:grid-cols-3"><div className="border-t border-white/20 pt-3"><p className="text-sm font-semibold">Collect</p><p className="mt-1 text-xs leading-5 text-[#b9c0bb]">Turn scattered notes into a place you can return to.</p></div><div className="border-t border-white/20 pt-3"><p className="text-sm font-semibold">Make</p><p className="mt-1 text-xs leading-5 text-[#b9c0bb]">Build small tools and useful first drafts without starting over.</p></div><div className="border-t border-white/20 pt-3"><p className="text-sm font-semibold">Repeat</p><p className="mt-1 text-xs leading-5 text-[#b9c0bb]">Keep recurring work moving with routines that know the context.</p></div></div></div><div className="mt-12 flex flex-wrap items-center justify-between gap-5 border-t border-white/15 pt-6"><p className="text-sm text-[#c2c8c2]">The best place to begin is usually the task you keep opening another tab for.</p><button type="button" onClick={enterNova} className="inline-flex items-center gap-2 rounded-full bg-[#f4f0e8] px-4 py-2.5 text-sm font-semibold text-[#26343a] transition hover:bg-white">{isAuthenticated ? "Open your workspace" : "Get started"}<ArrowUpRight className="size-4" /></button></div></div></section>

      <footer className="border-t border-[#dfdcd4] px-5 py-7 dark:border-white/10 sm:px-8"><div className="mx-auto flex max-w-6xl flex-col gap-2 text-xs text-[#858780] sm:flex-row sm:items-center sm:justify-between"><span>Nova cloud computer</span><span>A workspace for the work in progress.</span></div></footer>
    </main>
  );
}

export default Home;
