/** Nova model settings: workspace rules and private model endpoint configuration, never exposing saved API keys. */
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Check, Loader2, LogOut, MessageCircle, Send, ShieldCheck, Sparkles, Trash2, UserX, Zap } from "lucide-react";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";

export default function WorkspaceSettings() {
  const utils = trpc.useUtils();
  const settings = trpc.workspace.modelSettings.useQuery(undefined, { retry: false });
  const [rules, setRules] = useState("");

  useEffect(() => { if (settings.data) setRules(settings.data.workspaceRules ?? ""); }, [settings.data]);
  const refresh = async () => { await Promise.all([utils.workspace.modelSettings.invalidate(), utils.workspace.dashboard.invalidate()]); };
  const updateSettings = trpc.workspace.updateSettings.useMutation({ onSuccess: async () => { await refresh(); toast.success("Workspace settings saved."); }, onError: error => toast.error(error.message) });

  const saveRules = () => updateSettings.mutate({ workspaceRules: rules.trim() || null });

  if (settings.isLoading) return <DashboardLayout><div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div></DashboardLayout>;
  if (settings.isError) return <DashboardLayout><div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center"><section className="rounded-3xl border bg-card p-8 text-center"><Sparkles className="mx-auto text-[#75a79a]" size={24} /><h1 className="mt-4 font-[DM_Serif_Display] text-3xl">Settings could not load.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Your saved preferences have not been changed. Check your connection and try again.</p><Button className="mt-6" onClick={() => settings.refetch()}>Try again</Button></section></div></DashboardLayout>;

  return <DashboardLayout><div className="mx-auto max-w-5xl space-y-7 pb-12 pt-3">
    <section className="relative overflow-hidden rounded-3xl border border-stone-200 bg-[#f2f2ea] px-6 py-8 shadow-sm dark:border-white/10 dark:bg-[#1d292a] sm:px-9 sm:py-10"><div className="absolute -right-12 -top-20 h-64 w-64 rounded-full bg-[#b6d7d0]/60 blur-3xl dark:bg-[#3d807a]/35" /><div className="relative"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-stone-500 dark:text-stone-300">Your personal cloud</p><h1 className="mt-3 font-[DM_Serif_Display] text-4xl tracking-tight text-stone-800 dark:text-stone-100 sm:text-5xl">Preferences with a memory.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-300">Give Nova the standing rules that make your workspace feel like yours. Preferences are saved privately to your workspace.</p></div></section>


    <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Workspace rules</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">How Nova should help</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Save standing preferences for future assistant experiences. Keep important approval boundaries and working style here.</p><Textarea className="mt-5 min-h-44 resize-y" value={rules} onChange={event => setRules(event.target.value)} placeholder="For example: Keep status updates concise. Always show a draft before sending anything outside this workspace." maxLength={8000} /><div className="mt-4 flex justify-end"><Button onClick={saveRules} disabled={updateSettings.isPending}>{updateSettings.isPending && <Loader2 size={15} className="animate-spin" />} Save rules</Button></div></section>
    <TelegramBotCard />
    <AutomationCard />
    <AccountManagementCard />
  </div></DashboardLayout>;
}

function AccountManagementCard() {
  const { user, logout } = useAuth();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation({
    onSuccess: async () => {
      toast.success("Your account and workspace data have been deleted.");
      await logout();
      window.location.assign("/sign-in");
    },
    onError: error => {
      toast.error(error.message || "Failed to delete account.");
    },
  });

  const handleDeleteAccount = () => {
    deleteAccountMutation.mutate();
  };

  return (
    <section className="rounded-3xl border border-red-500/20 bg-card p-5 text-card-foreground shadow-sm sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-red-500/80 dark:text-red-400/80">Account & Session</p>
          <h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Account settings</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Manage your session or permanently delete your user account and all personal workspace data.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-muted/20 p-5">
        <div className="space-y-1">
          <p className="text-sm font-bold text-foreground">Sign out of Nova</p>
          <p className="text-xs text-muted-foreground">Logged in as {user?.email || "User"}</p>
        </div>
        <Button variant="outline" onClick={() => logout()} className="gap-2">
          <LogOut size={16} /> Log out
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <div className="space-y-1">
          <p className="text-sm font-bold text-red-600 dark:text-red-400">Delete account</p>
          <p className="text-xs text-muted-foreground">
            Permanently delete your account, projects, files, and settings. This action cannot be undone.
          </p>
        </div>

        <AlertDialog open={deleteDialogOpen} onOpenChange={open => { setDeleteDialogOpen(open); if (!open) setConfirmText(""); }}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="gap-2">
              <UserX size={16} /> Delete my account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-[DM_Serif_Display] text-2xl text-destructive">
                Are you absolutely sure?
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                <span>
                  This will permanently delete your account (<strong>{user?.email}</strong>) and erase all associated projects, tasks, workspace files, saved credentials, and settings.
                </span>
                <span className="block font-medium text-foreground">
                  Type <strong>DELETE</strong> below to confirm.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-2">
              <Input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder='Type "DELETE" to confirm'
                className="font-mono"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteAccountMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirmText !== "DELETE" || deleteAccountMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  handleDeleteAccount();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteAccountMutation.isPending && <Loader2 size={15} className="mr-2 animate-spin" />}
                Delete account permanently
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}

function AutomationCard() {
  const utils = trpc.useUtils();
  const automations = trpc.automations.list.useQuery(undefined, { retry: false });
  const automation = automations.data?.find(item => item.kind === "workspace_digest");
  const runs = trpc.automations.runs.useQuery({ automationId: automation?.id ?? 0 }, { enabled: Boolean(automation?.id), retry: false });
  const update = trpc.automations.update.useMutation({
    onSuccess: async data => {
      await Promise.all([utils.automations.list.invalidate(), utils.automations.runs.invalidate({ automationId: data.id })]);
      toast.success(data.enabled ? "Daily workspace briefing enabled." : "Daily workspace briefing paused.");
    },
    onError: error => toast.error(error.message),
  });
  const latestRun = runs.data?.[0];
  const lastRunLabel = latestRun?.completedAt ? new Date(latestRun.completedAt).toLocaleString() : "No run yet";

  return <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Automations</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">A daily briefing with a memory</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">When enabled, Nova schedules one private Markdown snapshot every day at 09:00 UTC. The setting, run history, schedule identity, and reports stay inside this app and its database.</p></div><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${automation?.enabled ? "bg-[#e4f0eb] text-[#42665d] dark:bg-[#28473f] dark:text-[#c5e1d6]" : "bg-muted text-muted-foreground"}`}><Zap size={14} /> {automation?.enabled ? "Enabled" : "Paused"}</span></div>
    <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto]"><div className="rounded-2xl border bg-muted/20 p-4"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-bold">Daily workspace briefing</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Runs automatically in the background once per UTC day and writes the report to your private workspace.</p></div><Switch checked={Boolean(automation?.enabled)} onCheckedChange={enabled => automation && update.mutate({ id: automation.id, enabled })} disabled={!automation || update.isPending || automations.isLoading} aria-label="Enable daily workspace briefing" /></div></div><div className="rounded-2xl border bg-muted/20 p-4 text-sm"><p className="font-bold">Latest activity</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{runs.isLoading ? "Loading history…" : latestRun ? `${latestRun.status} · ${lastRunLabel}` : lastRunLabel}</p>{latestRun?.errorMessage && <p className="mt-2 text-xs leading-5 text-destructive">{latestRun.errorMessage}</p>}</div></div>
    {automations.isError && <p className="mt-3 text-xs text-destructive">Your automation setting could not load. Your saved preference has not been changed.</p>}
  </section>;
}

function TelegramBotCard() {
  const utils = trpc.useUtils();
  const status = trpc.telegram.status.useQuery(undefined, { retry: false });
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [testText, setTestText] = useState("Nova is connected to your Telegram bot.");
  const refresh = () => utils.telegram.status.invalidate();
  const configure = trpc.telegram.configure.useMutation({ onSuccess: async data => { await refresh(); setToken(""); setChatId(data.chatId ?? ""); toast.success(`Telegram bot${data.botUsername ? ` @${data.botUsername}` : ""} validated and saved privately.`); }, onError: error => toast.error(error.message) });
  const discover = trpc.telegram.discoverChat.useMutation({ onSuccess: async data => { await refresh(); setChatId(data.chatId ?? ""); toast.success("Telegram chat discovered."); }, onError: error => toast.error(error.message) });
  const sendTest = trpc.telegram.sendTest.useMutation({ onSuccess: () => toast.success("Test message sent to Telegram."), onError: error => toast.error(error.message) });
  const remove = trpc.telegram.remove.useMutation({ onSuccess: async () => { await refresh(); setChatId(""); toast.success("Telegram connection removed."); }, onError: error => toast.error(error.message) });
  const ready = Boolean(status.data?.configured && status.data.chatId);
  const webhookLinked = Boolean(status.data?.configured && status.data.webhook?.linked);
  return <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Telegram Bot</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Send from your workspace</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Nova encrypts your BotFather token before storage and never displays it again. Telegram requires a destination chat: either paste its ID or message your bot with <code>/start</code> and let Nova discover it. Incoming updates need a reachable webhook; Nova checks it and offers a repair button when Telegram cannot deliver.</p></div>{ready && <span className="inline-flex items-center gap-2 rounded-full bg-[#e4f0eb] px-3 py-1.5 text-xs font-bold text-[#42665d] dark:bg-[#28473f] dark:text-[#c5e1d6]"><Check size={14} /> Ready to send</span>}{status.data?.configured && !webhookLinked && <span className="inline-flex items-center gap-2 rounded-full bg-[#fdecec] px-3 py-1.5 text-xs font-bold text-[#9c3434] dark:bg-[#4a2626] dark:text-[#f3c6c6]"><AlertTriangle size={14} /> Webhook not reachable</span>}</div>
    <div className="mt-6 grid gap-5 lg:grid-cols-2"><div className="space-y-4 rounded-2xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><MessageCircle className="size-4 text-sky-500" /><p className="text-sm font-bold">Connect your bot</p></div><Field label="Bot token" htmlFor="telegram-token"><Input id="telegram-token" type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} placeholder={status.data?.configured ? "Saved privately — paste a new token to replace" : "123456:ABC…"} /></Field><Field label="Chat ID (optional)" htmlFor="telegram-chat-id"><Input id="telegram-chat-id" value={chatId} onChange={event => setChatId(event.target.value)} placeholder="Paste a chat ID or discover it after /start" /></Field><Button className="w-full" onClick={() => configure.mutate({ botToken: token, chatId: token.trim() ? (chatId.trim() || null) : undefined })} disabled={(!token.trim() && !status.data?.configured) || configure.isPending}>{configure.isPending && <Loader2 className="animate-spin" size={15} />}{token.trim() ? "Validate & save token" : "Re-register webhook"}</Button>{status.data?.configured && <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => discover.mutate()} disabled={discover.isPending}>{discover.isPending && <Loader2 className="animate-spin" size={15} />} Discover chat</Button><Button variant="ghost" size="icon" aria-label="Remove Telegram connection" onClick={() => remove.mutate()} disabled={remove.isPending} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button></div>}</div>
      <div className="space-y-4 rounded-2xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#638f84]" /><p className="text-sm font-bold">Send a test</p></div><p className="text-xs leading-5 text-muted-foreground">{ready ? `Sending to chat ${status.data?.chatId}. Your bot${status.data?.botUsername ? ` is @${status.data.botUsername}` : ""} is connected.` : "First save a valid bot token. Then message the bot in Telegram and use Discover chat."}</p><Textarea value={testText} onChange={event => setTestText(event.target.value)} className="min-h-28" maxLength={4096} disabled={!ready} /><Button variant="outline" className="w-full" onClick={() => sendTest.mutate({ text: testText })} disabled={!ready || !testText.trim() || sendTest.isPending}>{sendTest.isPending && <Loader2 className="animate-spin" size={15} />} <Send size={15} /> Send test message</Button></div></div></section>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) { return <div className="space-y-2"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>; }
