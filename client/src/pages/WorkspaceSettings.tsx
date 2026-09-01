/** Nova model settings: workspace rules and private model endpoint configuration, never exposing saved API keys. */
import { useAuth } from "@/_core/hooks/useAuth";
import { neonAuth } from "@/lib/neonAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Check, Clipboard, KeyRound, Loader2, LogOut, MessageCircle, Send, ShieldCheck, Sparkles, Trash2, UserCircle, UserX, Zap } from "lucide-react";
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
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation({
    onSuccess: async () => { toast.success("Your account and workspace data have been deleted."); await logout(); window.location.assign("/sign-in"); },
    onError: error => toast.error(error.message || "Failed to delete account."),
  });

  const accountName = user?.name || "Nova user";
  const accountEmail = user?.email || "No email available";
  const loginMethod = user?.loginMethod || "Neon Auth";
  const memberSince = user?.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "Not available";

  const copyEmail = async () => {
    if (!user?.email || typeof navigator === "undefined" || !navigator.clipboard) return;
    try { await navigator.clipboard.writeText(user.email); toast.success("Email copied."); } catch { toast.error("Could not copy your email."); }
  };

  const changePassword = async () => {
    if (!neonAuth) { toast.error("Neon Auth is not configured."); return; }
    if (!currentPassword || !newPassword) { toast.error("Enter your current and new passwords."); return; }
    if (newPassword.length < 8) { toast.error("Your new password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { toast.error("The new passwords do not match."); return; }
    setChangingPassword(true);
    try {
      const result = await neonAuth.changePassword({ newPassword, currentPassword, revokeOtherSessions: true });
      if (result.error) { toast.error(result.error.message || "Could not change your password."); return; }
      toast.success("Password changed successfully.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setPasswordDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change your password.");
    } finally { setChangingPassword(false); }
  };

  return (
    <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Profile & Account</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Your account</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Your profile details, authentication information, session controls, and account deletion are all in one place.</p></div><div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#e4f0eb] text-[#42665d] dark:bg-[#28473f] dark:text-[#c5e1d6]"><UserCircle size={24} /></div></div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-muted/20 p-5"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-background text-sm font-bold uppercase shadow-sm">{accountName.slice(0, 1)}</div><div className="min-w-0"><p className="text-lg font-bold truncate">{accountName}</p><p className="text-xs text-muted-foreground">Member since {memberSince}</p></div></div><div className="mt-5 space-y-4"><div className="space-y-2"><Label htmlFor="profile-email">Email address</Label><div className="flex gap-2"><Input id="profile-email" value={accountEmail} readOnly className="bg-background" />{user?.email && <Button variant="outline" size="icon" onClick={copyEmail} aria-label="Copy email address"><Clipboard size={15} /></Button>}</div></div><div className="space-y-2"><Label htmlFor="profile-login-method">Sign-in method</Label><Input id="profile-login-method" value={loginMethod} readOnly className="bg-background" /></div></div></div>
        <div className="rounded-2xl border bg-muted/20 p-5"><div className="flex items-center gap-2"><KeyRound className="size-4 text-[#638f84]" /><p className="text-sm font-bold">Password</p></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Your password is securely managed by Neon Auth and cannot be retrieved or displayed by Nova.</p><div className="mt-4 flex items-center gap-2"><Input id="profile-password" type="password" value="••••••••••••" readOnly aria-label="Password" className="bg-background font-mono tracking-widest" /><Button variant="outline" onClick={() => setPasswordDialogOpen(true)}>Change password</Button></div><p className="mt-3 text-xs leading-5 text-muted-foreground">Changing it uses Neon Auth's authenticated password-change endpoint and can sign out other active sessions.</p></div>
      </div>
      <AlertDialog open={passwordDialogOpen} onOpenChange={open => { setPasswordDialogOpen(open); if (!open) { setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="font-[DM_Serif_Display] text-2xl">Change password</AlertDialogTitle><AlertDialogDescription>Enter your current password and choose a new password. Other active sessions will be signed out after the change.</AlertDialogDescription></AlertDialogHeader><div className="space-y-4 py-2"><div className="space-y-2"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></div></div><AlertDialogFooter><AlertDialogCancel disabled={changingPassword}>Cancel</AlertDialogCancel><Button onClick={changePassword} disabled={changingPassword}>{changingPassword && <Loader2 size={15} className="mr-2 animate-spin" />}Change password</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-muted/20 p-5"><div className="space-y-1"><p className="text-sm font-bold text-foreground">Sign out of Nova</p><p className="text-xs text-muted-foreground">Logged in as {accountEmail}</p></div><Button variant="outline" onClick={() => logout()} className="gap-2"><LogOut size={16} /> Log out</Button></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-5"><div className="space-y-1"><p className="text-sm font-bold text-red-600 dark:text-red-400">Delete account</p><p className="text-xs text-muted-foreground">Permanently delete your account, projects, files, and settings. This action cannot be undone.</p></div><AlertDialog open={deleteDialogOpen} onOpenChange={open => { setDeleteDialogOpen(open); if (!open) setConfirmText(""); }}><AlertDialogTrigger asChild><Button variant="destructive" className="gap-2"><UserX size={16} /> Delete my account</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="font-[DM_Serif_Display] text-2xl text-destructive">Are you absolutely sure?</AlertDialogTitle><AlertDialogDescription className="space-y-3"><span>This will permanently delete your account (<strong>{user?.email}</strong>) and erase all associated projects, tasks, workspace files, saved credentials, and settings.</span><span className="block font-medium text-foreground">Type <strong>DELETE</strong> below to confirm.</span></AlertDialogDescription></AlertDialogHeader><div className="py-2"><Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder='Type "DELETE" to confirm' className="font-mono" /></div><AlertDialogFooter><AlertDialogCancel disabled={deleteAccountMutation.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={confirmText !== "DELETE" || deleteAccountMutation.isPending} onClick={e => { e.preventDefault(); deleteAccountMutation.mutate(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleteAccountMutation.isPending && <Loader2 size={15} className="mr-2 animate-spin" />}Delete account permanently</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
    </section>
  );
}

function AutomationCard() {
  const utils = trpc.useUtils();
  const automations = trpc.automations.list.useQuery(undefined, { retry: false });
  const automation = automations.data?.find(item => item.kind === "workspace_digest");
  const runs = trpc.automations.runs.useQuery({ automationId: automation?.id ?? 0 }, { enabled: Boolean(automation?.id), retry: false });
  const update = trpc.automations.update.useMutation({ onSuccess: async data => { await Promise.all([utils.automations.list.invalidate(), utils.automations.runs.invalidate({ automationId: data.id })]); toast.success(data.enabled ? "Daily workspace briefing enabled." : "Daily workspace briefing paused."); }, onError: error => toast.error(error.message) });
  const latestRun = runs.data?.[0];
  const lastRunLabel = latestRun?.completedAt ? new Date(latestRun.completedAt).toLocaleString() : "No run yet";
  return <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Automations</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">A daily briefing with a memory</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">When enabled, Nova schedules one private Markdown snapshot every day at 09:00 UTC. The setting, run history, schedule identity, and reports stay inside this app and its database.</p></div><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${automation?.enabled ? "bg-[#e4f0eb] text-[#42665d] dark:bg-[#28473f] dark:text-[#c5e1d6]" : "bg-muted text-muted-foreground"}`}><Zap size={14} /> {automation?.enabled ? "Enabled" : "Paused"}</span></div><div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto]"><div className="rounded-2xl border bg-muted/20 p-4"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-bold">Daily workspace briefing</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Runs automatically in the background once per UTC day and writes the report to your private workspace.</p></div><Switch checked={Boolean(automation?.enabled)} onCheckedChange={enabled => automation && update.mutate({ id: automation.id, enabled })} disabled={!automation || update.isPending || automations.isLoading} aria-label="Enable daily workspace briefing" /></div></div><div className="rounded-2xl border bg-muted/20 p-4 text-sm"><p className="font-bold">Latest activity</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{runs.isLoading ? "Loading history…" : latestRun ? `${latestRun.status} · ${lastRunLabel}` : lastRunLabel}</p>{latestRun?.errorMessage && <p className="mt-2 text-xs leading-5 text-destructive">{latestRun.errorMessage}</p>}</div></div>{automations.isError && <p className="mt-3 text-xs text-destructive">Your automation setting could not load. Your saved preference has not been changed.</p>}</section>;
}

function TelegramBotCard() {
  const utils = trpc.useUtils();
  const status = trpc.telegram.status.useQuery(undefined, { retry: false, refetchInterval: 3000 });
  const [chatId, setChatId] = useState("");
  const [testText, setTestText] = useState("Nova Telegram test message.");
  const refresh = () => utils.telegram.status.invalidate();
  const configure = trpc.telegram.configure.useMutation({ onSuccess: async data => { await refresh(); setChatId(data.chatId ?? ""); toast.success("Bot token saved. Open Telegram and send /start to connect your account."); }, onError: error => toast.error(error.message) });
  const discover = trpc.telegram.discoverChat.useMutation({ onSuccess: async data => { await refresh(); setChatId(data.chatId ?? ""); toast.success("Telegram chat discovered and connected."); }, onError: error => toast.error(error.message) });
  const sendTest = trpc.telegram.sendTest.useMutation({ onSuccess: () => toast.success("Test message sent to Telegram."), onError: error => toast.error(error.message) });
  const remove = trpc.telegram.remove.useMutation({ onSuccess: async () => { await refresh(); setChatId(""); toast.success("Telegram connection removed."); }, onError: error => toast.error(error.message) });
  const configured = Boolean(status.data?.configured);
  const ready = Boolean(configured && status.data?.chatId);
  const webhookLinked = Boolean(configured && status.data?.webhook?.linked);
  const waitingForTelegram = configured && !status.data?.chatId;
  return <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Telegram Bot</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Send from your workspace</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Nova encrypts your BotFather token before storage and never displays it again. Saving the token only configures the bot — it does not connect your Telegram account. To authorize your chat, use the main button below to open the bot in Telegram and press Start or send <code>/start</code>. Nova will mark Telegram as connected only after a chat ID is received.</p></div>{ready && <span className="inline-flex items-center gap-2 rounded-full bg-[#e4f0eb] px-3 py-1.5 text-xs font-bold text-[#42665d] dark:bg-[#28473f] dark:text-[#c5e1d6]"><Check size={14} /> Telegram connected</span>}{waitingForTelegram && <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300"><MessageCircle size={14} /> Waiting for Telegram</span>}{configured && !webhookLinked && <span className="inline-flex items-center gap-2 rounded-full bg-[#fdecec] px-3 py-1.5 text-xs font-bold text-[#9c3434] dark:bg-[#4a2626] dark:text-[#f3c6c6]"><AlertTriangle size={14} /> Webhook not reachable</span>}</div><div className="mt-6 grid gap-5 lg:grid-cols-2"><div className="space-y-4 rounded-2xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><MessageCircle className="size-4 text-sky-500" /><p className="text-sm font-bold">Connect your Telegram account</p></div><p className="text-xs leading-5 text-muted-foreground">First save the bot token. Then use the main orange button to open the bot in Telegram and press Start. The page checks automatically for the incoming chat and updates this status when Telegram sends it.</p><Button className="w-full" onClick={() => configure.mutate({ chatId: chatId.trim() || null })} disabled={configure.isPending}>{configure.isPending && <Loader2 className="animate-spin" size={15} />} Connect Telegram</Button>{status.data?.botUsername && <p className="text-xs text-muted-foreground">@{status.data.botUsername} is configured. Use the main Connect Telegram button above to authorize your account.</p>}{configured && <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => discover.mutate()} disabled={discover.isPending}>{discover.isPending && <Loader2 className="animate-spin" size={15} />} Discover chat</Button><Button variant="ghost" size="icon" aria-label="Remove Telegram connection" onClick={() => remove.mutate()} disabled={remove.isPending} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button></div>}</div><div className="space-y-4 rounded-2xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#638f84]" /><p className="text-sm font-bold">Send a test</p></div><p className="text-xs leading-5 text-muted-foreground">{ready ? `Sending to chat ${status.data?.chatId}. Your Telegram account is connected to @${status.data?.botUsername ?? "the bot"}.` : waitingForTelegram ? "Your bot is configured, but your Telegram chat is not connected yet. Use the main Connect Telegram button to open the bot and press Start, then wait for the status to update." : "Save a valid bot token first. Then use the main Connect Telegram button to open the bot and press Start to connect your chat."}</p><Textarea value={testText} onChange={event => setTestText(event.target.value)} className="min-h-28" maxLength={4096} disabled={!ready} /><Button variant="outline" className="w-full" onClick={() => sendTest.mutate({ text: testText })} disabled={!ready || !testText.trim() || sendTest.isPending}>{sendTest.isPending && <Loader2 className="animate-spin" size={15} />} <Send size={15} /> Send test message</Button></div></div></section>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) { return <div className="space-y-2"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>; }