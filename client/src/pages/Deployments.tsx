import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Check, Copy, ExternalLink, Globe, Loader2, Rocket, RefreshCw } from "lucide-react";
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

export default function Deployments() {
  const status = trpc.deployments.status.useQuery(undefined, { retry: false, refetchInterval: 30_000 });

  const configured = Boolean(status.data?.configured);
  const latest = (status.data?.latest ?? null) as unknown as DeploymentRow | null;
  const history = (status.data?.history ?? []) as unknown as DeploymentRow[];
  const live = latest?.status === "live";
  const deploying = latest?.status === "deploying";

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
            <article className="rise-in-delay-2 relative mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_4px_14px_rgba(10,10,10,0.05)] dark:border-white/10 dark:bg-card">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5 dark:border-white/5">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
                    <Globe className="size-5" />
                  </span>
                  <div>
                    <h2 className="text-sm font-bold">Your live website</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {latest && latest.status !== "deleted" ? latest.siteUrl : "Not deployed yet"}
                    </p>
                    {latest?.deploymentKey && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Deployment {latest.deploymentKey}
                        {latest.description ? ` - ${latest.description}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                {live && (
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <span className="size-1.5 rounded-full bg-emerald-500" /> Live 24/7
                  </span>
                )}
                {latest?.status === "failed" && (
                  <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-bold text-red-700 dark:text-red-300">
                    <AlertTriangle size={14} /> Failed
                  </span>
                )}
                {deploying && (
                  <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    <Loader2 size={14} className="animate-spin" /> Deploying
                  </span>
                )}
                {latest?.status === "deleted" && (
                  <span className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-600 dark:bg-zinc-500/10 dark:text-zinc-300">
                    Deleted
                  </span>
                )}
              </div>
              <div className="p-5 text-sm text-muted-foreground dark:text-muted-foreground">
                {!configured ? (
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
                    <p>
                      Live deployments are not configured yet - the Nova operator needs to set
                      NETLIFY_API_TOKEN (a free Netlify personal access token) on the server.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="leading-6">
                      Nova publishes your workspace to Netlify's free hosting under its folder
                      path - index.html is the entry page, and subfolders keep their structure.
                      Every deployment gets its own permanent URL and a stable ID (d-01, d-02,
                      ...) with a short description, so Nova never overwrites one deployment with
                      another project - updating a deployment keeps its URL while the content
                      changes. Nova can publish anything static hosting serves: plain
                      HTML/CSS/JS sites, React apps, statically exported Next.js projects, and
                      more.
                    </p>
                    {latest?.status === "failed" && latest.error && (
                      <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-700 dark:text-red-300">
                        Last deployment failed: {latest.error}
                      </p>
                    )}
                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.045] px-3.5 py-2.5 text-xs leading-5 dark:bg-primary/[0.07]">
                        <Rocket size={14} className="mt-0.5 shrink-0 text-primary" />
                        <p>
                          <span className="font-bold">Publishing is Nova's job.</span> Ask Nova in
                          chat - "publish my website" or "deploy my latest changes" - and it
                          handles the rest, end to end.
                        </p>
                      </div>
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
                    </div>
                    {deploying && (
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">
                        Nova is deploying - uploading your files and waiting for Netlify to
                        finish. This usually takes under a minute.
                      </p>
                    )}
                  </>
                )}
              </div>
            </article>

            <article className="rise-in-delay-3 mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_4px_14px_rgba(10,10,10,0.05)] dark:border-white/10 dark:bg-card">
              <div className="flex items-center justify-between gap-4 border-b border-border p-5 dark:border-white/5">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
                    <RefreshCw className="size-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-bold">Deployment history</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Each deploy publishes the whole workspace atomically.
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" aria-label="Refresh deployments" onClick={() => void status.refetch()} disabled={status.isFetching}>
                  {status.isFetching ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw className="size-4" />}
                </Button>
              </div>
              {history.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">
                  Nothing deployed yet - your deployments will appear here.
                </p>
              ) : (
                <ul className="divide-y divide-border dark:divide-white/5">
                  {history.map(row => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">
                            {row.deploymentKey ? `${row.deploymentKey} · ` : ""}
                            {row.fileCount} file{row.fileCount === 1 ? "" : "s"}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{row.siteUrl}</span>
                        </div>
                        {row.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
                        )}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {new Date(row.createdAt).toLocaleString()}
                        </p>
                      </div>
                      {row.status === "live" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                          <Check size={12} /> Live
                        </span>
                      ) : row.status === "deploying" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                          <Loader2 size={12} className="animate-spin" /> Deploying
                        </span>
                      ) : row.status === "deleted" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-bold text-zinc-600 dark:bg-zinc-500/10 dark:text-zinc-300">
                          Deleted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-700 dark:text-red-300">
                          <AlertTriangle size={12} /> Failed
                        </span>
                      )}
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
