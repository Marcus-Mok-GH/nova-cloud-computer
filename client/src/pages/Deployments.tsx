import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Check, ChevronRight, Copy, ExternalLink, Globe, Loader2, Rocket, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

type DeploymentRow = {
  id: number;
  siteId: string;
  siteName: string | null;
  siteUrl: string;
  deploymentKey: string | null;
  description: string | null;
  status: "deploying" | "live" | "failed" | "deleted";
  fileCount: number;
  error: string | null;
  createdAt: Date | string;
};

/** Compact "Sep 16, 2026, 12:00 PM" stamp for the history rows. */
function formatStamp(value: Date | string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The small status pill shared by the live-site header and every history row. */
function StatusChip({ status }: { status: DeploymentRow["status"] }) {
  if (status === "deploying") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        <Loader2 size={12} className="animate-spin" /> Deploying
      </span>
    );
  }
  if (status !== "live") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-700 dark:text-red-300">
        <AlertTriangle size={12} /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
      <Check size={12} /> Live
    </span>
  );
}

/** The Deployments page: the live site, its deploy history, and taking hosted deployments offline. */
export default function Deployments() {
  const utils = trpc.useUtils();
  const status = trpc.deployments.status.useQuery(undefined, { retry: false, refetchInterval: 30_000 });

  const configured = Boolean(status.data?.configured);
  // Deleted deployments are not shown at all: a taken-down site is never
  // advertised as live and its runs stay out of the history list.
  const latestRow = (status.data?.latest ?? null) as unknown as DeploymentRow | null;
  const latest = latestRow && latestRow.status !== "deleted" ? latestRow : null;
  const history = ((status.data?.history ?? []) as unknown as DeploymentRow[]).filter(row => row.status !== "deleted");
  const live = latest?.status === "live";
  const deploying = latest?.status === "deploying";

  const removeDeployment = trpc.deployments.delete.useMutation({
    onSuccess: () => {
      toast.success("Deployment deleted.");
      void utils.deployments.status.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  /** Takes one hosted deployment offline, after the user confirms its URL will go away. */
  const deleteDeployment = (row: DeploymentRow) => {
    const key = row.deploymentKey ?? row.siteId;
    if (!window.confirm(`Delete deployment ${key}? Its website and URL go offline permanently.`)) return;
    removeDeployment.mutate({ deployment: key });
  };

  const copyUrl = async () => {
    if (!latest?.siteUrl || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(latest.siteUrl);
      toast.success("Website URL copied.");
    } catch {
      toast.error("Could not copy the URL.");
    }
  };

  return (
    <DashboardLayout>
      <section className="relative mx-auto max-w-3xl px-4 py-6 md:px-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-primary/[0.045] to-transparent dark:from-primary/[0.07]" />
        <p className="rise-in text-[11px] font-bold uppercase tracking-[0.14em] text-primary dark:text-primary">
          Release room
        </p>
        <h1 className="rise-in-delay-1 mt-2 text-3xl font-extrabold tracking-tight">
          Deployments
        </h1>
        <p className="rise-in-delay-1 mt-2 max-w-xl text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
          Your live website, published by Nova on Netlify's free hosting - always on, with SSL.
        </p>

        {status.isLoading ? (
          <div className="rise-in-delay-2 mt-8 flex min-h-40 items-center justify-center rounded-2xl border bg-card">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : status.isError ? (
          <div className="rise-in-delay-2 mt-8 rounded-2xl border bg-card p-8 text-center">
            <AlertTriangle className="mx-auto text-primary" size={24} />
            <h2 className="mt-4 text-xl font-bold">Deployments could not load.</h2>
            {status.error?.message && (
              <p className="mx-auto mt-2 max-w-md break-words text-xs leading-5 text-muted-foreground">
                {status.error.message}
              </p>
            )}
            <Button className="mt-5" variant="outline" onClick={() => status.refetch()}>Try again</Button>
          </div>
        ) : (
          <>
            <article className="rise-in-delay-2 mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_4px_14px_rgba(10,10,10,0.05)] dark:border-white/10 dark:bg-card">
              <div className="flex min-w-0 items-start gap-3 p-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
                  <Globe className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold">Your live website</h2>
                    {live && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <span className="size-1.5 rounded-full bg-emerald-500" /> Live 24/7
                      </span>
                    )}
                    {latest && (deploying || latest.status === "failed") && <StatusChip status={latest.status} />}
                  </div>
                  {latest ? (
                    <a
                      href={latest.siteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 block truncate text-sm font-semibold underline-offset-4 transition hover:text-primary hover:underline"
                    >
                      {latest.siteUrl}
                    </a>
                  ) : (
                    <p className="mt-1.5 text-sm text-muted-foreground">Not deployed yet</p>
                  )}
                  {latest?.deploymentKey && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      Deployment {latest.deploymentKey}
                      {latest.description ? ` · ${latest.description}` : ""}
                    </p>
                  )}
                </div>
              </div>

              {!configured ? (
                <div className="border-t border-border p-5 dark:border-white/5">
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-xs leading-5 text-amber-800 dark:text-amber-200/90">
                      Live deployments are not configured yet - the Nova operator needs to set
                      NETLIFY_API_TOKEN (a free Netlify personal access token) on the server.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="border-t border-border p-5 dark:border-white/5">
                    {latest?.status === "failed" && latest.error && (
                      <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
                        <div className="min-w-0">
                          <p className="break-words text-xs font-bold text-red-700 dark:text-red-300">
                            Last deployment failed: {latest.error}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-red-600/80 dark:text-red-300/80">
                            Ask Nova to publish again - the next deploy replaces this one.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {latest?.siteUrl && (
                        <>
                          <Button variant="outline" asChild>
                            <a href={latest.siteUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink size={15} /> Open website
                            </a>
                          </Button>
                          <Button variant="outline" onClick={() => void copyUrl()} aria-label="Copy website URL">
                            <Copy size={15} /> Copy URL
                          </Button>
                        </>
                      )}
                      {latest && (
                        <Button
                          variant="outline"
                          className="ml-auto text-red-600 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
                          onClick={() => deleteDeployment(latest)}
                          disabled={removeDeployment.isPending}
                          aria-label={`Delete deployment ${latest.deploymentKey ?? latest.siteId}`}
                        >
                          <Trash2 size={15} /> Delete
                        </Button>
                      )}
                    </div>

                    {deploying && (
                      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                        <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />
                        Nova is deploying - uploading your files and waiting for Netlify to finish.
                        This usually takes under a minute.
                      </p>
                    )}
                  </div>

                  <div className="border-t border-border bg-muted/30 p-5 dark:border-white/5 dark:bg-white/[0.02]">
                    <div className="flex items-start gap-2.5">
                      <Rocket size={14} className="mt-0.5 shrink-0 text-primary" />
                      <p className="text-xs leading-5 text-muted-foreground">
                        <span className="font-bold text-foreground">Publishing is Nova's job.</span>{" "}
                        Ask Nova in chat - "publish my website" or "deploy my latest changes" - and
                        it handles the rest, end to end.
                      </p>
                    </div>
                    <details className="group mt-3">
                      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-muted-foreground transition outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
                        <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
                        How publishing works
                      </summary>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        Nova publishes your workspace to Netlify's free hosting under its folder
                        path - index.html is the entry page, and subfolders keep their structure.
                        Every deployment gets its own permanent URL and a stable ID (d-01, d-02,
                        ...) with a short description, so Nova never overwrites one deployment with
                        another project - updating a deployment keeps its URL while the content
                        changes. Nova can publish anything static hosting serves: plain HTML/CSS/JS
                        sites, React apps, statically exported Next.js projects, and more.
                      </p>
                    </details>
                  </div>
                </>
              )}
            </article>

            <article className="rise-in-delay-3 mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_4px_14px_rgba(10,10,10,0.05)] dark:border-white/10 dark:bg-card">
              <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 dark:border-white/5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold">Deployment history</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      {history.length}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    Each deploy publishes the whole workspace atomically.
                  </p>
                </div>
                <Button variant="ghost" size="icon" aria-label="Refresh deployments" onClick={() => void status.refetch()} disabled={status.isFetching}>
                  {status.isFetching ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw className="size-4" />}
                </Button>
              </div>
              {history.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <Rocket className="mx-auto size-5 text-muted-foreground/50" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Nothing deployed yet - your deployments will appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border dark:divide-white/5">
                  {history.map(row => (
                    <li key={row.id} className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-accent/40">
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-baseline gap-2">
                          <span className="shrink-0 text-sm font-semibold">
                            {row.deploymentKey ?? row.siteName ?? "Deployment"}
                          </span>
                          {row.description && (
                            <span className="truncate text-xs text-muted-foreground">{row.description}</span>
                          )}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {row.fileCount} file{row.fileCount === 1 ? "" : "s"} · {formatStamp(row.createdAt)}
                        </p>
                      </div>
                      <StatusChip status={row.status} />
                      {row.status === "live" && (
                        <a
                          href={row.siteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${row.deploymentKey ?? "deployment"} website`}
                          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                        onClick={() => deleteDeployment(row)}
                        disabled={removeDeployment.isPending}
                        aria-label={`Delete deployment ${row.deploymentKey ?? row.siteId}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </>
        )}
      </section>
    </DashboardLayout>
  );
}
