/**
 * Nova landing page, styled in the spirit of Zo Computer:
 * clean white canvas, ink-dark Inter headlines with an orange accent,
 * product mockups of the Space app (sidebar, files, chat composer,
 * mobile bottom tabs), a feature grid, and a dark closing footer.
 */
import React, { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  Cpu,
  FileText,
  Folder,
  FolderOpen,
  Gauge,
  HardDrive,
  ListChecks,
  Menu,
  MessageSquareText,
  Moon,
  Music,
  Paperclip,
  Plus,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  Table,
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

const mockFiles = [
  { name: "final-deck.pdf", meta: "2 MB · Yesterday", icon: <FileText size={13} /> },
  { name: "notes-march.txt", meta: "4 KB · Monday", icon: <FileText size={13} /> },
  { name: "recording.m4a", meta: "18 MB · Monday", icon: <Music size={13} /> },
  { name: "expenses-q1.csv", meta: "8 KB · Sunday", icon: <Table size={13} /> },
];

function SpaceMockup() {
  return (
    <div className="mock-window text-left">
      <div className="mock-chrome">
        <span className="mock-dot orange" />
        <span className="mock-dot" />
        <span className="mock-dot" />
        <span className="mock-url"><ShieldCheck size={10} /> nova.app/space</span>
      </div>
      <div className="mock-space">
        <aside className="mock-sidebar">
          <div className="mock-brand"><NovaMark size={16} /> Nova Space</div>
          <p className="mock-nav-label">Space</p>
          <button className="mock-nav-item active" type="button"><HardDrive size={12} /> Home</button>
          <button className="mock-nav-item" type="button"><Folder size={12} /> Files</button>
          <button className="mock-nav-item" type="button"><MessageSquareText size={12} /> Chats</button>
          <button className="mock-nav-item" type="button"><Zap size={12} /> Automations</button>
          <button className="mock-nav-item" type="button"><TerminalSquare size={12} /> Terminal</button>
          <div className="mock-search"><Search size={10} /> Search chats</div>
          <p className="mock-nav-label">Recent</p>
          <div className="mock-chat-row"><MessageSquareText size={11} /> Launch checklist</div>
          <div className="mock-chat-row"><MessageSquareText size={11} /> Morning briefing</div>
          <div className="mock-user-chip"><span className="grid size-5 place-items-center rounded-full bg-[#171717] text-[8px] font-bold text-white">JM</span> Jamie M.<ChevronDown size={10} className="ml-auto" /></div>
        </aside>
        <div className="mock-main">
          <div className="mock-pagehead">
            <span className="mock-crumb">Files <em>/ Home</em></span>
            <button className="mock-add" type="button"><Plus size={10} /> Add</button>
          </div>
          <div className="mock-grid">
            <div className="mock-folder"><span className="mock-icon orange"><FolderOpen size={13} /></span><span>Documents<small>4 items</small></span></div>
            <div className="mock-folder"><span className="mock-icon orange"><FolderOpen size={13} /></span><span>Images<small>6 items</small></span></div>
            <div className="mock-folder"><span className="mock-icon orange"><FolderOpen size={13} /></span><span>Projects<small>3 items</small></span></div>
            <div className="mock-folder"><span className="mock-icon orange"><FolderOpen size={13} /></span><span>Archive<small>9 items</small></span></div>
          </div>
          <div className="mock-chat-panel">
            <div className="mock-bubble user">Organize these files into folders by type</div>
            <div className="mock-bubble bot">Done — I grouped your 10 files into folders: Docs, Images, Media, Data, and Web.</div>
            <div className="mock-composer">
              <Paperclip size={11} className="text-[#a3a3a3]" />
              <span className="flex-1 truncate text-[10px] text-[#a3a3a3]">Ask Nova…</span>
              <button className="mock-go" type="button" aria-label="Go"><ArrowUpRight size={12} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneMockup() {
  return (
    <div className="mock-phone float-slow">
      <div className="mock-screen">
        <div className="mock-statusbar"><span>9:41</span><span>Nova</span></div>
        <p className="mock-phone-title">Space</p>
        <div className="mock-phone-chat">
          <div className="mock-bubble user">Send the launch checklist to my email</div>
          <div className="mock-bubble bot">Done — it's on its way to jamie@nova.app. Want it as a PDF next time?</div>
          <div className="mock-bubble bot">Your Tuesday automation ran at 8:00 AM with no issues.</div>
        </div>
        <div className="mock-tabbar">
          <span className="mock-tab active"><Sparkles size={11} />Space</span>
          <span className="mock-tab"><Folder size={11} />Files</span>
          <span className="mock-tab"><MessageSquareText size={11} />Chat</span>
          <span className="mock-tab"><Zap size={11} />Automations</span>
          <span className="mock-tab"><Menu size={11} />More</span>
        </div>
      </div>
    </div>
  );
}

const features = [
  { icon: Folder, title: "Files", copy: "Browse, edit, and organize your files on your own cloud computer. Folders, plain-text editing, and a clean home view — private by default." },
  { icon: MessageSquareText, title: "Chats", copy: "Every conversation with Nova is saved and searchable. Pick up where you left off, or revisit past work with full context." },
  { icon: ListChecks, title: "Rules", copy: "Teach Nova your preferences. Standing workspace rules shape how future assistant experiences behave." },
  { icon: TerminalSquare, title: "Agent VM", copy: "Run explicit tasks in a short-lived private sandbox. Workspace files are bundled for the run; network access stays blocked." },
  { icon: Gauge, title: "NVIDIA gateway", copy: "A protected server-to-server inference gateway for quick private responses, with a clear request allowance." },
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
          <div className="border-t border-neutral-200 bg-white px-5 py-4 md:hidden dark:border-white/10 dark:bg-neutral-950">
            <div className="flex flex-col gap-1">
              {[["Product", "product"], ["Features", "features"], ["Pricing", "pricing"]].map(([label, id]) => (
                <button key={id} className="rounded-lg px-2 py-2.5 text-left text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white" onClick={() => { setMenuOpen(false); scrollToSection(id); }}>{label}</button>
              ))}
              <button className="pill-btn pill-btn-primary mt-3" onClick={() => { setMenuOpen(false); enterNova(); }}>Sign up</button>
            </div>
          </div>
        )}
      </header>

      <section className="hero-section" id="top">
        <div className="mx-auto max-w-6xl px-5 pb-24 pt-20 text-center sm:pt-28">
          <p className="section-eyebrow rise-in">Your personal cloud computer</p>
          <h1 className="hero-title rise-in-delay-1 mx-auto mt-5 max-w-4xl text-5xl sm:text-7xl">
            A computer that works for you, <span className="hero-accent">24/7.</span>
          </h1>
          <p className="rise-in-delay-2 mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Run your projects and ideas on Nova — a cloud computer with your files, conversations, model choices, and agent tasks in one private space you control.
          </p>
          <div className="rise-in-delay-3 mt-9 flex flex-wrap items-center justify-center gap-3">
            <button className="pill-btn pill-btn-primary" onClick={enterNova}>Sign up <ArrowRight size={16} /></button>
            <button className="pill-btn pill-btn-ghost" onClick={() => scrollToSection("product")}>See your space <ChevronDown size={15} /></button>
          </div>
          <p className="rise-in-delay-3 mt-5 inline-flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400"><Check size={13} className="text-[#c2410c] dark:text-[#fb923c]" /> No credit card required</p>
        </div>

        <div className="relative mx-auto max-w-6xl px-5 pb-28" id="product">
          <div className="rise-in-delay-3 relative pr-0 lg:pr-56">
            <SpaceMockup />
          </div>
          <div className="absolute -bottom-2 right-6 hidden w-[218px] lg:block xl:right-16">
            <PhoneMockup />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <p className="section-eyebrow">Organize your life</p>
            <h2 className="section-title mt-3 text-4xl sm:text-5xl">Work with anything in your personal cloud.</h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Your Nova comes with a private workspace for documents, notes, images, and projects — organized by you, or handed to Nova with one sentence.
            </p>
            <button className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-neutral-950 transition-colors hover:text-[#c2410c] dark:text-white dark:hover:text-[#fb923c]" onClick={() => scrollToSection("features")}>Explore Files <ArrowUpRight size={15} /></button>
          </div>
          <div className="mock-window float-slower">
            <div className="mock-chrome"><span className="mock-dot orange" /><span className="mock-dot" /><span className="mock-dot" /><span className="mock-url"><Folder size={10} /> Files</span></div>
            <div className="p-6">
              <div className="mb-5 flex items-center justify-between"><span className="text-sm font-semibold text-neutral-900 dark:text-white">Home</span><button className="rounded-full bg-[#c2410c] px-3.5 py-1.5 text-xs font-semibold text-white" type="button"><Plus size={11} className="mr-1 inline" />Add</button></div>
              <div className="grid grid-cols-2 gap-3">
                {mockFiles.map(file => (
                  <div key={file.name} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-white/10 dark:bg-neutral-900">
                    <span className="grid size-8 place-items-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{file.icon}</span>
                    <span className="min-w-0"><span className="block truncate text-xs font-semibold text-neutral-900 dark:text-white">{file.name}</span><span className="block text-[10px] text-neutral-500 dark:text-neutral-400">{file.meta}</span></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-neutral-100 bg-neutral-50/60 dark:border-white/5 dark:bg-neutral-900/40">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-24 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <div className="mock-window float-slow">
              <div className="mock-chrome"><span className="mock-dot orange" /><span className="mock-dot" /><span className="mock-dot" /><span className="mock-url"><Zap size={10} /> Automations</span></div>
              <div className="space-y-3 p-6">
                {[
                  { title: "Morning briefing", detail: "Daily at 8:00 AM", state: "Runs automatically" },
                  { title: "Invoice tracker", detail: "Weekly on Monday", state: "Runs automatically" },
                  { title: "Website uptime check", detail: "Hourly", state: "Runs automatically" },
                ].map(row => (
                  <div key={row.title} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
                    <span className="grid size-9 place-items-center rounded-full bg-[#c2410c]/10 text-[#c2410c] dark:bg-[#fb923c]/15 dark:text-[#fb923c]"><Zap size={15} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-neutral-900 dark:text-white">{row.title}</span><span className="block text-xs text-neutral-500 dark:text-neutral-400">{row.detail}</span></span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-500" />{row.state}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <p className="section-eyebrow">Build your dreams</p>
            <h2 className="section-title mt-3 text-4xl sm:text-5xl">Set the work in motion and let it run.</h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Nova's agent VM handles explicit tasks in a private sandbox, and workspace rules keep the important boundaries where you put them. Your computer keeps working while you don't.
            </p>
            <button className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-neutral-950 transition-colors hover:text-[#c2410c] dark:text-white dark:hover:text-[#fb923c]" onClick={() => scrollToSection("features")}>Explore Automations <ArrowUpRight size={15} /></button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <p className="section-eyebrow">Chat with superpowers</p>
            <h2 className="section-title mt-3 text-4xl sm:text-5xl">Talk to your computer like a person.</h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Nova is wherever you are: in the Space app, in saved conversations, and in Telegram. Keep your context, and reach your files from a message.
            </p>
            <button className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-neutral-950 transition-colors hover:text-[#c2410c] dark:text-white dark:hover:text-[#fb923c]" onClick={enterNova}>Open a conversation <ArrowUpRight size={15} /></button>
          </div>
          <div className="mock-window float-slower">
            <div className="mock-chrome"><span className="mock-dot orange" /><span className="mock-dot" /><span className="mock-dot" /><span className="mock-url"><MessageSquareText size={10} /> Chat</span></div>
            <div className="space-y-3 p-6">
              <div className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-md bg-neutral-950 px-4 py-2.5 text-[13px] leading-relaxed text-white dark:bg-white dark:text-neutral-950">What did my team change in the launch brief?</div></div>
              <div className="flex items-start gap-2.5">
                <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-[#c2410c]/10 text-[#c2410c] dark:bg-[#fb923c]/15 dark:text-[#fb923c]"><Bot size={13} /></span>
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Nova App</p>
                  <div className="max-w-full rounded-2xl rounded-tl-md bg-neutral-100 px-4 py-2.5 text-[13px] leading-relaxed text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">Three edits since Monday — pricing, timeline, and the Q3 goal. I dropped a summary into the project folder.</div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 dark:border-white/10 dark:bg-neutral-900">
                <Paperclip size={13} className="text-neutral-400" />
                <span className="flex-1 truncate text-[13px] text-neutral-400">Ask Nova…</span>
                
                <button className="grid size-7 place-items-center rounded-full bg-[#c2410c] text-white" type="button" aria-label="Go"><ArrowUpRight size={13} /></button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-neutral-100 bg-neutral-50/60 dark:border-white/5 dark:bg-neutral-900/40" id="features">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="section-eyebrow">Features</p>
            <h2 className="section-title mt-3 text-4xl sm:text-5xl">Everything your cloud computer can do.</h2>
            <p className="mt-5 text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">Files, chats, agent tasks, and more — everything lives on one private computer.</p>
          </div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(feature => (
              <article key={feature.title} className="feature-card group">
                <span className="grid size-10 place-items-center rounded-xl bg-[#c2410c]/10 text-[#c2410c] dark:bg-[#fb923c]/15 dark:text-[#fb923c]"><feature.icon size={18} /></span>
                <h3 className="mt-4 text-[15px] font-bold tracking-tight text-neutral-950 dark:text-white">{feature.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">{feature.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden border-b border-neutral-100 py-6 dark:border-white/5" aria-label="Nova capabilities">
        <div className="ribbon-track">
          {[0, 1].map(copy => (
            <div key={copy} className="flex items-center" aria-hidden={copy === 1}>
              {["Files", "Chats", "Rules", "Agent VM", "NVIDIA gateway", "Telegram", "Deployments", "Private by design"].map(label => (
                <span key={label} className="flex items-center gap-6 pr-6 text-xs font-bold uppercase tracking-[0.18em] text-neutral-400 dark:text-neutral-500"><Sparkles size={12} className="text-[#c2410c] dark:text-[#fb923c]" />{label}</span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24" id="faq">
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

      <section className="mx-auto max-w-6xl px-5 pb-28" id="pricing">
        <div className="relative overflow-hidden rounded-3xl bg-neutral-950 px-6 py-20 text-center dark:bg-neutral-900">
          <div className="absolute -right-20 -top-24 size-72 rounded-full bg-[#c2410c]/25 blur-3xl" aria-hidden="true" />
          <div className="absolute -bottom-28 -left-16 size-72 rounded-full bg-[#c2410c]/15 blur-3xl" aria-hidden="true" />
          <div className="relative">
            <p className="section-eyebrow text-[#fb923c]">A space that remembers you</p>
            <h2 className="mx-auto mt-4 max-w-2xl text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Start where you are. Keep your context.</h2>
            <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-neutral-400">Bring the current project, the rough note, or the ambitious idea. Nova keeps the shape of the work with you.</p>
            <button className="pill-btn pill-btn-primary mt-9" onClick={enterNova}>Sign up <ArrowRight size={16} /></button>
            <p className="mt-4 text-xs text-neutral-500">No credit card required · Private by design</p>
          </div>
        </div>
      </section>

      <footer className="bg-neutral-950 text-white">
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
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-6 text-xs text-neutral-500">
            <span>© 2026 Nova Computer</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#fb923c]" /> Your computer is always on</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
