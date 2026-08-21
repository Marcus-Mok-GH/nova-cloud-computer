import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Activity, Cloud, GitBranch, Rocket } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function Deployments() {
  return (
    <DashboardLayout>
      <section className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#f97316]">Release room</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Deployments</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">A calm place to keep track of what Nova is ready to publish.</p>
        <article className="mt-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-white/10 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-100 p-5 dark:border-white/5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-[#f97316]/10 text-[#f97316]"><Rocket className="size-5" /></span>
              <div>
                <h2 className="text-sm font-bold">Nova production</h2>
                <p className="mt-1 text-xs text-neutral-400">nova-cloud-computer.vercel.app</p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Ready</span>
          </div>
          <div className="grid gap-px bg-neutral-100 sm:grid-cols-3 dark:bg-white/10">
            <Metric icon={<Cloud />} label="Environment" value="Production" />
            <Metric icon={<GitBranch />} label="Source" value="main branch" />
            <Metric icon={<Activity />} label="Status" value="Healthy" />
          </div>
          <div className="p-5 text-sm text-neutral-500 dark:text-neutral-400">Future releases prepared with Nova can appear here alongside their deployment notes and status.</div>
        </article>

        <VerifyDomainCard />
      </section>
    </DashboardLayout>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white p-5 dark:bg-neutral-900">
      <div className="flex items-center gap-2 text-neutral-400">{icon}<span className="text-[10px] font-bold uppercase tracking-[0.12em]">{label}</span></div>
      <p className="mt-3 text-sm font-semibold text-neutral-800 dark:text-neutral-200">{value}</p>
    </div>
  );
}

const DOMAIN = "nova-cloud-computer.vercel.app";
const DNS_RECORD_NAME = "_strix-verification.vercel.app";

function VerifyDomainCard() {
  const [mode, setMode] = React.useState<"pending" | "oneclick" | "manual">("pending");
  const utils = trpc.useUtils();
  const statusQuery = trpc.deployments.getDomainVerification.useQuery({ domain: DOMAIN }, { refetchInterval: 5000 });
  const generateMutation = trpc.deployments.generateDomainVerificationToken.useMutation();
  const checkMutation = trpc.deployments.checkDomainVerification.useMutation();

  const record = statusQuery.data;
  const status = record?.status ?? "pending";
  const token = record?.verificationToken ?? null;

  const handleGenerate = async () => {
    await generateMutation.mutateAsync({ domain: DOMAIN, dnsRecordName: DNS_RECORD_NAME });
    await utils.deployments.getDomainVerification.invalidate();
  };

  const handleCheck = async () => {
    await checkMutation.mutateAsync({ domain: DOMAIN });
    await utils.deployments.getDomainVerification.invalidate();
  };

  return (
    <article className="mt-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-white/10 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 p-5 dark:border-white/5">
        <h2 className="text-sm font-bold">Verify Domain</h2>
        <p className="mt-1 text-xs text-neutral-400">Verification {status} for {DOMAIN}</p>
      </div>

      <div className="p-5">
        {status === "verified" ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Domain verified</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">The DNS TXT record for {DNS_RECORD_NAME} is present and valid.</p>
          </div>
        ) : mode === "pending" ? (
          <div className="space-y-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-300">Choose how you want to verify this domain.</p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setMode("oneclick")}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                One-click verification
              </button>
              <button
                onClick={() => setMode("manual")}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/5"
              >
                DNS Record
              </button>
            </div>
          </div>
        ) : mode === "oneclick" ? (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">One-click verification</p>
            <p className="text-xs text-red-600 dark:text-red-400">vercel.app was not found in the connected Vercel account.</p>
            <div className="flex flex-wrap gap-3">
              <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
                Verify with Vercel
              </button>
              <button className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/5">
                Verify with Cloudflare
              </button>
            </div>
            <button onClick={() => setMode("pending")} className="text-xs text-neutral-500 underline">Back</button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Manual setup</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-neutral-200 p-4 dark:border-white/10">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Record name</p>
                <p className="mt-2 break-all text-sm font-semibold text-neutral-800 dark:text-neutral-200">{DNS_RECORD_NAME}</p>
              </div>
              <div className="rounded-lg border border-neutral-200 p-4 dark:border-white/10">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Record value</p>
                <p className="mt-2 break-all text-sm font-semibold text-neutral-800 dark:text-neutral-200">{token ?? "Generating..."}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {generateMutation.isPending ? "Generating..." : "Generate new token"}
              </button>
              <button
                onClick={handleCheck}
                disabled={checkMutation.isPending || !token}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/5"
              >
                {checkMutation.isPending ? "Checking..." : "Check DNS"}
              </button>
            </div>
            {checkMutation.data && (
              <p className={`text-xs ${checkMutation.data.verified ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {checkMutation.data.verified ? "DNS record found. Domain is verified." : "DNS record not found yet. It may take a few minutes to propagate."}
              </p>
            )}
            <button onClick={() => setMode("pending")} className="text-xs text-neutral-500 underline">Back</button>
          </div>
        )}
      </div>
    </article>
  );
}
