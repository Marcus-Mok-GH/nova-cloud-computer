import React from "react";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, MinusCircle, RefreshCw, XCircle, type LucideIcon } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import type { ServiceHealth, ServiceState, ServiceStatusReport } from "@shared/serviceStatus";

export type PageProbe = { path: string; name: string; description: string; ok: boolean; latencyMs: number | null; checked: boolean };

/** Every route the app can render, probed live by the status page. */
export const APP_PAGES: Array<{ path: string; name: string; description: string }> = [
  { path: "/", name: "Home", description: "Landing page" },
  { path: "/sign-in", name: "Sign in", description: "Email sign-in flow" },
  { path: "/app", name: "Overview", description: "Workspace dashboard" },
  { path: "/app/files", name: "Files", description: "File explorer" },
  { path: "/app/chats", name: "Chats", description: "Conversation list" },
  { path: "/app/deployments", name: "Deployments", description: "Deployed apps" },
  { path: "/app/terminal", name: "Terminal", description: "Live sandbox shell" },
  { path: "/app/profile", name: "Profile", description: "Account profile" },
  { path: "/app/settings", name: "Settings", description: "Workspace settings" },
  { path: "/app/status", name: "Status", description: "This page" },
  { path: "/app/more", name: "More", description: "Full navigation" },
];

const SERVICE_META: Record<ServiceState, { label: string; icon: LucideIcon; classes: string }> = {
  operational: { label: "Operational", icon: CheckCircle2, classes: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  degraded: { label: "Degraded", icon: MinusCircle, classes: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  offline: { label: "Offline", icon: XCircle, classes: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300" },
  unconfigured: { label: "Not configured", icon: CircleDashed, classes: "bg-muted text-muted-foreground" },
};

export function StateChip({ state }: { state: ServiceState }) {
  const meta = SERVICE_META[state];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${meta.classes}`}>
      <meta.icon className="size-3.5" />
      {meta.label}
    </span>
  );
}

function ServiceRow({ service }: { service: ServiceHealth }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{service.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{service.detail}{service.latencyMs !== null ? ` · ${service.latencyMs}ms` : ""}</p>
      </div>
      <StateChip state={service.state} />
    </li>
  );
}

function PageRow({ probe, onOpen }: { probe: PageProbe; onOpen: (path: string) => void }) {
  return (
    <li>
      <button onClick={() => onOpen(probe.path)} className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-4 text-left transition hover:bg-accent/40">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{probe.name}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{probe.path}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!probe.checked ? (
            <span className="text-xs text-muted-foreground">checking…</span>
          ) : probe.ok ? (
            <StateChip state="operational" />
          ) : (
            <StateChip state="offline" />
          )}
          {probe.checked && probe.latencyMs !== null && <span className="text-xs text-muted-foreground">{probe.latencyMs}ms</span>}
        </div>
      </button>
    </li>
  );
}

export default function Status() {
  const [report, setReport] = useState<ServiceStatusReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [pages, setPages] = useState<PageProbe[]>(APP_PAGES.map(page => ({ ...page, ok: false, latencyMs: null, checked: false })));
  const [refreshing, setRefreshing] = useState(false);

  const runChecks = useCallback(async () => {
    setRefreshing(true);
    setReportError(null);

    try {
      const response = await fetch("/api/status", { credentials: "include" });
      if (!response.ok) throw new Error(`The status endpoint answered ${response.status}.`);
      setReport((await response.json()) as ServiceStatusReport);
    } catch (error) {
      setReport(null);
      setReportError(error instanceof Error ? error.message : "Could not reach the status endpoint.");
    }

    setPages(APP_PAGES.map(page => ({ ...page, ok: false, latencyMs: null, checked: false })));
    await Promise.all(
      APP_PAGES.map(async (page, index) => {
        const startedAt = performance.now();
        let ok = false;
        let latencyMs: number | null = null;
        try {
          const response = await fetch(page.path, { credentials: "include" });
          latencyMs = Math.round(performance.now() - startedAt);
          ok = response.ok && (response.headers.get("content-type") ?? "").includes("text/html");
        } catch {
          latencyMs = Math.round(performance.now() - startedAt);
          ok = false;
        }
        setPages(previous => previous.map((probe, probeIndex) => (probeIndex === index ? { ...probe, ok, latencyMs, checked: true } : probe)));
      })
    );
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void runChecks();
    const interval = setInterval(() => { void runChecks(); }, 60_000);
    return () => clearInterval(interval);
  }, [runChecks]);

  const serviceIssues = report ? report.services.filter(service => service.state === "offline" || service.state === "degraded") : [];
  const downPages = pages.filter(page => page.checked && !page.ok);
  const allGood = report !== null && serviceIssues.length === 0 && downPages.length === 0;

  return (
    <DashboardLayout>
      <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <RefreshCw className={`size-5 ${refreshing ? "animate-spin" : ""}`} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Status</h1>
            <p className="mt-1 text-sm text-muted-foreground">Live health of every page and service in this deployment. Refreshes automatically every minute.</p>
          </div>
        </div>

        <div className={`mt-8 flex items-start gap-3 rounded-2xl border p-5 ${allGood ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/[0.06]" : downPages.length + serviceIssues.length > 0 ? "border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/[0.06]" : "border-border bg-card dark:border-white/10 dark:bg-card"}`}>
          {reportError ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" /> : allGood ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground" />}
          <div className="min-w-0">
            {reportError ? (
              <>
                <p className="text-sm font-bold text-red-700 dark:text-red-300">Status check failed</p>
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{reportError}</p>
              </>
            ) : !report ? (
              <>
                <p className="text-sm font-bold">Checking services…</p>
                <p className="mt-1 text-sm text-muted-foreground">Probing the API, database, gateway, and every page.</p>
              </>
            ) : allGood ? (
              <>
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">All systems operational</p>
                <p className="mt-1 text-sm text-emerald-700/80 dark:text-emerald-300/80">{report.services.length} services and {pages.length} pages answered.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-red-700 dark:text-red-300">{serviceIssues.length + downPages.length} issue{serviceIssues.length + downPages.length === 1 ? "" : "s"} need{serviceIssues.length + downPages.length === 1 ? "s" : ""} attention</p>
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {serviceIssues.length > 0 && `${serviceIssues.length} service${serviceIssues.length === 1 ? "" : "s"} down or degraded`}
                  {serviceIssues.length > 0 && downPages.length > 0 && " · "}
                  {downPages.length > 0 && `${downPages.length} page${downPages.length === 1 ? "" : "s"} failing to load`}
                </p>
              </>
            )}
            {report && <p className="mt-2 text-xs text-muted-foreground">Last checked {new Date(report.checkedAt).toLocaleTimeString()}</p>}
          </div>
          <button onClick={() => { void runChecks(); }} disabled={refreshing} className="pill-btn ml-auto shrink-0 self-center px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </button>
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card dark:border-white/10 dark:bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4 dark:border-white/5">
            <h2 className="text-sm font-bold">Services</h2>
            {report && <span className="text-xs text-muted-foreground">{report.services.filter(service => service.state === "operational").length}/{report.services.length} operational · server uptime {Math.floor(report.serverUptimeSeconds / 60)}m</span>}
          </div>
          {report ? (
            <ul className="divide-y divide-border dark:divide-white/5">
              {report.services.map(service => <ServiceRow key={service.id} service={service} />)}
            </ul>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">Collecting service health…</p>
          )}
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card dark:border-white/10 dark:bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4 dark:border-white/5">
            <h2 className="text-sm font-bold">Pages</h2>
            <span className="text-xs text-muted-foreground">{pages.filter(page => page.checked && page.ok).length}/{pages.length} responding</span>
          </div>
          <ul className="divide-y divide-border dark:divide-white/5">
            {pages.map(probe => (
              <PageRow key={probe.path} probe={probe} onOpen={path => { window.location.assign(path); }} />
            ))}
          </ul>
        </div>
      </section>
    </DashboardLayout>
  );
}
