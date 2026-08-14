/**
 * Nova style reminder: Iridescent Editorial Utility — a serene eggshell surface,
 * oversized DM Serif Display, compact Manrope UI, tactile dark pill controls,
 * and original cloud-workspace scenes with sea-glass highlights.
 */
import { useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Command,
  FileText,
  Folder,
  Globe2,
  Layers3,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

const navigation = ["Product", "Guides", "Resources", "About"];
const workspaceModes = ["Organize", "Plan", "Make", "Connect"] as const;
type WorkspaceMode = (typeof workspaceModes)[number];

const modeData: Record<
  WorkspaceMode,
  { eyebrow: string; title: string; reply: string; task: string; icon: React.ReactNode }
> = {
  Organize: {
    eyebrow: "A calmer working system",
    title: "Everything, finally in its place.",
    reply: "Sorted 12 loose files into Projects, Notes, Images and Archive. Your next actions are surfaced below.",
    task: "Collect research for the next release",
    icon: <Folder size={15} />,
  },
  Plan: {
    eyebrow: "A clear path forward",
    title: "Turn a thought into a live plan.",
    reply: "I framed the goal, sequenced the work, and made room for the moments that need your attention.",
    task: "Map milestones for the autumn launch",
    icon: <Layers3 size={15} />,
  },
  Make: {
    eyebrow: "A studio without the sprawl",
    title: "Bring the rough idea into focus.",
    reply: "The project brief is ready: a landing page outline, image direction, and a simple publishing checklist.",
    task: "Shape the story for the new site",
    icon: <Sparkles size={15} />,
  },
  Connect: {
    eyebrow: "A connected personal cloud",
    title: "Let the important tools talk.",
    reply: "Your inbox, calendar and notes are arranged around the work—not the other way around.",
    task: "Prepare the handoff for tomorrow",
    icon: <MessageCircle size={15} />,
  },
};

const orbitCards = [
  { number: "01", name: "For the work day", copy: "Keep projects, files and decisions close without keeping six tabs open.", tone: "blue" },
  { number: "02", name: "For the idea hour", copy: "Start with a sentence and leave with an organised, shareable first draft.", tone: "coral" },
  { number: "03", name: "For the in-between", copy: "Capture a voice note, a reference, or a last-minute task from wherever you are.", tone: "sage" },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function NovaMark({ className = "" }: { className?: string }) {
  return <img src="/manus-storage/nova-starburst_63824153.png" alt="" className={className} />;
}

function WorkspaceScene({ activeMode, onModeChange }: { activeMode: WorkspaceMode; onModeChange: (mode: WorkspaceMode) => void }) {
  const current = modeData[activeMode];
  return (
    <div className="workspace-shell">
      <div className="workspace-topline">
        <span>Nova Space</span>
        <span className="workspace-live"><i /> synced just now</span>
      </div>
      <div className="workspace-frame">
        <aside className="workspace-sidebar">
          <div className="workspace-logo"><NovaMark className="workspace-logo-mark" /><span>Nova</span></div>
          <nav aria-label="Workspace navigation">
            <button className="workspace-nav is-active"><Command size={14} /> Home</button>
            <button className="workspace-nav"><Folder size={14} /> Files</button>
            <button className="workspace-nav"><Zap size={14} /> Flows</button>
            <button className="workspace-nav"><Globe2 size={14} /> Spaces</button>
          </nav>
          <div className="sidebar-rule" />
          <button className="workspace-nav"><Search size={14} /> Search</button>
          <div className="profile-chip"><span>JM</span><p>Jamie M.<small>Personal space</small></p><ChevronDown size={13} /></div>
        </aside>
        <div className="workspace-main">
          <div className="workspace-main-head">
            <div><span className="crumb">Home / Today</span><h3>Good morning, Jamie</h3></div>
            <button aria-label="Add to workspace" className="mini-add"><Plus size={16} /></button>
          </div>
          <div className="workspace-columns">
            <div className="file-stack">
              <div className="file-stack-head"><span>Recent</span><button>View all</button></div>
              {["morning-pages.md", "release-notes.pdf", "shelf-studies.jpg", "voice-memo.m4a"].map((file, index) => (
                <div className="file-row" key={file}><span className={`file-icon f${index}`}><FileText size={13} /></span><span>{file}</span><small>{index === 0 ? "2 min" : index === 1 ? "Yesterday" : "Mon"}</small></div>
              ))}
              <div className="mini-collection"><span className="collection-asterisk">✦</span><div><b>Loose ends</b><small>6 things worth returning to</small></div><ArrowUpRight size={15} /></div>
            </div>
            <div className="today-stack">
              <div className="today-card">
                <div className="today-title"><span>{current.icon}</span><b>{activeMode} with Nova</b><button>···</button></div>
                <p className="prompt-line">{activeMode === "Organize" ? "Bring this week into some order" : activeMode === "Plan" ? "Help me decide what happens next" : activeMode === "Make" ? "Turn this seed into something real" : "Pull the right threads together"}</p>
                <div className="assistant-reply"><NovaMark className="reply-mark" /><p>{current.reply}</p></div>
                <div className="mode-answer"><Check size={13} /><span>{current.task}</span></div>
              </div>
              <div className="workspace-composer"><span>Ask Nova to help…</span><button aria-label="Send message"><ArrowUpRight size={15} /></button></div>
            </div>
          </div>
        </div>
      </div>
      <div className="mode-dock" role="tablist" aria-label="Workspace examples">
        {workspaceModes.map((mode) => <button key={mode} role="tab" aria-selected={activeMode === mode} className={activeMode === mode ? "is-selected" : ""} onClick={() => onModeChange(mode)}>{mode}</button>)}
      </div>
    </div>
  );
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<WorkspaceMode>("Organize");
  const [orbitIndex, setOrbitIndex] = useState(0);

  const changeOrbit = (direction: number) => setOrbitIndex((current) => (current + direction + orbitCards.length) % orbitCards.length);

  return (
    <main className="site-shell">
      <section className="hero-section" id="top">
        <div className="hero-prism" aria-hidden="true" />
        <header className="topbar">
          <a className="brand" href="#top" onClick={() => setMenuOpen(false)} aria-label="Nova home"><NovaMark className="brand-mark" /><span>Nova</span></a>
          <nav className="desktop-nav" aria-label="Primary navigation">
            {navigation.map((item) => <button key={item} onClick={() => scrollToSection(item === "Product" ? "workspace" : item === "Guides" ? "orbit" : item === "Resources" ? "faq" : "about")}>{item}{item !== "Guides" && <ChevronDown size={12} />}</button>)}
            <button onClick={() => scrollToSection("pricing")}>Pricing</button>
          </nav>
          <div className="topbar-actions"><button className="sign-in" onClick={() => scrollToSection("workspace")}>Log in</button><Button className="dark-pill small-pill" onClick={() => scrollToSection("workspace")}>Create your space</Button></div>
          <button className="menu-button" aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X /> : <Menu />}</button>
        </header>
        {menuOpen && <div className="mobile-menu">{[...navigation, "Pricing"].map((item) => <button key={item} onClick={() => { setMenuOpen(false); scrollToSection(item === "Product" ? "workspace" : item === "Guides" ? "orbit" : item === "Resources" ? "faq" : item === "Pricing" ? "pricing" : "about"); }}>{item}</button>)}<Button className="dark-pill" onClick={() => { setMenuOpen(false); scrollToSection("workspace"); }}>Create your space</Button></div>}
        <div className="hero-copy">
          <p className="eyebrow">A personal cloud computer</p>
          <h1>Make room for<br /><em>powerful work.</em></h1>
          <p className="hero-description">Nova keeps your files, plans, tools, and momentum in one thoughtful place—ready whenever you are.</p>
          <div className="hero-actions"><Button className="light-pill" onClick={() => scrollToSection("workspace")}>See your space <ArrowDown size={15} /></Button><Button className="dark-pill" onClick={() => scrollToSection("workspace")}>Create your space <ArrowUpRight size={15} /></Button></div>
          <p className="quiet-proof"><span><Check size={12} /></span> A clear start, no card required</p>
        </div>
        <div className="hero-workspace-preview" aria-hidden="true"><div className="preview-tab">Today</div><div className="preview-lines"><i /><i /><i /></div><div className="preview-orb one" /><div className="preview-orb two" /></div>
      </section>

      <section className="story-section workspace-story" id="workspace">
        <div className="story-visual visual-with-art">
          <img src="/manus-storage/nova-workspace-orbit_00dc6e95.jpg" alt="Abstract translucent surfaces in the Nova visual style" className="visual-art" />
          <WorkspaceScene activeMode={activeMode} onModeChange={setActiveMode} />
        </div>
        <div className="story-copy">
          <span className="section-index">01 — Your space</span>
          <p className="story-kicker">{modeData[activeMode].eyebrow}</p>
          <h2>{modeData[activeMode].title}</h2>
          <p>Nova brings the essentials of a real computer together with a patient assistant that can help you keep the shape of your day.</p>
          <button className="text-link" onClick={() => scrollToSection("orbit")}>Explore how Nova works <ArrowUpRight size={16} /></button>
        </div>
      </section>

      <section className="quote-band" id="about">
        <p>“Computing should feel less like a pile of software—and more like a place you can actually think.”</p>
        <span>— The Nova principle</span>
      </section>

      <section className="story-section reverse-story" id="orbit">
        <div className="story-copy left-copy">
          <span className="section-index">02 — A working orbit</span>
          <p className="story-kicker">Your tools, in conversation</p>
          <h2>Put every loose end in one small universe.</h2>
          <p>Notes, messages, projects and fleeting references can meet in the same intentional workspace. Start anywhere; Nova helps you find the next useful thread.</p>
          <div className="small-capabilities"><span><Zap size={15} /> Flows</span><span><Globe2 size={15} /> Publish</span><span><MessageCircle size={15} /> Anywhere</span></div>
        </div>
        <div className="orbit-stage">
          <div className="orbit-card-stack" aria-live="polite">
            {orbitCards.map((card, index) => <article className={`orbit-card tone-${card.tone} ${index === orbitIndex ? "is-front" : ""}`} style={{ "--depth": `${(index - orbitIndex + orbitCards.length) % orbitCards.length}` } as React.CSSProperties} key={card.number}>
              <span>{card.number}</span><div className="orbit-card-orb" /><h3>{card.name}</h3><p>{card.copy}</p><ArrowUpRight size={18} />
            </article>)}
          </div>
          <div className="orbit-controls"><button aria-label="Previous idea" onClick={() => changeOrbit(-1)}><ArrowLeft size={18} /></button><span>{String(orbitIndex + 1).padStart(2, "0")} / 03</span><button aria-label="Next idea" onClick={() => changeOrbit(1)}><ArrowRight size={18} /></button></div>
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-image-wrap"><img src="/manus-storage/nova-community-studio_abe0bb17.jpg" alt="Editorial creative studio composition" className="studio-image" /><div className="image-label"><NovaMark className="image-label-mark" /><span>Build from a quieter place</span></div></div>
        <div className="studio-copy"><span className="section-index">03 — Make it yours</span><h2>A place for the parts of life that don’t fit in a spreadsheet.</h2><p>Host a personal corner of the web. Shape a research library. Keep a little studio for the project you keep returning to. Nova makes the container; you make it meaningful.</p><button className="text-link" onClick={() => scrollToSection("pricing")}>Open a new space <ArrowUpRight size={16} /></button></div>
      </section>

      <section className="capability-ribbon" aria-label="Nova capabilities"><span>FILES</span><i /> <span>PLANS</span><i /> <span>FLOWS</span><i /> <span>SPACES</span><i /> <span>MESSAGES</span><i /> <span>BUILT TO LAST</span></section>

      <section className="faq-section" id="faq">
        <div className="faq-intro"><span className="section-index">04 — Good to know</span><h2>Questions, without the runaround.</h2><p>Nova is designed to be understandable before it asks you to trust it.</p></div>
        <Accordion type="single" collapsible className="faq-list">
          <AccordionItem value="item-1"><AccordionTrigger>What exactly is a personal cloud computer?</AccordionTrigger><AccordionContent>It is a private workspace that gives your projects a durable home in the cloud. Nova gathers the files, tools, and assistance you need so that useful work does not vanish between applications.</AccordionContent></AccordionItem>
          <AccordionItem value="item-2"><AccordionTrigger>Can I bring the tools I already use?</AccordionTrigger><AccordionContent>Yes. Nova is designed to sit alongside the systems you already rely on, helping you make their information easier to find and act on from one space.</AccordionContent></AccordionItem>
          <AccordionItem value="item-3"><AccordionTrigger>Do I need technical experience to use it?</AccordionTrigger><AccordionContent>No. The product language is intentionally direct: describe the outcome you need, review what Nova proposes, and keep control over what gets shared or changed.</AccordionContent></AccordionItem>
          <AccordionItem value="item-4"><AccordionTrigger>Can I begin with a small personal project?</AccordionTrigger><AccordionContent>That is a great place to begin. A notebook, an idea archive, or a simple project hub can grow into a more capable working space whenever you are ready.</AccordionContent></AccordionItem>
        </Accordion>
      </section>

      <section className="closing-section" id="pricing">
        <div className="closing-prism" aria-hidden="true" />
        <NovaMark className="closing-mark" />
        <p className="eyebrow">A space that stays with you</p>
        <h2>Start where you are.<br />Keep going further.</h2>
        <p>Bring the current project, the rough note, or the ambitious idea. Nova will be ready.</p>
        <Button className="dark-pill closing-cta" onClick={() => scrollToSection("top")}>Create your space <ArrowUpRight size={16} /></Button>
      </section>

      <footer className="site-footer">
        <div className="footer-brand"><a className="brand" href="#top"><NovaMark className="brand-mark" /><span>Nova</span></a><p>A quiet personal cloud for people building a richer working life.</p></div>
        <div className="footer-links"><div><b>Explore</b><a href="#workspace">Your space</a><a href="#orbit">Flows</a><a href="#about">Our principle</a></div><div><b>Company</b><a href="#faq">Questions</a><a href="#pricing">Plans</a><a href="#top">Journal</a></div><div><b>Follow</b><a href="#top">Notes</a><a href="#top">Field guide</a><a href="#top">Contact</a></div></div>
        <div className="footer-bottom"><span>© 2026 Nova Computer</span><span>Made for more thoughtful systems</span></div>
      </footer>
    </main>
  );
}
