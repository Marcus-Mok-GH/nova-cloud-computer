/** Nova model settings: workspace rules and private model endpoint configuration, never exposing saved API keys. */
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Bot, Check, Eye, KeyRound, Loader2, LogOut, MessageCircle, Plus, Send, ShieldCheck, Sparkles, Trash2, UserX } from "lucide-react";
import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const providerOptions = [
  { id: "anthropic" as const, name: "Anthropic", detail: "Claude family", modelId: "claude-sonnet" },
  { id: "openai" as const, name: "OpenAI", detail: "GPT family", modelId: "gpt-4.1" },
  { id: "gemini" as const, name: "Google Gemini", detail: "Gemini family", modelId: "gemini-2.5-pro" },
];

export default function WorkspaceSettings() {
  const utils = trpc.useUtils();
  const settings = trpc.workspace.modelSettings.useQuery(undefined, { retry: false });
  const [rules, setRules] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [compatibility, setCompatibility] = useState<"openai" | "anthropic">("openai");
  const [apiKey, setApiKey] = useState("");
  const [supportsImageInput, setSupportsImageInput] = useState(false);

  useEffect(() => { if (settings.data) setRules(settings.data.workspaceRules ?? ""); }, [settings.data]);
  const customModels = settings.data?.customModels ?? [];
  const selectedCustomModel = useMemo(() => customModels.find(model => model.id === settings.data?.activeCustomModelId), [customModels, settings.data?.activeCustomModelId]);
  const refresh = async () => { await Promise.all([utils.workspace.modelSettings.invalidate(), utils.workspace.dashboard.invalidate()]); };
  const updateSettings = trpc.workspace.updateSettings.useMutation({ onSuccess: async () => { await refresh(); toast.success("Workspace settings saved."); }, onError: error => toast.error(error.message) });
  const createCustom = trpc.models.createCustom.useMutation({ onSuccess: async model => { await refresh(); setCustomName(""); setModelId(""); setBaseUrl(""); setApiKey(""); setSupportsImageInput(false); setCustomOpen(false); updateSettings.mutate({ activeProvider: "custom", activeCustomModelId: model.id, activeModelId: model.modelId }); toast.success("Custom model saved privately to this workspace."); }, onError: error => toast.error(error.message) });
  const deleteCustom = trpc.models.deleteCustom.useMutation({ onSuccess: async () => { await refresh(); toast.success("Custom model removed."); }, onError: error => toast.error(error.message) });

  const saveRules = () => updateSettings.mutate({ workspaceRules: rules.trim() || null });
  const selectProvider = (provider: typeof providerOptions[number]) => updateSettings.mutate({ activeProvider: provider.id, activeModelId: provider.modelId, activeCustomModelId: null });
  const selectCustom = (id: number, selectedModelId: string) => updateSettings.mutate({ activeProvider: "custom", activeCustomModelId: id, activeModelId: selectedModelId });
  const submitCustom = (event: FormEvent) => { event.preventDefault(); createCustom.mutate({ name: customName, modelId, baseUrl, compatibility, apiKey, supportsImageInput }); };

  if (settings.isLoading) return <DashboardLayout><div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div></DashboardLayout>;
  if (settings.isError) return <DashboardLayout><div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center"><section className="rounded-3xl border bg-card p-8 text-center"><Sparkles className="mx-auto text-[#75a79a]" size={24} /><h1 className="mt-4 font-[DM_Serif_Display] text-3xl">Settings could not load.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Your saved model choices have not been changed. Check your connection and try again.</p><Button className="mt-6" onClick={() => settings.refetch()}>Try again</Button></section></div></DashboardLayout>;

  return <DashboardLayout><div className="mx-auto max-w-5xl space-y-7 pb-12 pt-3">
    <section className="relative overflow-hidden rounded-3xl border border-stone-200 bg-[#f2f2ea] px-6 py-8 shadow-sm dark:border-white/10 dark:bg-[#1d292a] sm:px-9 sm:py-10"><div className="absolute -right-12 -top-20 h-64 w-64 rounded-full bg-[#b6d7d0]/60 blur-3xl dark:bg-[#3d807a]/35" /><div className="relative"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-stone-500 dark:text-stone-300">Your personal cloud</p><h1 className="mt-3 font-[DM_Serif_Display] text-4xl tracking-tight text-stone-800 dark:text-stone-100 sm:text-5xl">Preferences with a memory.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-300">Choose a model preference and give Nova the standing rules that make your workspace feel like yours. Custom endpoint credentials are encrypted before they are saved and are never displayed again.</p></div></section>

    <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Assistant preference</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Choose a model home</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">This is your workspace preference. It becomes the default whenever Nova’s assistant features are connected to a model.</p></div>{selectedCustomModel && settings.data?.activeProvider === "custom" && <span className="inline-flex items-center gap-2 rounded-full bg-[#e4f0eb] px-3 py-1.5 text-xs font-bold text-[#42665d] dark:bg-[#28473f] dark:text-[#c5e1d6]"><Check size={14} /> {selectedCustomModel.name} active</span>}</div><div className="mt-6 grid gap-3 md:grid-cols-3">{providerOptions.map(provider => { const active = settings.data?.activeProvider === provider.id; return <button type="button" key={provider.id} onClick={() => selectProvider(provider)} className={`rounded-2xl border p-4 text-left transition-all ${active ? "border-[#729b90] bg-[#eaf2ed] shadow-sm dark:border-[#6f9d90] dark:bg-[#274138]" : "border-border bg-muted/25 hover:bg-muted/55"}`}><div className="flex items-center justify-between"><span className="font-bold">{provider.name}</span>{active && <Check size={16} className="text-[#598277]" />}</div><p className="mt-2 text-xs text-muted-foreground">{provider.detail}</p><p className="mt-4 font-mono text-[10px] text-muted-foreground">{provider.modelId}</p></button>; })}</div></section>

    <section className="grid gap-7 lg:grid-cols-[.82fr_1.18fr]"><div className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-6"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Workspace rules</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">How Nova should help</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Save standing preferences for future assistant experiences. Keep important approval boundaries and working style here.</p><Textarea className="mt-5 min-h-44 resize-y" value={rules} onChange={event => setRules(event.target.value)} placeholder="For example: Keep status updates concise. Always show a draft before sending anything outside this workspace." maxLength={8000} /><div className="mt-4 flex justify-end"><Button onClick={saveRules} disabled={updateSettings.isPending}>{updateSettings.isPending && <Loader2 size={15} className="animate-spin" />} Save rules</Button></div></div>
      <div className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Custom endpoints</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Bring your own model</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Add as many private endpoints as you need. Each stores its own endpoint compatibility and image-input capability.</p></div><CustomModelDialog open={customOpen} onOpenChange={setCustomOpen} name={customName} modelId={modelId} baseUrl={baseUrl} compatibility={compatibility} apiKey={apiKey} supportsImageInput={supportsImageInput} onNameChange={setCustomName} onModelIdChange={setModelId} onBaseUrlChange={setBaseUrl} onCompatibilityChange={setCompatibility} onApiKeyChange={setApiKey} onSupportsImageChange={setSupportsImageInput} onSubmit={submitCustom} loading={createCustom.isPending} /></div><div className="mt-6 space-y-3">{customModels.length ? customModels.map(model => { const active = settings.data?.activeProvider === "custom" && settings.data.activeCustomModelId === model.id; return <article key={model.id} className={`rounded-2xl border p-4 ${active ? "border-[#729b90] bg-[#eaf2ed] dark:border-[#6f9d90] dark:bg-[#274138]" : "border-border bg-muted/25"}`}><div className="flex items-start gap-3"><div className="mt-0.5 rounded-xl bg-background p-2 text-[#638f84]"><Bot size={17} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{model.name}</h3>{active && <span className="rounded-full bg-[#cce5da] px-2 py-0.5 text-[9px] font-bold text-[#3f655b] dark:bg-[#416c60] dark:text-[#d8f2e7]">Active</span>}</div><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{model.modelId} · {model.compatibility}-compatible</p><div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold text-muted-foreground"><span className="inline-flex items-center gap-1"><KeyRound size={11} /> key saved privately</span>{model.supportsImageInput && <span className="inline-flex items-center gap-1"><Eye size={11} /> accepts images</span>}</div></div><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => selectCustom(model.id, model.modelId)} disabled={updateSettings.isPending}>{active ? "Selected" : "Use"}</Button><Button variant="ghost" size="icon" aria-label={`Remove ${model.name}`} onClick={() => deleteCustom.mutate({ id: model.id })} disabled={deleteCustom.isPending} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button></div></div></article>; }) : <div className="rounded-2xl border border-dashed px-5 py-10 text-center"><Bot className="mx-auto text-[#75a79a]" size={22} /><p className="mt-3 font-[DM_Serif_Display] text-2xl">Your own connection point.</p><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Add a compatible endpoint to make it part of this personal workspace.</p></div>}</div></div></section>
    <TelegramBotCard />
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
  return <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Telegram Bot</p><h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Send from your workspace</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Nova encrypts your BotFather token before storage and never displays it again. Telegram requires a destination chat: either paste its ID or message your bot with <code>/start</code> and let Nova discover it.</p></div>{ready && <span className="inline-flex items-center gap-2 rounded-full bg-[#e4f0eb] px-3 py-1.5 text-xs font-bold text-[#42665d] dark:bg-[#28473f] dark:text-[#c5e1d6]"><Check size={14} /> Ready to send</span>}</div>
    <div className="mt-6 grid gap-5 lg:grid-cols-2"><div className="space-y-4 rounded-2xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><MessageCircle className="size-4 text-sky-500" /><p className="text-sm font-bold">Connect your bot</p></div><Field label="Bot token" htmlFor="telegram-token"><Input id="telegram-token" type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} placeholder={status.data?.configured ? "Saved privately — paste a new token to replace" : "123456:ABC…"} /></Field><Field label="Chat ID (optional)" htmlFor="telegram-chat-id"><Input id="telegram-chat-id" value={chatId} onChange={event => setChatId(event.target.value)} placeholder="Paste a chat ID or discover it after /start" /></Field><Button className="w-full" onClick={() => configure.mutate({ botToken: token, chatId: chatId.trim() || null })} disabled={!token.trim() || configure.isPending}>{configure.isPending && <Loader2 className="animate-spin" size={15} />} Validate & save token</Button>{status.data?.configured && <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => discover.mutate()} disabled={discover.isPending}>{discover.isPending && <Loader2 className="animate-spin" size={15} />} Discover chat</Button><Button variant="ghost" size="icon" aria-label="Remove Telegram connection" onClick={() => remove.mutate()} disabled={remove.isPending} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button></div>}</div>
      <div className="space-y-4 rounded-2xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#638f84]" /><p className="text-sm font-bold">Send a test</p></div><p className="text-xs leading-5 text-muted-foreground">{ready ? `Sending to chat ${status.data?.chatId}. Your bot${status.data?.botUsername ? ` is @${status.data.botUsername}` : ""} is connected.` : "First save a valid bot token. Then message the bot in Telegram and use Discover chat."}</p><Textarea value={testText} onChange={event => setTestText(event.target.value)} className="min-h-28" maxLength={4096} disabled={!ready} /><Button variant="outline" className="w-full" onClick={() => sendTest.mutate({ text: testText })} disabled={!ready || !testText.trim() || sendTest.isPending}>{sendTest.isPending && <Loader2 className="animate-spin" size={15} />} <Send size={15} /> Send test message</Button></div></div></section>;
}

function CustomModelDialog({ open, onOpenChange, name, modelId, baseUrl, compatibility, apiKey, supportsImageInput, onNameChange, onModelIdChange, onBaseUrlChange, onCompatibilityChange, onApiKeyChange, onSupportsImageChange, onSubmit, loading }: { open: boolean; onOpenChange: (open: boolean) => void; name: string; modelId: string; baseUrl: string; compatibility: "openai" | "anthropic"; apiKey: string; supportsImageInput: boolean; onNameChange: (value: string) => void; onModelIdChange: (value: string) => void; onBaseUrlChange: (value: string) => void; onCompatibilityChange: (value: "openai" | "anthropic") => void; onApiKeyChange: (value: string) => void; onSupportsImageChange: (value: boolean) => void; onSubmit: (event: FormEvent) => void; loading: boolean }) { return <Dialog open={open} onOpenChange={onOpenChange}><DialogTrigger asChild><Button className="shrink-0 rounded-full"><Plus size={15} /> Add model</Button></DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl"><form onSubmit={onSubmit}><DialogHeader><DialogTitle className="font-[DM_Serif_Display] text-3xl">Add a private endpoint</DialogTitle><DialogDescription>Nova encrypts the API key before it is saved. For safety, it will never be displayed again after this form is submitted.</DialogDescription></DialogHeader><div className="mt-5 grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Display name" htmlFor="custom-name"><Input id="custom-name" value={name} onChange={event => onNameChange(event.target.value)} placeholder="Studio endpoint" required maxLength={120} /></Field><Field label="Model ID" htmlFor="custom-model-id"><Input id="custom-model-id" value={modelId} onChange={event => onModelIdChange(event.target.value)} placeholder="model-name-or-id" required maxLength={240} /></Field></div><Field label="Base URL" htmlFor="custom-base-url"><Input id="custom-base-url" value={baseUrl} onChange={event => onBaseUrlChange(event.target.value)} placeholder="https://api.example.com/v1" type="url" required maxLength={2048} /></Field><div className="rounded-2xl border bg-muted/35 p-4"><p className="text-sm font-bold">Endpoint compatibility</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => onCompatibilityChange("openai")} className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold ${compatibility === "openai" ? "border-[#729b90] bg-[#eaf2ed] text-[#456c61] dark:bg-[#274138] dark:text-[#d7eee4]" : "border-border bg-background"}`}>OpenAI-compatible</button><button type="button" onClick={() => onCompatibilityChange("anthropic")} className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold ${compatibility === "anthropic" ? "border-[#729b90] bg-[#eaf2ed] text-[#456c61] dark:bg-[#274138] dark:text-[#d7eee4]" : "border-border bg-background"}`}>Anthropic-compatible</button></div></div><Field label="API key" htmlFor="custom-api-key"><Input id="custom-api-key" value={apiKey} onChange={event => onApiKeyChange(event.target.value)} placeholder="Paste the key once" type="password" autoComplete="new-password" required maxLength={4096} /></Field><div className="flex items-center justify-between rounded-2xl border p-4"><div><p className="text-sm font-bold">Image input</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Turn this on only if this model accepts image attachments.</p></div><Switch checked={supportsImageInput} onCheckedChange={onSupportsImageChange} aria-label="Model supports image input" /></div></div><DialogFooter className="mt-6"><Button type="submit" disabled={loading}>{loading && <Loader2 size={15} className="animate-spin" />} Save private model</Button></DialogFooter></form></DialogContent></Dialog>; }

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) { return <div className="space-y-2"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>; }
