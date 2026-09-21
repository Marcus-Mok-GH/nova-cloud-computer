import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Ban, BadgeCheck, Bot, Eye, FileText, Loader2, MessageSquareText, RotateCcw, ShieldCheck, Trash2, Users as UsersIcon, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import NotFound from "./NotFound";

function formatDay(value: Date | string | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatStamp(value: Date | string | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read-only inspection of one account's chats and workspace files. */
function AdminUserContent({ userId }: { userId: number }) {
  const [openFileId, setOpenFileId] = useState<number | null>(null);

  const chatsQuery = trpc.admin.userChats.useQuery({ userId }, { retry: false });
  const filesQuery = trpc.admin.userFiles.useQuery({ userId }, { retry: false });
  const fileContentQuery = trpc.admin.userFileContent.useQuery(
    { userId, fileId: openFileId ?? 0 },
    { enabled: openFileId !== null, retry: false },
  );

  const chats = chatsQuery.data ?? [];
  const files = filesQuery.data ?? [];

  return (
    <div className="w-full space-y-5 rounded-2xl bg-muted/40 p-4">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <MessageSquareText className="size-3.5" /> Chats {chatsQuery.isLoading ? "…" : `(${chats.length})`}
        </p>
        {chatsQuery.isError ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
            Couldn't load chats.
            <button onClick={() => chatsQuery.refetch()} className="pill-btn px-2.5 py-1 text-[11px]">Retry</button>
          </div>
        ) : chatsQuery.isLoading ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading chats…</div>
        ) : chats.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No chats in this workspace.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {chats.map(chat => (
              <details key={chat.id} className="rounded-xl border border-border bg-card px-3 py-2 dark:border-white/10 dark:bg-card">
                <summary className="cursor-pointer text-sm font-semibold">
                  {chat.title}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {chat.messages.length} messages · {formatStamp(chat.updatedAt)}
                  </span>
                </summary>
                <div className="mt-2 space-y-2">
                  {chat.messages.length === 0 && <p className="text-xs text-muted-foreground">No messages.</p>}
                  {chat.messages.map(message => (
                    <div key={message.id} className="rounded-lg bg-muted/60 px-3 py-2 dark:bg-white/5">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {message.role === "user" ? "User" : "Nova"} · {formatStamp(message.createdAt)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground/90">{message.content}</p>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <FileText className="size-3.5" /> Files {filesQuery.isLoading ? "…" : `(${files.length})`}
        </p>
        {filesQuery.isError ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
            Couldn't load files.
            <button onClick={() => filesQuery.refetch()} className="pill-btn px-2.5 py-1 text-[11px]">Retry</button>
          </div>
        ) : filesQuery.isLoading ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading files…</div>
        ) : files.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No files in this workspace.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {files.map(file => {
              const isOpen = openFileId === file.id;
              return (
                <li key={file.id} className="rounded-xl border border-border bg-card px-3 py-2 dark:border-white/10 dark:bg-card">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold">
                      {file.folderName ? <span className="text-muted-foreground">{file.folderName}/</span> : ""}
                      {file.name}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{formatBytes(file.sizeBytes)} · {file.mimeType} · {formatStamp(file.updatedAt)}</span>
                    </p>
                    <button onClick={() => setOpenFileId(isOpen ? null : file.id)} className="pill-btn shrink-0 px-2.5 py-1 text-[11px]">
                      {isOpen ? "Hide" : "View"}
                    </button>
                  </div>
                  {isOpen && (fileContentQuery.isError ? (
                    <div className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                      Couldn't load file content.
                      <button onClick={() => fileContentQuery.refetch()} className="pill-btn px-2.5 py-1 text-[11px]">Retry</button>
                    </div>
                  ) : (
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 text-xs text-foreground/90">
                      {fileContentQuery.isLoading ? "Loading…" : fileContentQuery.data?.content || file.preview || "(empty file)"}
                    </pre>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Admin() {
  const { loading, user } = useAuth();
  const utils = trpc.useUtils();
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [inspectingUserId, setInspectingUserId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<"role" | "ban" | "delete" | null>(null);

  const overviewQuery = trpc.admin.overview.useQuery(undefined, { enabled: user?.role === "admin", retry: false });
  const usersQuery = trpc.admin.users.useQuery(undefined, { enabled: user?.role === "admin", retry: false });

  const invalidateAdminData = async () => Promise.all([utils.admin.overview.invalidate(), utils.admin.users.invalidate()]);
  const settlePending = () => { setPendingUserId(null); setPendingAction(null); };

  const setUserRole = trpc.admin.setUserRole.useMutation({
    onMutate: variables => { setPendingUserId(variables.userId); setPendingAction("role"); },
    onSuccess: async result => {
      settlePending();
      await invalidateAdminData();
      toast.success(`${result.user.email ?? "That account"} is now ${result.user.role === "admin" ? "an admin" : "a standard user"}.`);
    },
    onError: error => { settlePending(); toast.error(error.message || "Could not change that role."); },
  });

  const setUserBanned = trpc.admin.setUserBanned.useMutation({
    onMutate: variables => { setPendingUserId(variables.userId); setPendingAction("ban"); },
    onSuccess: async result => {
      settlePending();
      await invalidateAdminData();
      toast.success(result.user.bannedAt ? `${result.user.email ?? "That account"} is banned and has been signed out.` : `${result.user.email ?? "That account"} can sign in again.`);
    },
    onError: error => { settlePending(); toast.error(error.message || "Could not update that ban."); },
  });

  const deleteUser = trpc.admin.deleteUser.useMutation({
    onMutate: variables => { setPendingUserId(variables.userId); setPendingAction("delete"); },
    onSuccess: async () => {
      settlePending();
      await invalidateAdminData();
      toast.success("Account deleted along with its workspace data.");
    },
    onError: error => { settlePending(); toast.error(error.message || "Could not delete that account."); },
  });

  if (loading) return <DashboardLayout><div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div></DashboardLayout>;
  if (!user || user.role !== "admin") return <NotFound />;

  const totals = overviewQuery.data?.totals;
  const users = usersQuery.data ?? [];
  const otherActiveAdmins = users.filter(account => account.role === "admin" && !account.bannedAt && account.id !== user.id).length;

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
                const canChangeRole = !isSelf || otherActiveAdmins > 0;
                return (
                  <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-semibold">
                        {account.email ?? account.name ?? `Account #${account.id}`}
                        {account.role === "admin" && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">admin</span>}
                        {isSelf && <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">you</span>}
                        {account.bannedAt && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 dark:bg-red-500/10 dark:text-red-300">banned</span>}
                      </p>
                      <p className={`mt-1 text-xs text-muted-foreground ${account.bannedAt ? "line-through decoration-red-400/60" : ""}`}>
                        Joined {formatDay(account.createdAt)} · Last signed in {formatStamp(account.lastSignedIn)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => setInspectingUserId(inspectingUserId === account.id ? null : account.id)}
                        title={inspectingUserId === account.id ? "Hide this account's chats and files" : "Inspect this account's chats and files"}
                        className="pill-btn px-3 py-1.5 text-xs"
                      >
                        {inspectingUserId === account.id ? <><Eye className="size-3.5" /> Close</> : <><Eye className="size-3.5" /> Inspect</>}
                      </button>
                      <button
                        onClick={() => setUserRole.mutate({ userId: account.id, role: account.role === "admin" ? "user" : "admin" })}
                        disabled={!canChangeRole || busy}
                        title={!canChangeRole && isSelf ? "You are the only active admin - promote someone else before demoting yourself." : account.role === "admin" ? "Demote to standard user" : "Promote to admin"}
                        className="pill-btn px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy && pendingAction === "role" ? <Loader2 className="size-3.5 animate-spin" /> : account.role === "admin" ? "Demote" : "Promote"}
                      </button>
                      <button
                        onClick={() => setUserBanned.mutate({ userId: account.id, banned: !account.bannedAt })}
                        disabled={isSelf || busy}
                        title={isSelf ? "You cannot ban your own account here." : account.bannedAt ? "Unban this account" : "Ban this account and sign it out"}
                        className="pill-btn px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy && pendingAction === "ban" ? <Loader2 className="size-3.5 animate-spin" /> : account.bannedAt ? <><RotateCcw className="size-3.5" /> Unban</> : <><Ban className="size-3.5" /> Ban</>}
                      </button>
                      <button
                        onClick={() => { if (window.confirm(`Permanently delete ${account.email ?? "this account"} and all of its workspace data? This cannot be undone.`)) deleteUser.mutate({ userId: account.id }); }}
                        disabled={isSelf || busy}
                        title={isSelf ? "You cannot delete your own account here." : "Permanently delete this account"}
                        className="pill-btn px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        {busy && pendingAction === "delete" ? <Loader2 className="size-3.5 animate-spin" /> : <><Trash2 className="size-3.5" /> Delete</>}
                      </button>
                    </div>
                    {inspectingUserId === account.id && <AdminUserContent userId={account.id} />}
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
