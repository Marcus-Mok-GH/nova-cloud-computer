/**
 * Nova style reminder: Iridescent Editorial Utility — a serene eggshell surface,
 * oversized DM Serif Display, compact Manrope UI, tactile dark pill controls,
 * and original cloud-workspace scenes with sea-glass highlights.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
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
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
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
import { Button } from "@/components/ui/button";

const navigation = ["Product", "Guides", "Resources", "About"];
const workspaceModes = ["Organize", "Plan", "Make", "Connect"] as const;
type WorkspaceMode = (typeof workspaceModes)[number];

const modeData: Record<
  WorkspaceMode,
  { eyebrow: string; title: string; reply: string; task: string; icon: React.ReactNode }
> = {
  Organize: {
    eyebrow: "A personal cloud with a memory",
    title: "Everything, finally has a home.",
    reply: "Sorted 12 loose files into Projects, Notes, Images and Archive. Your workspace rules and next actions are waiting below.",
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
    eyebrow: "A cloud shaped around you",
    title: "Keep your choices close.",
    reply: "Your projects, preferences, and model choice stay together—so your workspace starts from your point of view.",
    task: "Prepare the handoff for tomorrow",
    icon: <MessageCircle size={15} />,
  },
};

const orbitCards = [
  { number: "01", name: "For the work day", copy: "Keep projects, next actions, and the rules that shape your work in one durable place.", tone: "blue" },
  { number: "02", name: "For the idea hour", copy: "Choose the model preference that feels right for the work, then keep the context close.", tone: "coral" },
  { number: "03", name: "For the in-between", copy: "Return to the same personal cloud from wherever you are, without rebuilding your system.", tone: "sage" },
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
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<WorkspaceMode>("Organize");
  const [orbitIndex, setOrbitIndex] = useState(0);

  const changeOrbit = (direction: number) => setOrbitIndex((current) => (current + direction + orbitCards.length) % orbitCards.length);
  const enterNova = () => {
    if (isAuthenticated) {
      setLocation("/app");
      return;
    }
    startLogin();
  };

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
          <div className="topbar-actions"><button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}</button><button className="sign-in" onClick={enterNova}>{isAuthenticated ? "Open space" : "Log in"}</button><Button className="dark-pill small-pill" onClick={enterNova}>Create your space</Button></div>
          <button className="theme-toggle mobile-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}</button>
          <button className="menu-button" aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X /> : <Menu />}</button>
        </header>
        {menuOpen && <div className="mobile-menu">{[...navigation, "Pricing"].map((item) => <button key={item} onClick={() => { setMenuOpen(false); scrollToSection(item === "Product" ? "workspace" : item === "Guides" ? "orbit" : item === "Resources" ? "faq" : item === "Pricing" ? "pricing" : "about"); }}>{item}</button>)}<Button className="dark-pill" onClick={() => { setMenuOpen(false); enterNova(); }}>Create your space</Button></div>}
        <div className="hero-copy">
          <p className="eyebrow">Your personal cloud</p>
          <h1>Work that<br /><em>stays with you.</em></h1>
          <p className="hero-description">Nova gives your projects, preferences, and model choices a durable home—ready whenever you return.</p>
          <div className="hero-actions"><Button className="light-pill" onClick={() => scrollToSection("workspace")}>See your space <ArrowDown size={15} /></Button><Button className="dark-pill" onClick={enterNova}>Create your space <ArrowUpRight size={15} /></Button></div>
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
          <p>Nova starts with a durable workspace: your projects, next actions, standing rules, and model preference remain together instead of disappearing between apps.</p>
          <button className="text-link" onClick={() => scrollToSection("orbit")}>Explore how Nova works <ArrowUpRight size={16} /></button>
        </div>
      </section>

      <section className="quote-band" id="about">
        <p>“A personal cloud should remember the way you like to work—not make you begin from zero each time.”</p>
        <span>— The Nova principle</span>
      </section>

      <section className="story-section reverse-story" id="orbit">
        <div className="story-copy left-copy">
          <span className="section-index">02 — A working orbit</span>
          <p className="story-kicker">A point of view that persists</p>
          <h2>Give your work a place with a memory.</h2>
          <p>Projects and task lists are only the beginning. Nova keeps the practical preferences behind them—how you want help, which model you prefer, and which boundaries matter.</p>
          <div className="small-capabilities"><span><Zap size={15} /> Projects</span><span><Globe2 size={15} /> Rules</span><span><MessageCircle size={15} /> Model choice</span></div>
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
        <div className="studio-copy"><span className="section-index">03 — Make it yours</span><h2>A place for the parts of life that don’t fit in a spreadsheet.</h2><p>Shape a research library, a working brief, or a project that grows over time. Nova keeps the container, your standing rules, and your model preference in the same private space.</p><button className="text-link" onClick={enterNova}>Open your personal cloud <ArrowUpRight size={16} /></button></div>
      </section>

      <section className="capability-ribbon" aria-label="Nova capabilities"><span>PROJECTS</span><i /> <span>RULES</span><i /> <span>MODEL CHOICE</span><i /> <span>PRIVATE SPACE</span><i /> <span>CONTEXT</span><i /> <span>BUILT TO LAST</span></section>

      <section className="faq-section" id="faq">
        <div className="faq-intro"><span className="section-index">04 — Good to know</span><h2>Questions, without the runaround.</h2><p>Nova is designed to be understandable before it asks you to trust it.</p></div>
        <Accordion type="single" collapsible className="faq-list">
          <AccordionItem value="item-1"><AccordionTrigger>What exactly is a personal cloud?</AccordionTrigger><AccordionContent>It is a private workspace that gives your projects and working preferences a durable home. Nova begins by keeping those things together, so useful context does not vanish between applications.</AccordionContent></AccordionItem>
          <AccordionItem value="item-2"><AccordionTrigger>Which AI model can I choose?</AccordionTrigger><AccordionContent>You can save a workspace preference for Anthropic, OpenAI, or Google Gemini, and add any number of custom OpenAI-compatible or Anthropic-compatible endpoints. Model preferences are stored per workspace.</AccordionContent></AccordionItem>
          <AccordionItem value="item-3"><AccordionTrigger>How are custom API keys handled?</AccordionTrigger><AccordionContent>Nova encrypts a custom endpoint key before storing it and never displays the key again after submission. The saved model record only confirms that a key is present.</AccordionContent></AccordionItem>
          <AccordionItem value="item-4"><AccordionTrigger>Can I begin with a small personal project?</AccordionTrigger><AccordionContent>That is a great place to begin. A notebook, an idea archive, or a small project hub can grow into a more capable personal workspace whenever you are ready.</AccordionContent></AccordionItem>
        </Accordion>
      </section>

      <section className="closing-section" id="pricing">
        <div className="closing-prism" aria-hidden="true" />
        <NovaMark className="closing-mark" />
        <p className="eyebrow">A space that remembers you</p>
        <h2>Start where you are.<br />Keep your context.</h2>
        <p>Bring the current project, the rough note, or the ambitious idea. Nova keeps the shape of the work with you.</p>
        <Button className="dark-pill closing-cta" onClick={enterNova}>Create your space <ArrowUpRight size={16} /></Button>
      </section>

      <footer className="site-footer">
        <div className="footer-brand"><a className="brand" href="#top"><NovaMark className="brand-mark" /><span>Nova</span></a><p>A quiet personal cloud for people building a richer working life.</p></div>
        <div className="footer-links"><div><b>Explore</b><a href="#workspace">Your space</a><a href="#orbit">Flows</a><a href="#about">Our principle</a></div><div><b>Company</b><a href="#faq">Questions</a><a href="#pricing">Plans</a><a href="#top">Journal</a></div><div><b>Follow</b><a href="#top">Notes</a><a href="#top">Field guide</a><a href="#top">Contact</a></div></div>
        <div className="footer-bottom"><span>© 2026 Nova Computer</span><span>Made for more thoughtful systems</span></div>
      </footer>
    </main>
  );
}
