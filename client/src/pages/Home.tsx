import React, { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Folder,
  ListChecks,
  MessageSquareText,
  Moon,
  Rocket,
  Send,
  Sun,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import NovaMark from "@/components/NovaMark";

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const features = [
  { icon: Folder, title: "Files", copy: "Browse, edit, and organize your files on your own cloud computer. Folders, plain-text editing, and a clean home view — private by default." },
  { icon: MessageSquareText, title: "Chats", copy: "Every conversation with Nova is saved and searchable. Pick up where you left off, or revisit past work with full context." },
  { icon: ListChecks, title: "Rules", copy: "Teach Nova your preferences. Standing workspace rules shape how future assistant experiences behave." },
  { icon: TerminalSquare, title: "Agent VM", copy: "Run explicit tasks in a short-lived private sandbox. Workspace files are bundled for the run; network access stays blocked." },
  { icon: Zap, title: "NVIDIA gateway", copy: "A protected server-to-server inference gateway for quick private responses, with a clear request allowance." },
  { icon: Send, title: "Telegram", copy: "Send messages and test notifications from your workspace through your own validated Telegram bot." },
  { icon: Rocket, title: "Deployments", copy: "A calm release room for what Nova is ready to publish — deployment notes and status in one place." },
];

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const enterNova = () => {
    if (isAuthenticated) setLocation("/app");
    else setLocation("/sign-in");
  };

  return (
    <main className="site-shell">
      <header className="nav-shell">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5">
          <a className="flex items-center gap-2" href="#top" onClick={() => setMenuOpen(false)} aria-label="Nova home">
            <NovaMark size={22} />
            <span className="text-[17px] font-extrabold tracking-tight text-neutral-950 dark:text-neutral-50">Nova</span>
          </a>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
            <button className="topbar-link" onClick={() => scrollToSection("product")}>Product</button>
            <button className="topbar-link" onClick={() => scrollToSection("features")}>Features</button>
            <button className="topbar-link" onClick={() => scrollToSection("pricing")}>Pricing</button>
          </nav>
          <div className="flex items-center gap-2.5">
            <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}</button>
            <button className="topbar-link hidden sm:inline-flex" onClick={enterNova}>{isAuthenticated ? "Open space" : "Log in"}</button>
            <button className="pill-btn pill-btn-primary hidden h-10 px-5 text-[13px] sm:inline-flex" onClick={enterNova}>Sign up</button>
            <button className="theme-toggle md:hidden" aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen(open => !open)}>{menuOpen ? <X size={16} /> : <Menu size={16} />}</button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-neutral-200 bg-white px-5 py-4 md:hidden dark:border-white/8 dark:bg-[#0a0a0a]">
            <div className="flex flex-col gap-1">
              {[["Product", "product"], ["Features", "features"], ["Pricing", "pricing"]].map(([label, id]) => (
                <button key={id} className="rounded-lg px-2 py-2.5 text-left text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white" onClick={() => { setMenuOpen(false); scrollToSection(id); }}>{label}</button>
              ))}
              <button className="pill-btn pill-btn-primary mt-3" onClick={() => { setMenuOpen(false); enterNova(); }}>Sign up</button>
            </div>
          </div>
        )}
      </header>

      {/* Dark hero section */}
      <section className="hero-section" id="top">
        <div className="relative mx-auto max-w-6xl px-5 pb-28 pt-24 text-center sm:pt-32">
          <p className="section-eyebrow rise-in">Your personal cloud computer</p>
          <h1 className="hero-title rise-in-delay-1 mx-auto mt-6 max-w-4xl text-5xl sm:text-7xl">
            A computer that works for you, <span className="hero-accent">24/7.</span>
          </h1>
          <p className="rise-in-delay-2 mx-auto mt-7 max-w-xl text-[15px] leading-relaxed text-neutral-400">
            Run your projects and ideas on Nova — a cloud computer with your files, conversations, model choices, and agent tasks in one private space you control.
          </p>
          <div className="rise-in-delay-3 mt-10 flex flex-wrap items-center justify-center gap-3">
            <button className="pill-btn pill-btn-primary" onClick={enterNova}>Sign up <ArrowRight size={16} /></button>
            <button className="pill-btn pill-btn-ghost" onClick={() => scrollToSection("product")}>See your space <ChevronDown size={15} /></button>
          </div>
          <p className="rise-in-delay-3 mt-6 inline-flex items-center gap-1.5 text-xs text-neutral-500"><Check size={13} className="text-[oklch(0.60_0.02_250)]" /> No credit card required</p>
        </div>
      </section>

      {/* Product section */}
      <section className="mx-auto max-w-6xl px-5 py-28" id="product">
        <div className="mx-auto max-w-2xl text-center">
          <p className="section-eyebrow">Your space</p>
          <h2 className="section-title mt-3 text-4xl sm:text-5xl">Everything in one private workspace.</h2>
          <p className="mt-5 text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Nova keeps your files, conversations, automations, and AI models in a single space you control. No context-switching, no scattered tools.
          </p>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: Folder, label: "Files", desc: "Browse and edit documents, images, and code in a clean file explorer." },
            { icon: MessageSquareText, label: "Chats", desc: "Persistent conversations with full workspace context." },
            { icon: Zap, label: "Automations", desc: "Scheduled tasks that run in the background while you focus elsewhere." },
          ].map(item => (
            <div key={item.label} className="feature-card flex flex-col items-start gap-4">
              <span className="grid size-10 place-items-center rounded-xl bg-[oklch(0.60_0.02_250/0.10)] text-[oklch(0.60_0.02_250)]"><item.icon size={18} /></span>
              <div>
                <h3 className="text-[15px] font-bold tracking-tight text-neutral-950 dark:text-white">{item.label}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features section */}
      <section className="border-t border-neutral-100 dark:border-white/5" id="features">
        <div className="mx-auto max-w-6xl px-5 py-28">
          <div className="mx-auto max-w-2xl text-center">
            <p className="section-eyebrow">Features</p>
            <h2 className="section-title mt-3 text-4xl sm:text-5xl">Everything your cloud computer can do.</h2>
            <p className="mt-5 text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">Files, chats, agent tasks, and more — everything lives on one private computer.</p>
          </div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(feature => (
              <article key={feature.title} className="feature-card group">
                <span className="grid size-10 place-items-center rounded-xl bg-[oklch(0.60_0.02_250/0.10)] text-[oklch(0.60_0.02_250)]"><feature.icon size={18} /></span>
                <h3 className="mt-4 text-[15px] font-bold tracking-tight text-neutral-950 dark:text-white">{feature.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">{feature.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-6xl px-5 py-28" id="faq">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="section-eyebrow">Good to know</p>
            <h2 className="section-title mt-3 text-4xl sm:text-5xl">Questions, without the runaround.</h2>
            <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">Nova is designed to be understandable before it asks you to trust it.</p>
          </div>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1"><AccordionTrigger className="py-5 text-[15px] font-semibold">What exactly is a personal cloud computer?</AccordionTrigger><AccordionContent className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">It is a private workspace that gives your projects and working preferences a durable home. Nova begins by keeping those things together, so useful context does not vanish between applications.</AccordionContent></AccordionItem>
            <AccordionItem value="item-3"><AccordionTrigger className="py-5 text-[15px] font-semibold">How are custom API keys handled?</AccordionTrigger><AccordionContent className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">Nova encrypts a custom endpoint key before storing it and never displays the key again after submission. The saved model record only confirms that a key is present.</AccordionContent></AccordionItem>
            <AccordionItem value="item-4"><AccordionTrigger className="py-5 text-[15px] font-semibold">Can I begin with a small personal project?</AccordionTrigger><AccordionContent className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">That is a great place to begin. A notebook, an idea archive, or a small project hub can grow into a more capable personal workspace whenever you are ready.</AccordionContent></AccordionItem>
          </Accordion>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-28" id="pricing">
        <div className="relative overflow-hidden rounded-3xl bg-[#0a0a0a] px-6 py-20 text-center">
          <div className="absolute -right-20 -top-24 size-72 rounded-full bg-[oklch(0.60_0.02_250/0.12)] blur-3xl" aria-hidden="true" />
          <div className="absolute -bottom-28 -left-16 size-72 rounded-full bg-[oklch(0.60_0.02_250/0.08)] blur-3xl" aria-hidden="true" />
          <div className="relative">
            <p className="section-eyebrow">A space that remembers you</p>
            <h2 className="mx-auto mt-4 max-w-2xl text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Start where you are. Keep your context.</h2>
            <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-neutral-400">Bring the current project, the rough note, or the ambitious idea. Nova keeps the shape of the work with you.</p>
            <button className="pill-btn pill-btn-primary mt-9" onClick={enterNova}>Sign up <ArrowRight size={16} /></button>
            <p className="mt-4 text-xs text-neutral-500">No credit card required · Private by design</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0a0a0a] text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-[1.2fr_2fr]">
          <div>
            <a className="flex items-center gap-2" href="#top"><NovaMark size={22} /><span className="text-[17px] font-extrabold tracking-tight">Nova</span></a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-neutral-400">A personal cloud computer for people building a richer working life.</p>
          </div>
          <div className="grid grid-cols-2 gap-6 text-sm sm:grid-cols-3">
            <div><p className="mb-4 font-bold">Explore</p><div className="flex flex-col gap-3 text-neutral-400"><a className="transition-colors hover:text-white" href="#product">Your space</a><a className="transition-colors hover:text-white" href="#features">Features</a><a className="transition-colors hover:text-white" href="#faq">Questions</a></div></div>
            <div><p className="mb-4 font-bold">Company</p><div className="flex flex-col gap-3 text-neutral-400"><a className="transition-colors hover:text-white" href="#top">About</a><a className="transition-colors hover:text-white" href="#pricing">Plans</a><a className="transition-colors hover:text-white" href="#top">Journal</a></div></div>
            <div><p className="mb-4 font-bold">Follow</p><div className="flex flex-col gap-3 text-neutral-400"><a className="transition-colors hover:text-white" href="#top">Notes</a><a className="transition-colors hover:text-white" href="#top">Field guide</a><a className="transition-colors hover:text-white" href="#top">Contact</a></div></div>
          </div>
        </div>
        <div className="border-t border-white/8">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-6 text-xs text-neutral-500">
            <span>&copy; 2026 Nova Computer</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[oklch(0.60_0.02_250)]" /> Your computer is always on</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Menu({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
