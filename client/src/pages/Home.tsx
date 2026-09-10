import { useState, type ComponentType } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Cpu,
  FileText,
  Menu,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  Rocket,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
  X,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import NovaMark from "@/components/NovaMark";

type Icon = ComponentType<{ className?: string }>;

type Metric = {
  label: string;
  value: string;
  change: string;
  detail: string;
  icon: Icon;
  tone: string;
  points: number[];
};

const metrics: Metric[] = [
  { label: "Tasks completed", value: "1,284", change: "+12.4%", detail: "vs. previous period", icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-500/10", points: [24, 30, 26, 38, 34, 44, 52, 48, 61, 68] },
  { label: "Agent utilization", value: "78.6%", change: "+8.2%", detail: "healthy operating range", icon: Cpu, tone: "text-blue-600 bg-blue-500/10", points: [42, 38, 46, 43, 56, 54, 63, 59, 72, 78] },
  { label: "Workspace uptime", value: "99.98%", change: "+0.06%", detail: "last 30 days", icon: Server, tone: "text-violet-600 bg-violet-500/10", points: [72, 74, 73, 75, 74, 77, 76, 78, 79, 80] },
  { label: "Active sessions", value: "48", change: "+5.1%", detail: "right now", icon: Activity, tone: "text-amber-600 bg-amber-500/10", points: [34, 38, 31, 42, 40, 45, 43, 50, 47, 48] },
];

const activity = [
  { icon: TerminalSquare, title: "Agent VM completed a task", detail: "Generated a deployment summary", time: "2 min ago", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  { icon: FileText, title: "12 files synchronized", detail: "Workspace /projects/nova", time: "18 min ago", tone: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  { icon: MessageSquareText, title: "New conversation started", detail: "Product analytics review", time: "42 min ago", tone: "bg-violet-500/10 text-violet-700 dark:text-violet-400" },
  { icon: Rocket, title: "Deployment health check passed", detail: "Production · 184ms response", time: "1 hr ago", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
];

const agentRows = [
  { name: "Nova Core", type: "Reasoning agent", runs: "482", success: "98.4%", latency: "1.8s", status: "Online" },
  { name: "Workspace VM", type: "Execution agent", runs: "318", success: "96.8%", latency: "4.2s", status: "Online" },
  { name: "Deploy Watcher", type: "Monitoring agent", runs: "176", success: "99.7%", latency: "0.4s", status: "Online" },
];

function Sparkline({ points, tone }: { points: number[]; tone: string }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(max - min, 1);
  const coordinates = points.map((point, index) => {
    const x = (index / (points.length - 1)) * 100;
    const y = 28 - ((point - min) / range) * 22;
    return x + "," + y;
  }).join(" ");

  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={"h-10 w-28 " + tone} aria-hidden="true">
      <polyline points={coordinates} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  const Icon = metric.icon;
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_35px_rgba(15,23,42,0.04)] dark:border-white/8 dark:bg-white/[0.045] dark:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div className={"grid size-10 place-items-center rounded-xl " + metric.tone}>
          <Icon className="size-[18px]" />
        </div>
        <Sparkline points={metric.points} tone={metric.tone.split(" ")[0]} />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{metric.label}</p>
      <div className="mt-2 flex items-end gap-2">
        <p className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{metric.value}</p>
        <span className="mb-1 text-xs font-bold text-emerald-600">{metric.change}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{metric.detail}</p>
    </article>
  );
}

function Home() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [range, setRange] = useState("30d");

  const enterNova = () => {
    setMenuOpen(false);
    setLocation(isAuthenticated ? "/app" : "/sign-in");
  };

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950 dark:bg-[#090c12] dark:text-white">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-[#f6f8fb]/90 backdrop-blur-xl dark:border-white/8 dark:bg-[#090c12]/90">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
          <a href="#overview" className="flex items-center gap-2.5" aria-label="Nova overview">
            <NovaMark size={26} />
            <span className="text-lg font-extrabold tracking-tight">Nova</span>
            <span className="hidden rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:inline-flex dark:border-white/10 dark:bg-white/5 dark:text-slate-400">Control center</span>
          </a>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Analytics navigation">
            <a href="#overview" className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white dark:bg-white dark:text-slate-950">Overview</a>
            <a href="#activity" className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/8 dark:hover:text-white">Activity</a>
            <a href="#agents" className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/8 dark:hover:text-white">Agents</a>
          </nav>

          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleTheme} className="grid size-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:text-white" aria-label={theme === "light" ? "Use dark theme" : "Use light theme"}>
              {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </button>
            <button type="button" onClick={enterNova} className="hidden rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800 sm:inline-flex dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">{isAuthenticated ? "Open workspace" : "Sign in"}</button>
            <button type="button" onClick={() => setMenuOpen(open => !open)} className="grid size-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 md:hidden dark:border-white/10 dark:bg-white/5 dark:text-slate-400" aria-label={menuOpen ? "Close navigation" : "Open navigation"}>
              {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-200/80 bg-white px-5 py-3 md:hidden dark:border-white/8 dark:bg-[#0d1118]">
            <div className="flex flex-col gap-1">
              <a href="#overview" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Overview</a>
              <a href="#activity" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Activity</a>
              <a href="#agents" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Agents</a>
              <button type="button" onClick={enterNova} className="mt-2 rounded-lg bg-slate-950 px-3 py-2.5 text-left text-sm font-bold text-white dark:bg-white dark:text-slate-950">{isAuthenticated ? "Open workspace" : "Sign in"}</button>
            </div>
          </div>
        )}
      </header>

      <div id="overview" className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">Workspace analytics</p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] text-slate-950 sm:text-4xl dark:text-white">System overview</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">A live readout of your cloud computer, agent throughput, and workspace activity.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-white/5">
              {[{ label: "7d", value: "7d" }, { label: "30d", value: "30d" }, { label: "90d", value: "90d" }].map(item => (
                <button key={item.value} type="button" onClick={() => setRange(item.value)} className={"rounded-lg px-3 py-1.5 text-xs font-bold transition " + (range === item.value ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950" : "text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white")}>{item.label}</button>
              ))}
            </div>
            <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-950 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-white"><span>Export report</span><ArrowUpRight className="size-3.5" /></button>
          </div>
        </div>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
          {metrics.map(metric => <MetricCard key={metric.label} metric={metric} />)}
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
          <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_35px_rgba(15,23,42,0.04)] sm:p-6 dark:border-white/8 dark:bg-white/[0.045] dark:shadow-none">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <div className="flex items-center gap-2"><BarChart3 className="size-4 text-blue-600 dark:text-blue-400" /><h2 className="text-sm font-bold">Task volume</h2></div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Completed agent tasks over the selected period</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><span className="size-2 rounded-full bg-blue-500" /> Completed <MoreHorizontal className="ml-2 size-4" /></div>
            </div>
            <div className="relative mt-7 h-64 overflow-hidden rounded-xl bg-slate-50 px-2 pt-3 dark:bg-white/[0.025]">
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between px-3 py-4"><span className="border-t border-dashed border-slate-200 dark:border-white/8" /><span className="border-t border-dashed border-slate-200 dark:border-white/8" /><span className="border-t border-dashed border-slate-200 dark:border-white/8" /><span className="border-t border-dashed border-slate-200 dark:border-white/8" /></div>
              <svg viewBox="0 0 720 230" preserveAspectRatio="none" className="relative h-full w-full" role="img" aria-label="Task volume trend chart">
                <defs><linearGradient id="task-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.26" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0" /></linearGradient></defs>
                <path d="M0 190 C38 178 45 184 72 164 S112 152 142 161 S184 128 214 143 S250 120 280 132 S320 103 350 119 S390 80 420 98 S460 88 490 101 S528 60 558 82 S600 50 628 63 S676 34 720 42 L720 230 L0 230 Z" fill="url(#task-fill)" />
                <path d="M0 190 C38 178 45 184 72 164 S112 152 142 161 S184 128 214 143 S250 120 280 132 S320 103 350 119 S390 80 420 98 S460 88 490 101 S528 60 558 82 S600 50 628 63 S676 34 720 42" fill="none" stroke="#3b82f6" strokeLinecap="round" strokeWidth="3" />
                <circle cx="628" cy="63" r="5" fill="#fff" stroke="#3b82f6" strokeWidth="3" />
              </svg>
              <div className="absolute inset-x-3 bottom-2 flex justify-between text-[10px] font-semibold text-slate-400"><span>01</span><span>05</span><span>10</span><span>15</span><span>20</span><span>25</span><span>30</span></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs"><span className="text-slate-500 dark:text-slate-400">Peak activity <strong className="text-slate-900 dark:text-white">Tuesday, 14:00</strong></span><span className="font-bold text-emerald-600">+12.4% vs. last {range}</span></div>
          </article>

          <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_35px_rgba(15,23,42,0.04)] sm:p-6 dark:border-white/8 dark:bg-white/[0.045] dark:shadow-none">
            <div className="flex items-start justify-between"><div><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-600" /><h2 className="text-sm font-bold">System health</h2></div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">All core services operational</p></div><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-500" /> Healthy</span></div>
            <div className="mt-7 flex items-center gap-5"><div className="grid size-32 shrink-0 place-items-center rounded-full" style={{ background: "conic-gradient(#10b981 0deg 356deg, #e2e8f0 356deg 360deg)" }}><div className="grid size-24 place-items-center rounded-full bg-white dark:bg-[#11161f]"><div className="text-center"><p className="text-2xl font-extrabold tracking-tight">99.9%</p><p className="text-[10px] font-semibold text-slate-500">availability</p></div></div></div><div className="min-w-0 flex-1 space-y-4"><div><div className="mb-1.5 flex justify-between text-[11px] font-semibold"><span className="text-slate-500 dark:text-slate-400">Agent gateway</span><span>100%</span></div><div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/10"><div className="h-full w-full rounded-full bg-emerald-500" /></div></div><div><div className="mb-1.5 flex justify-between text-[11px] font-semibold"><span className="text-slate-500 dark:text-slate-400">Workspace sync</span><span>99.8%</span></div><div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/10"><div className="h-full w-[99.8%] rounded-full bg-blue-500" /></div></div><div><div className="mb-1.5 flex justify-between text-[11px] font-semibold"><span className="text-slate-500 dark:text-slate-400">Deployments</span><span>99.9%</span></div><div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/10"><div className="h-full w-[99.9%] rounded-full bg-violet-500" /></div></div></div></div>
            <div className="mt-7 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 dark:border-white/8"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Last incident</p><p className="mt-1 text-xs font-bold">None in 30 days</p></div><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Next check</p><p className="mt-1 text-xs font-bold">In 42 seconds</p></div></div>
          </article>
        </section>

        <section id="activity" className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.35fr)]">
          <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_35px_rgba(15,23,42,0.04)] sm:p-6 dark:border-white/8 dark:bg-white/[0.045] dark:shadow-none">
            <div className="flex items-start justify-between"><div><h2 className="text-sm font-bold">Recent activity</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">The latest events across your workspace</p></div><button type="button" onClick={() => setLocation(isAuthenticated ? "/app" : "/sign-in")} className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400">View all</button></div>
            <div className="mt-5 divide-y divide-slate-100 dark:divide-white/8">{activity.map(item => { const Icon = item.icon; return <div key={item.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"><span className={"mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg " + item.tone"><Icon className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{item.title}</p><p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{item.detail}</p></div><span className="shrink-0 text-[10px] font-semibold text-slate-400">{item.time}</span></div>; })}</div>
          </article>

          <article id="agents" className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.04)] dark:border-white/8 dark:bg-white/[0.045] dark:shadow-none">
            <div className="flex items-start justify-between p-5 sm:p-6"><div><h2 className="text-sm font-bold">Agent performance</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Reliability across your active agents</p></div><button type="button" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-white/8 dark:hover:text-white" aria-label="Agent performance options"><MoreHorizontal className="size-4" /></button></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left"><thead><tr className="border-y border-slate-100 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:border-white/8"><th className="px-5 py-3 sm:px-6">Agent</th><th className="px-3 py-3">Runs</th><th className="px-3 py-3">Success</th><th className="px-3 py-3">Latency</th><th className="px-5 py-3 sm:px-6">Status</th></tr></thead><tbody>{agentRows.map(row => <tr key={row.name} className="border-b border-slate-100 last:border-0 dark:border-white/8"><td className="px-5 py-3.5 sm:px-6"><div className="flex items-center gap-2.5"><span className="grid size-7 place-items-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400"><Cpu className="size-3.5" /></span><span><span className="block text-xs font-bold">{row.name}</span><span className="block text-[10px] text-slate-400">{row.type}</span></span></div></td><td className="px-3 py-3.5 text-xs font-semibold text-slate-600 dark:text-slate-300">{row.runs}</td><td className="px-3 py-3.5 text-xs font-bold text-emerald-600">{row.success}</td><td className="px-3 py-3.5 text-xs font-semibold text-slate-600 dark:text-slate-300">{row.latency}</td><td className="px-5 py-3.5 sm:px-6"><span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-600"><span className="size-1.5 rounded-full bg-emerald-500" />{row.status}</span></td></tr>)}</tbody></table></div>
          </article>
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl bg-slate-950 p-6 text-white sm:p-8 dark:bg-white/[0.08]">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center"><div><div className="flex items-center gap-2 text-blue-300"><Sparkles className="size-4" /><span className="text-[11px] font-bold uppercase tracking-[0.16em]">Next step</span></div><h2 className="mt-3 text-2xl font-extrabold tracking-tight">Turn the signal into action.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">Open your workspace to inspect files, continue a conversation, or give Nova a task.</p></div><button type="button" onClick={enterNova} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-blue-50">{isAuthenticated ? "Open workspace" : "Get started"}<ArrowUpRight className="size-4" /></button></div>
        </section>
      </div>
    </main>
  );
}

export default Home;
