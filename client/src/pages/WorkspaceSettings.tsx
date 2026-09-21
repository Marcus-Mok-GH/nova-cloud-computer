/** Nova settings: workspace preferences, Telegram, user-created automations, and account management. */
import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import UserAutomationsCard from "@/components/UserAutomationsCard";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Check, Clipboard, Github, KeyRound, Loader2, LogOut, Mail, MessageCircle, RefreshCw, Send, ShieldCheck, Sparkles, Trash2, UserCircle, UserX } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function WorkspaceSettings() {
  const utils = trpc.useUtils();
  const settings = trpc.workspace.modelSettings.useQuery(undefined, { retry: false });
  const [rules, setRules] = useState("");
  useEffect(() => { if (settings.data) setRules(settings.data.workspaceRules ?? ""); }, [settings.data]);
  const updateSettings = trpc.workspace.updateSettings.useMutation({ onSuccess: async () => { await Promise.all([utils.workspace.modelSettings.invalidate(), utils.workspace.dashboard.invalidate()]); toast.success("Workspace settings saved."); }, onError: error => toast.error(error.message) });
  if (settings.isLoading) return <DashboardLayout><div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div></DashboardLayout>;
  if (settings.isError) return <DashboardLayout><div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center"><section className="rounded-2xl border bg-card p-8 text-center shadow-[0_4px_14px_rgba(10,10,10,0.05)]"><Sparkles className="mx-auto text-primary" size={24} /><h1 className="mt-4 text-2xl font-extrabold tracking-tight">Settings could not load.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Your saved preferences have not been changed. Check your connection and try again.</p><Button className="mt-6" onClick={() => settings.refetch()}>Try again</Button></section></div></DashboardLayout>;
  return <DashboardLayout><div className="relative mx-auto max-w-5xl space-y-7 pb-12 pt-6">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-primary/[0.045] to-transparent dark:from-primary/[0.07]" />
    <section className="rise-in relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-8 shadow-[0_4px_14px_rgba(10,10,10,0.05)] dark:border-white/10 dark:bg-card sm:px-9 sm:py-10"><div className="relative"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Your personal cloud</p><h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground dark:text-foreground sm:text-3xl">Preferences with a memory.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground dark:text-muted-foreground">Give Nova the standing rules and recurring jobs that make your workspace feel like yours.</p></div></section>
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Workspace rules</p><h2 className="mt-1 text-xl font-bold tracking-tight">How Nova should help</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Save standing preferences for future assistant experiences.</p><Textarea className="mt-5 min-h-44 resize-y" value={rules} onChange={event => setRules(event.target.value)} placeholder="For example: Keep status updates concise. Always show a draft before sending anything outside this workspace." maxLength={8000} /><div className="mt-4 flex justify-end"><Button onClick={() => updateSettings.mutate({ workspaceRules: rules.trim() || null })} disabled={updateSettings.isPending}>{updateSettings.isPending && <Loader2 size={15} className="animate-spin" />} Save rules</Button></div></section>
    <ModelProviderCard />
    <TelegramBotCard />
    <ConnectorCard toolkit="github" />
    <ConnectorCard toolkit="gmail" />
    <UserAutomationsCard />
    <AccountManagementCard />
  </div></DashboardLayout>;
}

/**
 * Renders the account management card with user profile information, sign-out, and account deletion controls.
 */
function AccountManagementCard() {
  const { user, logout } = useAuth();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false); const [confirmText, setConfirmText] = useState("");
  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation({ onSuccess: async () => { toast.success("Your account and workspace data have been deleted."); await logout(); window.location.assign("/sign-in"); }, onError: error => toast.error(error.message || "Failed to delete account.") });
  const accountName = user?.name || "Nova user"; const accountEmail = user?.email || "No email available"; const loginMethod = user?.loginMethod || "Neon Auth"; const memberSince = user?.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "Not available";
  const copyEmail = async () => { if (!user?.email || !navigator.clipboard) return; try { await navigator.clipboard.writeText(user.email); toast.success("Email copied."); } catch { toast.error("Could not copy your email."); } };
  return <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Profile & Account</p><h2 className="mt-1 text-xl font-bold tracking-tight">Your account</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Your profile details, authentication information, session controls, and account deletion are all in one place.</p></div><div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><UserCircle size={24} /></div></div>
    <div className="mt-6 rounded-2xl border bg-muted/20 p-5"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-background text-sm font-bold uppercase shadow-[0_4px_14px_rgba(10,10,10,0.05)]">{accountName.slice(0, 1)}</div><div className="min-w-0"><p className="truncate text-lg font-bold">{accountName}</p><p className="text-xs text-muted-foreground">Member since {memberSince}</p></div></div><div className="mt-5 space-y-4"><div className="space-y-2"><Label htmlFor="profile-email">Email address</Label><div className="flex gap-2"><Input id="profile-email" value={accountEmail} readOnly className="bg-background" />{user?.email && <Button variant="outline" size="icon" onClick={copyEmail} aria-label="Copy email address"><Clipboard size={15} /></Button>}</div></div><div className="space-y-2"><Label>Sign-in method</Label><Input value={loginMethod} readOnly className="bg-background" /></div></div></div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-muted/20 p-5"><div><p className="text-sm font-bold">Sign out of Nova</p><p className="text-xs text-muted-foreground">Logged in as {accountEmail}</p></div><Button variant="outline" onClick={() => logout()} className="gap-2"><LogOut size={16} /> Log out</Button></div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-5"><div><p className="text-sm font-bold text-red-600">Delete account</p><p className="text-xs text-muted-foreground">Permanently delete your account, projects, files, and settings.</p></div><AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}><AlertDialogTrigger asChild><Button variant="destructive" className="gap-2"><UserX size={16} /> Delete my account</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete your account and associated workspace data. Type DELETE to confirm.</AlertDialogDescription></AlertDialogHeader><Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder='Type "DELETE" to confirm' /><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={confirmText !== "DELETE" || deleteAccountMutation.isPending} onClick={e => { e.preventDefault(); deleteAccountMutation.mutate(); }}>Delete account permanently</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
  </section>;
}

/**
 * BYOK: choose between Nova's built-in AI gateway and the workspace's own
 * OpenAI-compatible providers (user-supplied API keys, encrypted at rest).
 */
function ModelProviderCard() {
  const utils = trpc.useUtils();
  const settings = trpc.workspace.modelSettings.useQuery(undefined, { retry: false });
  const gatewayStatus = trpc.mistral.status.useQuery(undefined, { retry: false });
  const [name, setName] = useState(""); const [modelId, setModelId] = useState(""); const [baseUrl, setBaseUrl] = useState(""); const [apiKey, setApiKey] = useState(""); const [supportsImageInput, setSupportsImageInput] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null); const [testOk, setTestOk] = useState<boolean | null>(null);
  const invalidate = async () => { await Promise.all([utils.workspace.modelSettings.invalidate(), utils.workspace.dashboard.invalidate()]); };
  const createCustom = trpc.models.createCustom.useMutation({ onSuccess: async () => { setName(""); setModelId(""); setBaseUrl(""); setApiKey(""); setSupportsImageInput(false); setTestMessage(null); setTestOk(null); await invalidate(); toast.success("Provider saved. Switch to it below to start using your own key."); }, onError: error => toast.error(error.message) });
  const deleteCustom = trpc.models.deleteCustom.useMutation({ onSuccess: async () => { await invalidate(); toast.success("Provider removed."); }, onError: error => toast.error(error.message) });
  const testCustom = trpc.models.testCustom.useMutation({ onSuccess: result => { setTestOk(true); setTestMessage(result.message); }, onError: error => { setTestOk(false); setTestMessage(error.message); } });
  const updateSettings = trpc.workspace.updateSettings.useMutation({ onSuccess: async () => { await invalidate(); toast.success("AI provider updated."); }, onError: error => toast.error(error.message) });
  const customModels = settings.data?.customModels ?? [];
  const usingCustom = settings.data?.activeProvider === "custom" && settings.data?.activeCustomModelId !== null;
  const formComplete = name.trim().length > 0 && modelId.trim().length > 0 && baseUrl.trim().length > 0 && apiKey.trim().length > 0;
  const submitProvider = () => { if (!formComplete) { toast.error("Fill in the provider name, model ID, endpoint URL, and API key."); return; } createCustom.mutate({ name: name.trim(), modelId: modelId.trim(), baseUrl: baseUrl.trim(), compatibility: "openai", apiKey: apiKey.trim(), supportsImageInput }); };
  const testProvider = () => { setTestOk(null); setTestMessage(null); testCustom.mutate({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), modelId: modelId.trim() }); };
  return <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">AI provider</p><h2 className="mt-1 text-xl font-bold tracking-tight">Use your own AI provider</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Nova runs on its built-in AI gateway by default. Add an OpenAI-compatible provider with your own API key and every chat, automation, and background job runs on it instead. Your key is stored encrypted and is sent only to the provider you choose.</p></div><div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><KeyRound size={24} /></div></div>
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4"><div className="min-w-0"><p className="text-sm font-bold">Nova built-in AI</p><p className="truncate text-xs text-muted-foreground">Nova's managed gateway{gatewayStatus.data?.model ? ` (${gatewayStatus.data.model})` : ""}. Uses Nova's shared request allowance.</p></div>{!usingCustom ? <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Check size={14} /> Active</span> : <Button variant="outline" onClick={() => gatewayStatus.data?.model && updateSettings.mutate({ activeProvider: "mistral", activeModelId: gatewayStatus.data.model })} disabled={updateSettings.isPending || !gatewayStatus.data?.model}>{updateSettings.isPending && <Loader2 className="animate-spin" size={15} />} Use built-in</Button>}</div>
      {customModels.map(model => <div key={model.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4"><div className="min-w-0"><p className="truncate text-sm font-bold">{model.name} <span className="font-normal text-muted-foreground">({model.modelId})</span></p><p className="truncate text-xs text-muted-foreground">{model.baseUrl}{model.supportsImageInput ? " · image input" : ""}</p></div><div className="flex items-center gap-2">{settings.data?.activeCustomModelId === model.id ? <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Check size={14} /> Active</span> : <Button variant="outline" onClick={() => updateSettings.mutate({ activeProvider: "custom", activeCustomModelId: model.id })} disabled={updateSettings.isPending}>{updateSettings.isPending && <Loader2 className="animate-spin" size={15} />} Use this provider</Button>}<Button variant="ghost" size="icon" aria-label={`Remove ${model.name}`} onClick={() => { if (window.confirm(`Remove ${model.name}? Nova falls back to the built-in AI if it was active.`)) deleteCustom.mutate({ id: model.id }); }} disabled={deleteCustom.isPending} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button></div></div>)}
      {customModels.length === 0 && <p className="rounded-2xl border border-dashed bg-muted/10 p-4 text-xs text-muted-foreground">No own providers yet. Add one below - it works with OpenAI, OpenRouter, Groq, Together, DeepSeek, Mistral, Anthropic's OpenAI-compatible endpoint, or a local vLLM/Ollama server.</p>}
    </div>
    <div className="mt-6 space-y-4 rounded-2xl border bg-muted/20 p-4 sm:p-5">
      <div><p className="text-sm font-bold">Add your own provider</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The endpoint must be OpenAI-compatible: Nova calls {`{base URL}/chat/completions`} with your key as a Bearer token.</p></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="byok-name">Provider name</Label><Input id="byok-name" value={name} onChange={event => setName(event.target.value)} placeholder="My OpenRouter key" maxLength={120} /></div><div className="space-y-2"><Label htmlFor="byok-model">Model ID</Label><Input id="byok-model" value={modelId} onChange={event => setModelId(event.target.value)} placeholder="anthropic/claude-sonnet-4.5" maxLength={240} /></div></div>
      <div className="space-y-2"><Label htmlFor="byok-baseurl">Endpoint base URL</Label><Input id="byok-baseurl" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://openrouter.ai/api/v1" inputMode="url" maxLength={2048} /></div>
      <div className="space-y-2"><Label htmlFor="byok-apikey">API key</Label><Input id="byok-apikey" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="sk-..." maxLength={4096} autoComplete="off" /></div>
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 p-3"><div><p className="text-sm font-medium">Accepts image input</p><p className="text-xs text-muted-foreground">Turn on when the model can read images Nova attaches.</p></div><Switch checked={supportsImageInput} onCheckedChange={setSupportsImageInput} aria-label="Accepts image input" /></div>
      {testMessage !== null && <p className={`text-xs font-medium ${testOk ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}>{testMessage}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={testProvider} disabled={testCustom.isPending || !baseUrl.trim() || !apiKey.trim() || !modelId.trim()}>{testCustom.isPending && <Loader2 className="animate-spin" size={15} />} Test connection</Button><Button onClick={submitProvider} disabled={createCustom.isPending || !formComplete}>{createCustom.isPending && <Loader2 className="animate-spin" size={15} />} Add provider</Button></div>
    </div>
  </section>;
}

function TelegramBotCard() {
  const utils = trpc.useUtils(); const status = trpc.telegram.status.useQuery(undefined, { retry: false, refetchInterval: 3000 }); const [chatId, setChatId] = useState(""); const [testText, setTestText] = useState("Nova Telegram test message.");
  const refresh = () => utils.telegram.status.invalidate();
  const configure = trpc.telegram.configure.useMutation({ onSuccess: async data => { await refresh(); setChatId(data.chatId ?? ""); }, onError: error => toast.error(error.message) });
  const discover = trpc.telegram.discoverChat.useMutation({ onSuccess: async data => { await refresh(); setChatId(data.chatId ?? ""); toast.success("Telegram chat discovered and connected."); }, onError: error => toast.error(error.message) });
  const sendTest = trpc.telegram.sendTest.useMutation({ onSuccess: () => toast.success("Test message sent to Telegram."), onError: error => toast.error(error.message) });
  const remove = trpc.telegram.remove.useMutation({ onSuccess: async () => { await refresh(); setChatId(""); toast.success("Telegram disconnected. Nova lost access until you connect again."); }, onError: error => toast.error(error.message) });
  const configured = Boolean(status.data?.configured); const ready = Boolean(configured && status.data?.chatId); const webhookLinked = Boolean(configured && status.data?.webhook?.linked); const waitingForTelegram = configured && !status.data?.chatId;
  return <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Telegram Bot</p><h2 className="mt-1 text-xl font-bold tracking-tight">Send from your workspace</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Saving the bot token only configures the bot. Your Telegram account is connected only after Telegram sends Nova your chat.</p></div>{ready && <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Check size={14} /> Telegram connected</span>}{waitingForTelegram && <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700"><MessageCircle size={14} /> Waiting for Telegram</span>}{configured && !webhookLinked && <span className="inline-flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-700"><AlertTriangle size={14} /> Webhook not reachable</span>}</div><div className="mt-6 grid gap-5 lg:grid-cols-2"><div className="space-y-4 rounded-2xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><MessageCircle className="size-4 text-primary" /><p className="text-sm font-bold">{ready ? "Disconnect your Telegram account" : "Connect your Telegram account"}</p></div><p className="text-xs leading-5 text-muted-foreground">{ready ? "Telegram is connected. Disconnecting removes Nova\u2019s access and deletes the stored credentials - you can connect again any time." : "Connect Telegram secures the bot link and opens the chat with a secure link message pre-filled - send it and this chat links to your account automatically. Check connection then confirms the link."}</p>{ready ? <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => { if (window.confirm("Disconnect Telegram? Nova will lose access to this Telegram chat until you connect again.")) remove.mutate(); }} disabled={remove.isPending}>{(remove.isPending || status.isFetching) && <Loader2 className="animate-spin" size={15} />} Disconnect Telegram</Button> : <Button className="w-full" onClick={() => { const knownUsername = status.data?.botUsername ?? null; const knownCode = status.data?.linkCode ?? null; const openBot = (username: string, code: string) => window.open(`https://t.me/${username}?text=${encodeURIComponent(`/start nova_app_link_${code}`)}`, "_blank", "noopener"); if (knownUsername && knownCode) openBot(knownUsername, knownCode); void (async () => { const saved = await configure.mutateAsync({ chatId: chatId.trim() || null }).catch(() => null); if (!saved) return; const code = saved.linkCode ?? knownCode; if (!saved.botUsername || !code) { toast.error("The bot link details are unavailable, so Telegram could not be opened."); return; } if (!(knownUsername && knownCode)) openBot(saved.botUsername, code); toast.success("Connection secured. Send the pre-filled message in Telegram to link your account."); })(); }} disabled={configure.isPending}>{configure.isPending && <Loader2 className="animate-spin" size={15} />} Connect Telegram</Button>}{configured && !ready && <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => discover.mutate()} disabled={discover.isPending}>{discover.isPending && <Loader2 className="animate-spin" size={15} />} Check connection</Button><Button variant="ghost" size="icon" aria-label="Remove Telegram connection" onClick={() => remove.mutate()} disabled={remove.isPending} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button></div>}</div><div className="space-y-4 rounded-2xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#638f84]" /><p className="text-sm font-bold">Send a test</p></div><p className="text-xs leading-5 text-muted-foreground">{ready ? `Sending to chat ${status.data?.chatId}. Your Telegram account is connected.` : "Your Telegram chat is not connected yet. Authorize the bot first."}</p><Textarea value={testText} onChange={event => setTestText(event.target.value)} className="min-h-28" maxLength={4096} disabled={!ready} /><Button variant="outline" className="w-full" onClick={() => sendTest.mutate({ text: testText })} disabled={!ready || !testText.trim() || sendTest.isPending}>{sendTest.isPending && <Loader2 className="animate-spin" size={15} />} <Send size={15} /> Send test message</Button></div></div></section>;
}

function ConnectorCard({ toolkit }: { toolkit: "github" | "gmail" }) {
  const utils = trpc.useUtils();
  const status = trpc.composio.status.useQuery(undefined, { retry: false, refetchInterval: 15000 });
  const connect = trpc.composio.connect.useMutation({
    onSuccess: async result => {
      window.open(result.redirectUrl, "_blank", "noopener");
      toast.success(`${toolkit === "github" ? "GitHub" : "Gmail"} authorization opened. Finish it in the new tab, then check the status here.`);
      await utils.composio.status.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const disconnect = trpc.composio.disconnect.useMutation({
    onSuccess: async () => {
      toast.success(`${label} disconnected. Nova lost access until you connect again.`);
      await utils.composio.status.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const entry = status.data?.toolkits?.[toolkit];
  const configured = entry?.configured ?? false;
  const connected = entry?.connected ?? false;
  const errored = entry?.status === "error";
  const keyLength = status.data?.keyLength ?? 0;
  const label = toolkit === "github" ? "GitHub" : "Gmail";
  const blurb = toolkit === "github"
    ? "Connect GitHub through Composio and Nova can work with your repositories, issues and pull requests straight from chat - starred repos, filed issues, opened PRs."
    : "Connect Gmail through Composio and Nova can search your inbox, draft, send and reply to email straight from chat.";
  const hint = toolkit === "github"
    ? "Try asking Nova to star a repo or file an issue."
    : "Try asking Nova to search your inbox or send an email.";
  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Connectors</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">{label}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{blurb}</p>
        </div>
        {connected && <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Check size={14} /> {label} connected</span>}
        {errored && <span className="inline-flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-700 dark:bg-red-500/10 dark:text-red-300"><AlertTriangle size={14} /> Composio rejected the key</span>}
        {!connected && !errored && configured && <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700">{toolkit === "github" ? <Github size={14} /> : <Mail size={14} />} Not connected</span>}
        {!configured && <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground"><AlertTriangle size={14} /> Composio key missing</span>}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
          <div className="flex items-center gap-2">{toolkit === "github" ? <Github className="size-4 text-primary" /> : <Mail className="size-4 text-primary" />}<p className="text-sm font-bold">{connected ? `Disconnect your ${label} account` : `Connect your ${label} account`}</p></div>
          <p className="text-xs leading-5 text-muted-foreground">
            {errored
              ? `The server has a ${keyLength}-character COMPOSIO_API_KEY, but Composio refused it. If the key was pasted in its masked form it will be far too short - paste the full key from the Composio API-keys screen.`
              : connected
                ? `${label} is connected. Disconnecting removes Nova's access and deletes the stored credentials - you can connect again any time.`
                : configured
                  ? `Authorization runs through Composio's secure hosted page - your ${label} credentials never touch Nova's servers.`
                  : "The server owner needs to set COMPOSIO_API_KEY before connectors can be connected."}
          </p>
          {connected ? (
            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm(`Disconnect ${label}? Nova will lose access to this ${label} account until you connect again.`))
                  disconnect.mutate({ toolkit });
              }}
              disabled={disconnect.isPending}
            >
              {(disconnect.isPending || status.isFetching) && <Loader2 className="animate-spin" size={15} />} Disconnect {label}
            </Button>
          ) : (
            <Button className="w-full" onClick={() => connect.mutate({ toolkit })} disabled={!configured || connect.isPending}>
              {(connect.isPending || status.isFetching) && <Loader2 className="animate-spin" size={15} />} Connect {label}
            </Button>
          )}
        </div>
        <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
          <div className="flex items-center gap-2"><RefreshCw className="size-4 text-[#638f84]" /><p className="text-sm font-bold">Check status</p></div>
          <p className="text-xs leading-5 text-muted-foreground">
            {connected ? `${label} is connected - Nova can use it right now. ${hint}` : "After you finish the authorization in the other tab, the status here updates automatically."}
          </p>
          <Button variant="outline" className="w-full" onClick={() => void status.refetch()} disabled={status.isFetching}>
            {status.isFetching && <Loader2 className="animate-spin" size={15} />} Refresh status
          </Button>
        </div>
      </div>
    </section>
  );
}
