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
  status: "deploying" | "live" | "failed";
  fileCount: number;
  error: string | null;
  createdAt: Date | string;
};

export default function Deployments() {
  const utils = trpc.useUtils();
  const status = trpc.deployments.status.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const deploy = trpc.deployments.deploy.useMutation({
    onSuccess: async result => {
      await utils.deployments.status.invalidate();
      if (result.ok) {
        toast.success(`Website is live at ${result.deployment.siteUrl}`);
        window.open(result.deployment.siteUrl, "_blank", "noopener");
      } else {
        toast.error(result.message);
      }
    },
    onError: error => toast.error(error.message),
  });

  const configured = Boolean(status.data?.configured);
  const latest = (status.data?.latest ?? null) as unknown as DeploymentRow | null;
  const history = (status.data?.history ?? []) as unknown as DeploymentRow[];
  const live = latest?.status === "live";
  const deploying = deploy.isPending || latest?.status === "deploying";
  const busy = deploy.isPending;

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
          Publish your workspace as a live website — free hosting, always on, with SSL.
        </p>

        {status.isLoading ? (
          <div className="rise-in-delay-2 mt-8 flex min-h-40 items-center justify-center rounded-2xl border bg-card">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : status.isError ? (
          <div className="rise-in-delay-2 mt-8 rounded-2xl border bg-card p-8 text-center">
            <AlertTriangle className="mx-auto text-primary" size={24} />
            <h2 className="mt-4 text-xl font-bold">Deployments could not load.</h2>
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
                      {latest ? latest.siteUrl : "Not deployed yet"}
                    </p>
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
              </div>
              <div className="p-5 text-sm text-muted-foreground dark:text-muted-foreground">
                {!configured ? (
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
                    <p>
                      Live deployments are not configured yet — the Nova operator needs to set
                      NETLIFY_API_TOKEN (a free Netlify personal access token) on the server.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="leading-6">
                      Every file in your workspace is published to Netlify's free hosting under its
                      folder path — index.html is the entry page, and subfolders keep their
                      structure. The first deploy creates your permanent subdomain; later deploys
                      update the same live URL.
                    </p>
                    {latest?.status === "failed" && latest.error && (
                      <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-700 dark:text-red-300">
                        Last deployment failed: {latest.error}
                      </p>
                    )}
                    <div className="mt-5 flex flex-wrap gap-2">
                      <Button onClick={() => deploy.mutate()} disabled={busy}>
                        {busy && <Loader2 className="animate-spin" size={15} />}
                        <Rocket size={15} /> {live ? "Deploy latest changes" : "Publish my workspace"}
                      </Button>
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
                    {busy && (
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">
                        Uploading your files and waiting for Netlify to finish — this usually takes
                        under a minute.
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
                  Nothing deployed yet — your deployments will appear here.
                </p>
              ) : (
                <ul className="divide-y divide-border dark:divide-white/5">
                  {history.map(row => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">
                            {row.fileCount} file{row.fileCount === 1 ? "" : "s"}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{row.siteUrl}</span>
                        </div>
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
