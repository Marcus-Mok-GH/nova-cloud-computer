import React from "react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  LayoutGrid,
  MessageSquareText,
  Moon,
  Rocket,
  Sun,
  Timer,
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
              <div className="grid min-h-[390px] grid-cols-[132px_1fr]">
                <aside className="border-r border-[#e7e4dc] bg-[#f3f1eb] p-3 dark:border-white/10 dark:bg-[#1b211f]">
                  <p className="px-2 pb-3 text-[9px] font-bold uppercase tracking-[0.14em] text-[#9a9c94]">Your space</p>
                  <div className="space-y-1 text-[11px] font-medium text-[#626660] dark:text-[#b3b8b0]"><div className="flex items-center gap-2 rounded-lg bg-white px-2 py-2 text-[#374447] shadow-sm dark:bg-white/10 dark:text-white"><LayoutGrid className="size-3.5" />Overview</div><div className="flex items-center gap-2 rounded-lg px-2 py-2"><FolderOpen className="size-3.5" />Files</div><div className="flex items-center gap-2 rounded-lg px-2 py-2"><MessageSquareText className="size-3.5" />Chats</div><div className="flex items-center gap-2 rounded-lg px-2 py-2"><Timer className="size-3.5" />Routines</div></div>
                  <div className="mt-10 border-t border-[#dedbd2] pt-3 dark:border-white/10"><p className="px-2 text-[9px] font-bold uppercase tracking-[0.14em] text-[#9a9c94]">Recent</p><p className="mt-3 truncate px-2 text-[11px] text-[#777a73]">project-notes.md</p><p className="mt-2 truncate px-2 text-[11px] text-[#777a73]">weekly-plan.txt</p></div>
                </aside>
                <div className="p-5 sm:p-7">
                  <p className="text-[11px] font-semibold text-[#b65f38] dark:text-[#e59468]">Good morning</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#283336] dark:text-[#f4f0e8]">What are we working on?</h2>
                  <p className="mt-2 max-w-sm text-xs leading-5 text-[#858780] dark:text-[#aeb3aa]">Open a file, continue a conversation, or leave Nova a task for later.</p>
                  <div className="mt-7 rounded-xl border border-[#ddd9d0] bg-white p-3 dark:border-white/10 dark:bg-white/5"><div className="flex items-center gap-2 text-xs text-[#9a9c94]"><span className="grid size-6 place-items-center rounded-md bg-[#f0ddd4] text-[#b65f38] dark:bg-[#a5674c]/20 dark:text-[#e59468]"><MessageSquareText className="size-3.5" /></span>Ask Nova anything about your work</div><div className="mt-4 flex justify-end"><span className="rounded-lg bg-[#26343a] px-2.5 py-1.5 text-[10px] font-semibold text-white dark:bg-[#e9e5db] dark:text-[#1f2529]">Start a chat</span></div></div>
                  <div className="mt-6"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9a9c94]">Pick up where you left off</span><ChevronRight className="size-3.5 text-[#9a9c94]" /></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-lg border border-[#e3e0d8] px-3 py-2.5 dark:border-white/10"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#59615f] dark:text-[#d3d6cf]"><FileText className="size-3.5 text-[#b65f38]" />Project notes</div><p className="mt-1 text-[10px] text-[#9a9c94]">Edited yesterday</p></div><div className="rounded-lg border border-[#e3e0d8] px-3 py-2.5 dark:border-white/10"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#59615f] dark:text-[#d3d6cf]"><Rocket className="size-3.5 text-[#6f8d75]" />Weekly routine</div><p className="mt-1 text-[10px] text-[#9a9c94]">Runs on Monday</p></div></div></div>
                </div>
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
