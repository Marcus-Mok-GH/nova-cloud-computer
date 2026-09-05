import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Activity, Cloud, GitBranch, Moon, Rocket, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function Deployments() {
  const statusQuery = trpc.agentVm.status.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const sandboxStatus = statusQuery.data?.sandbox.status ?? "unavailable";
  const sandboxLabel =
    sandboxStatus === "active"
      ? "Active"
      : sandboxStatus === "sleeping"
        ? "Sleeping"
        : sandboxStatus === "not_configured"
          ? "Not configured"
          : "Unavailable";
  const sandboxTone =
    sandboxStatus === "active"
      ? "emerald"
      : sandboxStatus === "sleeping"
        ? "amber"
        : "neutral";
  return (
    <DashboardLayout>
      <section className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[oklch(0.72_0.015_250)] dark:text-[oklch(0.72_0.015_250)]">
          Release room
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Deployments
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">
          A calm place to keep track of what Nova is ready to publish.
        </p>
        <article className="mt-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-white/10 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-100 p-5 dark:border-white/5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-[oklch(0.72_0.015_250)]/10 text-[oklch(0.72_0.015_250)]">
                <Rocket className="size-5" />
              </span>
              <div>
                <h2 className="text-sm font-bold">Nova production</h2>
                <p className="mt-1 text-xs text-neutral-400">
                  nova-cloud-computer.vercel.app
                </p>
              </div>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${sandboxTone === "emerald" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : sandboxTone === "amber" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" : "bg-neutral-100 text-neutral-600 dark:bg-white/10 dark:text-neutral-300"}`}
            >
              {sandboxLabel}
            </span>
          </div>
          <div className="grid gap-px bg-neutral-100 sm:grid-cols-3 dark:bg-white/10">
            <Metric icon={<Cloud />} label="Environment" value="Production" />
            <Metric icon={<GitBranch />} label="Source" value="main branch" />
            <Metric
              icon={
                sandboxStatus === "active" ? (
                  <Zap />
                ) : sandboxStatus === "sleeping" ? (
                  <Moon />
                ) : (
                  <Activity />
                )
              }
              label="E2B sandbox"
              value={sandboxLabel}
            />
          </div>
          <div className="p-5 text-sm text-neutral-500 dark:text-neutral-400">
            {statusQuery.isLoading
              ? "Checking the E2B workspace sandbox status…"
              : statusQuery.isError
                ? "The E2B workspace sandbox status could not be checked right now."
                : sandboxStatus === "active"
                  ? "The persistent E2B workspace sandbox is running and ready for work."
                  : sandboxStatus === "sleeping"
                    ? "The persistent E2B workspace sandbox is paused. The next workspace action can resume it."
                    : sandboxStatus === "not_configured"
                      ? "E2B is not configured for this deployment yet."
                      : "The persistent E2B workspace sandbox is not currently available."}
          </div>
        </article>
      </section>
    </DashboardLayout>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white p-5 dark:bg-neutral-900">
      <div className="flex items-center gap-2 text-neutral-400">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-[0.12em]">
          {label}
        </span>
      </div>
      <p className="mt-3 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        {value}
      </p>
    </div>
  );
}
