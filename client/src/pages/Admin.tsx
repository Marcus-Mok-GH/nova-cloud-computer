import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { BadgeCheck, Bot, Loader2, MessageSquareText, ShieldCheck, Users as UsersIcon, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import NotFound from "./NotFound";

function formatDay(value: Date | string | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatStamp(value: Date | string | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Admin() {
  const { loading, user } = useAuth();
  const utils = trpc.useUtils();
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);

  const overviewQuery = trpc.admin.overview.useQuery(undefined, { enabled: user?.role === "admin", retry: false });
  const usersQuery = trpc.admin.users.useQuery(undefined, { enabled: user?.role === "admin", retry: false });

  const setUserRole = trpc.admin.setUserRole.useMutation({
    onMutate: variables => setPendingUserId(variables.userId),
    onSuccess: async result => {
      setPendingUserId(null);
      await Promise.all([utils.admin.overview.invalidate(), utils.admin.users.invalidate()]);
      toast.success(`${result.user.email ?? "That account"} is now ${result.user.role === "admin" ? "an admin" : "a standard user"}.`);
    },
    onError: error => {
      setPendingUserId(null);
      toast.error(error.message || "Could not change that role.");
    },
  });

  if (loading) return <DashboardLayout><div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div></DashboardLayout>;
  if (!user || user.role !== "admin") return <NotFound />;

  const totals = overviewQuery.data?.totals;
  const users = usersQuery.data ?? [];

  const stats = [
    { icon: <UsersIcon className="size-4" />, label: "Accounts", value: totals?.users },
    { icon: <BadgeCheck className="size-4" />, label: "Admins", value: totals?.admins },
    { icon: <MessageSquareText className="size-4" />, label: "Chats", value: totals?.chats },
    { icon: <MessageSquareText className="size-4" />, label: "Messages", value: totals?.messages },
    { icon: <Bot className="size-4" />, label: "Active agent runs", value: totals?.activeAgentRuns },
    { icon: <Zap className="size-4" />, label: "Telegram linked", value: totals?.telegramLinked },
  ] as const;

  return (
    <DashboardLayout>
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Admin console</h1>
            <p className="mt-1 text-sm text-muted-foreground">System health and account management for this Nova deployment.</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map(stat => (
            <div key={stat.label} className="rounded-2xl border border-border bg-card p-4 dark:border-white/10 dark:bg-card">
              <div className="flex items-center gap-2 text-muted-foreground">{stat.icon}<span className="text-xs font-semibold">{stat.label}</span></div>
              <p className="mt-2 text-2xl font-extrabold tracking-tight">{stat.value ?? "…"}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card dark:border-white/10 dark:bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4 dark:border-white/5">
            <h2 className="text-sm font-bold">Accounts</h2>
            <span className="text-xs text-muted-foreground">{users.length} total</span>
          </div>
          {usersQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading accounts…</div>
          ) : users.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <ul className="divide-y divide-border dark:divide-white/5">
              {users.map(account => {
                const isSelf = account.id === user.id;
                const busy = pendingUserId === account.id;
                return (
                  <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-semibold">
                        {account.email ?? account.name ?? `Account #${account.id}`}
                        {account.role === "admin" && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">admin</span>}
                        {isSelf && <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">you</span>}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Joined {formatDay(account.createdAt)} · Last signed in {formatStamp(account.lastSignedIn)}
                      </p>
                    </div>
                    <button
                      onClick={() => setUserRole.mutate({ userId: account.id, role: account.role === "admin" ? "user" : "admin" })}
                      disabled={isSelf || busy}
                      title={isSelf ? "You cannot change your own role here." : account.role === "admin" ? "Demote to standard user" : "Promote to admin"}
                      className="pill-btn px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : account.role === "admin" ? "Demote" : "Promote"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card dark:border-white/10 dark:bg-card">
          <div className="border-b border-border px-5 py-4 dark:border-white/5">
            <h2 className="text-sm font-bold">Recent agent runs</h2>
          </div>
          {(overviewQuery.data?.recentAgentRuns ?? []).length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No agent VM runs recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border dark:divide-white/5">
              {(overviewQuery.data?.recentAgentRuns ?? []).map(run => (
                <li key={run.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <p className="min-w-0 truncate text-sm text-foreground/90">{run.task}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatStamp(run.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </DashboardLayout>
  );
}
