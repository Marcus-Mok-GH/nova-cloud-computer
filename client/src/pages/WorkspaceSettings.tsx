/** Nova settings: workspace preferences, Telegram, user-created automations, and account management. */
import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import UserAutomationsCard from "@/components/UserAutomationsCard";
import ApiKeysCard from "@/components/ApiKeysCard";
import PersonalisationCard from "@/components/PersonalisationCard";
import MemoryCard from "@/components/MemoryCard";
import BillingCard from "@/components/BillingCard";
import ThemeCard from "@/components/ThemeCard";
import LanguageCard from "@/components/LanguageCard";
import { useTranslation } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/i18n";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Brain, Check, Clipboard, CreditCard, Github, KeyRound, KeySquare, Loader2, LogOut, Mail, MessageCircle, Plug, RefreshCw, Rocket, Send, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, UserCircle, UserX, Variable } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/** Tab bar sections for the settings page. Each panel is kept mounted but hidden when inactive. */
const settingsTabs: ReadonlyArray<{ id: string; labelKey: TranslationKey; icon: typeof SlidersHorizontal }> = [
  { id: "general", labelKey: "settings.tabs.general", icon: SlidersHorizontal },
  { id: "personalisation", labelKey: "settings.tabs.personalisation", icon: Brain },
  { id: "ai", labelKey: "settings.tabs.ai", icon: KeyRound },
  { id: "connections", labelKey: "settings.tabs.connections", icon: Plug },
  { id: "environment", labelKey: "settings.tabs.environment", icon: Variable },
  { id: "automations", labelKey: "settings.tabs.automations", icon: Sparkles },
  { id: "api", labelKey: "settings.tabs.api", icon: KeySquare },
  { id: "billing", labelKey: "settings.tabs.billing", icon: CreditCard },
  { id: "account", labelKey: "settings.tabs.account", icon: UserCircle },
];

export default function WorkspaceSettings() {
  const utils = trpc.useUtils();
  const { t } = useTranslation();
  const settings = trpc.workspace.modelSettings.useQuery(undefined, { retry: false });
  const [rules, setRules] = useState("");
  const [activeTab, setActiveTab] = useState<(typeof settingsTabs)[number]["id"]>("general");
  useEffect(() => { if (settings.data) setRules(settings.data.workspaceRules ?? ""); }, [settings.data]);
  const updateSettings = trpc.workspace.updateSettings.useMutation({ onSuccess: async () => { await Promise.all([utils.workspace.modelSettings.invalidate(), utils.workspace.dashboard.invalidate()]); toast.success(t("settings.rules.saved")); }, onError: error => toast.error(error.message) });
  if (settings.isLoading) return <DashboardLayout><div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div></DashboardLayout>;
  if (settings.isError) return <DashboardLayout><div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center"><section className="rounded-2xl border bg-card p-8 text-center shadow-[0_4px_14px_rgba(10,10,10,0.05)]"><Sparkles className="mx-auto text-primary" size={24} /><h1 className="mt-4 text-2xl font-extrabold tracking-tight">{t("settings.loadError.title")}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{t("settings.loadError.body")}</p><Button className="mt-6" onClick={() => settings.refetch()}>{t("common.tryAgain")}</Button></section></div></DashboardLayout>;
  return <DashboardLayout><div className="relative mx-auto max-w-5xl space-y-7 pb-12 pt-6">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-primary/[0.045] to-transparent dark:from-primary/[0.07]" />
    <section className="rise-in relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-8 shadow-[0_4px_14px_rgba(10,10,10,0.05)] dark:border-white/10 dark:bg-card sm:px-9 sm:py-10"><div className="relative"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">{t("settings.hero.eyebrow")}</p><h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground dark:text-foreground sm:text-3xl">{t("settings.hero.title")}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground dark:text-muted-foreground">{t("settings.hero.subtitle")}</p></div></section>
    <nav role="tablist" aria-label={t("settings.tabsLabel")} className="rise-in relative flex gap-1 overflow-x-auto rounded-2xl border bg-card p-1.5 shadow-[0_4px_14px_rgba(10,10,10,0.05)]">
      {settingsTabs.map(tab => <button key={tab.id} type="button" role="tab" id={`settings-tab-${tab.id}`} aria-selected={activeTab === tab.id} aria-controls={`settings-panel-${tab.id}`} onClick={() => setActiveTab(tab.id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60 ${activeTab === tab.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}><tab.icon className="size-4 shrink-0" />{t(tab.labelKey)}</button>)}
    </nav>
    <div role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general" className={activeTab === "general" ? "space-y-7" : "hidden"}><section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{t("settings.rules.eyebrow")}</p><h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.rules.title")}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{t("settings.rules.body")}</p><Textarea className="mt-5 min-h-44 resize-y" value={rules} onChange={event => setRules(event.target.value)} placeholder={t("settings.rules.placeholder")} maxLength={8000} /><div className="mt-4 flex justify-end"><Button onClick={() => updateSettings.mutate({ workspaceRules: rules.trim() || null })} disabled={updateSettings.isPending}>{updateSettings.isPending && <Loader2 size={15} className="animate-spin" />} {t("settings.rules.save")}</Button></div></section><LanguageCard /><ThemeCard /></div>
    <div role="tabpanel" id="settings-panel-personalisation" aria-labelledby="settings-tab-personalisation" className={activeTab === "personalisation" ? "space-y-7" : "hidden"}><PersonalisationCard /><MemoryCard /></div>
    <div role="tabpanel" id="settings-panel-ai" aria-labelledby="settings-tab-ai" className={activeTab === "ai" ? "space-y-7" : "hidden"}><ModelProviderCard /></div>
    <div role="tabpanel" id="settings-panel-connections" aria-labelledby="settings-tab-connections" className={activeTab === "connections" ? "space-y-7" : "hidden"}><TelegramBotCard /><CodexConnectorCard enabled={activeTab === "connections"} /><ConnectorCard toolkit="github" /><ConnectorCard toolkit="gmail" /><ConnectorCard toolkit="vercel" /></div>
    <div role="tabpanel" id="settings-panel-environment" aria-labelledby="settings-tab-environment" className={activeTab === "environment" ? "space-y-7" : "hidden"}><EnvironmentVarsCard /></div>
    <div role="tabpanel" id="settings-panel-automations" aria-labelledby="settings-tab-automations" className={activeTab === "automations" ? "space-y-7" : "hidden"}><UserAutomationsCard /></div>
    <div role="tabpanel" id="settings-panel-api" aria-labelledby="settings-tab-api" className={activeTab === "api" ? "space-y-7" : "hidden"}><ApiKeysCard /></div>
    <div role="tabpanel" id="settings-panel-billing" aria-labelledby="settings-tab-billing" className={activeTab === "billing" ? "space-y-7" : "hidden"}><BillingCard /></div>
    <div role="tabpanel" id="settings-panel-account" aria-labelledby="settings-tab-account" className={activeTab === "account" ? "space-y-7" : "hidden"}><AccountManagementCard /><FactoryResetCard /></div>
  </div></DashboardLayout>;
}

/**
 * Danger-zone card: factory reset. Deletes every workspace file and folder,
 * cancels running agent jobs, and replaces the persistent VM with a fresh
 * machine. Chats, settings, and the account itself are untouched.
 */
function FactoryResetCard() {
  const utils = trpc.useUtils();
  const { t, tPlural } = useTranslation();
  const [resetDialogOpen, setResetDialogOpen] = useState(false); const [confirmText, setConfirmText] = useState("");
  const factoryReset = trpc.workspace.factoryReset.useMutation({
    onSuccess: async result => {
      setResetDialogOpen(false); setConfirmText("");
      await Promise.all([utils.workspace.computer.invalidate(), utils.workspace.dashboard.invalidate()]);
      toast.success(t("settings.factoryReset.success", {
        files: tPlural("settings.factoryReset.files.one", "settings.factoryReset.files.other", result.deletedFiles),
        folders: tPlural("settings.factoryReset.folders.one", "settings.factoryReset.folders.other", result.deletedFolders),
        jobs: tPlural("settings.factoryReset.jobs.one", "settings.factoryReset.jobs.other", result.cancelledRuns),
      }));
    },
    onError: error => toast.error(error.message || t("settings.factoryReset.error"))
  });
  return <section className="rise-in rounded-2xl border border-red-500/20 bg-red-500/[0.03] p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-red-600">{t("settings.factoryReset.eyebrow")}</p><h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.factoryReset.title")}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("settings.factoryReset.body")}</p></div><div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 ring-1 ring-red-500/15"><RefreshCw size={22} /></div></div>
    <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/5 p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-bold text-red-600">{t("settings.factoryReset.box.title")}</p><p className="text-xs text-muted-foreground">{t("settings.factoryReset.box.body")}</p></div><AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}><AlertDialogTrigger asChild><Button variant="destructive" className="gap-2"><RefreshCw size={16} /> {t("settings.factoryReset.button")}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("settings.factoryReset.dialog.title")}</AlertDialogTitle><AlertDialogDescription>{t("settings.factoryReset.dialog.body")}</AlertDialogDescription></AlertDialogHeader><Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={t("settings.factoryReset.dialog.placeholder")} /><AlertDialogFooter><AlertDialogCancel disabled={factoryReset.isPending}>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction disabled={confirmText !== "RESET" || factoryReset.isPending} onClick={e => { e.preventDefault(); factoryReset.mutate({ confirm: confirmText }); }}>{factoryReset.isPending && <Loader2 size={15} className="animate-spin" />} {t("settings.factoryReset.dialog.confirm")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>
  </section>;
}

/**
 * Renders the account management card with user profile information, sign-out, and account deletion controls.
 */
function AccountManagementCard() {
  const { user, logout } = useAuth();
  const { t, locale } = useTranslation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false); const [confirmText, setConfirmText] = useState("");
  const [deleteStage, setDeleteStage] = useState<"confirm" | "verify">("confirm"); const [deletionCode, setDeletionCode] = useState("");
  const resetDeletionDialog = () => { setDeleteDialogOpen(false); setConfirmText(""); setDeletionCode(""); setDeleteStage("confirm"); };
  const requestDeletionCodeMutation = trpc.auth.requestDeletionCode.useMutation({
    onSuccess: result => { setDeleteStage("verify"); toast.success(t("settings.account.delete.codeSent", { email: result.email })); },
    onError: error => toast.error(error.message || t("settings.account.delete.codeError"))
  });
  const confirmDeleteMutation = trpc.auth.confirmDeleteAccount.useMutation({ onSuccess: async () => { toast.success(t("settings.account.delete.success")); resetDeletionDialog(); await logout(); window.location.assign("/sign-in"); }, onError: error => toast.error(error.message || t("settings.account.delete.error")) });
  const accountName = user?.name || t("settings.account.defaultName"); const accountEmail = user?.email || t("settings.account.noEmail"); const memberSince = user?.createdAt ? new Date(user.createdAt).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }) : t("settings.account.memberSince.unknown");
  const copyEmail = async () => { if (!user?.email || !navigator.clipboard) return; try { await navigator.clipboard.writeText(user.email); toast.success(t("settings.account.email.copied")); } catch { toast.error(t("settings.account.email.copyError")); } };
  return <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{t("settings.account.eyebrow")}</p><h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.account.title")}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("settings.account.body")}</p></div><div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><UserCircle size={24} /></div></div>
    <div className="mt-6 rounded-2xl border bg-muted/20 p-5"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-background text-sm font-bold uppercase shadow-[0_4px_14px_rgba(10,10,10,0.05)]">{accountName.slice(0, 1)}</div><div className="min-w-0"><p className="truncate text-lg font-bold">{accountName}</p><p className="text-xs text-muted-foreground">{t("settings.account.memberSince", { date: memberSince })}</p></div></div><div className="mt-5 space-y-4"><div className="space-y-2"><Label htmlFor="profile-email">{t("settings.account.email.label")}</Label><div className="flex gap-2"><Input id="profile-email" value={accountEmail} readOnly className="bg-background" />{user?.email && <Button variant="outline" size="icon" onClick={copyEmail} aria-label={t("settings.account.email.copy.aria")}><Clipboard size={15} /></Button>}</div></div></div></div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-muted/20 p-5"><div><p className="text-sm font-bold">{t("settings.account.signOut.title")}</p><p className="text-xs text-muted-foreground">{t("settings.account.signOut.loggedInAs", { email: accountEmail })}</p></div><Button variant="outline" onClick={() => logout()} className="gap-2"><LogOut size={16} /> {t("settings.account.signOut.button")}</Button></div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-5"><div><p className="text-sm font-bold text-red-600">{t("settings.account.delete.title")}</p><p className="text-xs text-muted-foreground">{t("settings.account.delete.body")}</p></div><AlertDialog open={deleteDialogOpen} onOpenChange={open => { if (!open) resetDeletionDialog(); setDeleteDialogOpen(open); }}><AlertDialogTrigger asChild><Button variant="destructive" className="gap-2"><UserX size={16} /> {t("settings.account.delete.button")}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleteStage === "confirm" ? t("settings.account.delete.dialog.titleConfirm") : t("settings.account.delete.dialog.titleVerify")}</AlertDialogTitle><AlertDialogDescription>{deleteStage === "confirm" ? t("settings.account.delete.dialog.descConfirm") : t("settings.account.delete.dialog.descVerify", { email: accountEmail })}</AlertDialogDescription></AlertDialogHeader>{deleteStage === "confirm" ? (<><Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={t("settings.account.delete.dialog.placeholder")} /><AlertDialogFooter><AlertDialogCancel disabled={requestDeletionCodeMutation.isPending}>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction disabled={confirmText !== "DELETE" || requestDeletionCodeMutation.isPending} onClick={e => { e.preventDefault(); requestDeletionCodeMutation.mutate(); }}>{requestDeletionCodeMutation.isPending && <Loader2 size={15} className="animate-spin" />} {t("settings.account.delete.dialog.emailCode")}</AlertDialogAction></AlertDialogFooter></>) : (<><Input value={deletionCode} onChange={e => setDeletionCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="text-center text-lg tracking-[0.4em]" /><AlertDialogFooter><AlertDialogCancel disabled={confirmDeleteMutation.isPending} onClick={() => resetDeletionDialog()}>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction disabled={deletionCode.length !== 6 || confirmDeleteMutation.isPending} onClick={e => { e.preventDefault(); confirmDeleteMutation.mutate({ code: deletionCode }); }}>{confirmDeleteMutation.isPending && <Loader2 size={15} className="animate-spin" />} {t("settings.account.delete.dialog.confirmButton")}</AlertDialogAction></AlertDialogFooter></>)}</AlertDialogContent></AlertDialog></div>
  </section>;
}

/**
 * BYOK: choose between Nova's built-in AI gateway and the workspace's own
 * OpenAI-compatible providers (user-supplied API keys, encrypted at rest).
 */
function ModelProviderCard() {
  const utils = trpc.useUtils();
  const { t } = useTranslation();
  const settings = trpc.workspace.modelSettings.useQuery(undefined, { retry: false });
  const gatewayStatus = trpc.ai.status.useQuery(undefined, { retry: false });
  const [name, setName] = useState(""); const [modelId, setModelId] = useState(""); const [baseUrl, setBaseUrl] = useState(""); const [apiKey, setApiKey] = useState(""); const [supportsImageInput, setSupportsImageInput] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null); const [testOk, setTestOk] = useState<boolean | null>(null);
  const invalidate = async () => { await Promise.all([utils.workspace.modelSettings.invalidate(), utils.workspace.dashboard.invalidate()]); };
  const createCustom = trpc.models.createCustom.useMutation({ onSuccess: async () => { setName(""); setModelId(""); setBaseUrl(""); setApiKey(""); setSupportsImageInput(false); setTestMessage(null); setTestOk(null); await invalidate(); toast.success(t("settings.byok.saved")); }, onError: error => toast.error(error.message) });
  const deleteCustom = trpc.models.deleteCustom.useMutation({ onSuccess: async () => { await invalidate(); toast.success(t("settings.byok.removed")); }, onError: error => toast.error(error.message) });
  const testCustom = trpc.models.testCustom.useMutation({ onSuccess: result => { setTestOk(true); setTestMessage(result.message); }, onError: error => { setTestOk(false); setTestMessage(error.message); } });
  const updateSettings = trpc.workspace.updateSettings.useMutation({ onSuccess: async () => { await invalidate(); toast.success(t("settings.byok.updated")); }, onError: error => toast.error(error.message) });
  const customModels = settings.data?.customModels ?? [];
  const usingCustom = settings.data?.activeProvider === "custom" && settings.data?.activeCustomModelId !== null;
  const formComplete = name.trim().length > 0 && modelId.trim().length > 0 && baseUrl.trim().length > 0 && apiKey.trim().length > 0;
  const submitProvider = () => { if (!formComplete) { toast.error(t("settings.byok.fillAll")); return; } createCustom.mutate({ name: name.trim(), modelId: modelId.trim(), baseUrl: baseUrl.trim(), compatibility: "openai", apiKey: apiKey.trim(), supportsImageInput }); };
  const testProvider = () => { setTestOk(null); setTestMessage(null); testCustom.mutate({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), modelId: modelId.trim() }); };
  return <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{t("settings.byok.eyebrow")}</p><h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.byok.title")}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("settings.byok.body")}</p></div><div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><KeyRound size={24} /></div></div>
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4"><div className="min-w-0"><p className="text-sm font-bold">{t("settings.byok.builtin.name")}</p><p className="truncate text-xs text-muted-foreground">{gatewayStatus.data?.model ? t("settings.byok.builtin.descWithModel", { model: gatewayStatus.data.model }) : t("settings.byok.builtin.desc")}</p></div>{!usingCustom ? <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Check size={14} /> {t("common.active")}</span> : <Button variant="outline" onClick={() => updateSettings.mutate({ activeProvider: "mistral", activeCustomModelId: null })} disabled={updateSettings.isPending}>{updateSettings.isPending && <Loader2 className="animate-spin" size={15} />} {t("settings.byok.builtin.use")}</Button>}</div>
      {customModels.map(model => <div key={model.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4"><div className="min-w-0"><p className="truncate text-sm font-bold">{model.name} <span className="font-normal text-muted-foreground">({model.modelId})</span></p><p className="truncate text-xs text-muted-foreground">{model.baseUrl}{model.supportsImageInput ? ` · ${t("settings.byok.imageInput.tag")}` : ""}</p></div><div className="flex items-center gap-2">{settings.data?.activeCustomModelId === model.id ? <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Check size={14} /> {t("common.active")}</span> : <Button variant="outline" onClick={() => updateSettings.mutate({ activeProvider: "custom", activeCustomModelId: model.id })} disabled={updateSettings.isPending}>{updateSettings.isPending && <Loader2 className="animate-spin" size={15} />} {t("settings.byok.provider.use")}</Button>}<Button variant="ghost" size="icon" aria-label={t("settings.byok.provider.remove.aria", { name: model.name })} onClick={() => { if (window.confirm(t("settings.byok.provider.remove.confirm", { name: model.name }))) deleteCustom.mutate({ id: model.id }); }} disabled={deleteCustom.isPending} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button></div></div>)}
      {customModels.length === 0 && <p className="rounded-2xl border border-dashed bg-muted/10 p-4 text-xs text-muted-foreground">{t("settings.byok.empty")}</p>}
    </div>
    <div className="mt-6 space-y-4 rounded-2xl border bg-muted/20 p-4 sm:p-5">
      <div><p className="text-sm font-bold">{t("settings.byok.add.title")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.byok.add.body")}</p></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="byok-name">{t("settings.byok.name.label")}</Label><Input id="byok-name" value={name} onChange={event => setName(event.target.value)} placeholder={t("settings.byok.name.placeholder")} maxLength={120} /></div><div className="space-y-2"><Label htmlFor="byok-model">{t("settings.byok.model.label")}</Label><Input id="byok-model" value={modelId} onChange={event => setModelId(event.target.value)} placeholder="anthropic/claude-sonnet-4.5" maxLength={240} /></div></div>
      <div className="space-y-2"><Label htmlFor="byok-baseurl">{t("settings.byok.baseUrl.label")}</Label><Input id="byok-baseurl" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://openrouter.ai/api/v1" inputMode="url" maxLength={2048} /></div>
      <div className="space-y-2"><Label htmlFor="byok-apikey">{t("settings.byok.apiKey.label")}</Label><Input id="byok-apikey" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="sk-..." maxLength={4096} autoComplete="off" /></div>
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 p-3"><div><p className="text-sm font-medium">{t("settings.byok.imageInput.title")}</p><p className="text-xs text-muted-foreground">{t("settings.byok.imageInput.body")}</p></div><Switch checked={supportsImageInput} onCheckedChange={setSupportsImageInput} aria-label={t("settings.byok.imageInput.title")} /></div>
      {testMessage !== null && <p className={`text-xs font-medium ${testOk ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}>{testMessage}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={testProvider} disabled={testCustom.isPending || !baseUrl.trim() || !apiKey.trim() || !modelId.trim()}>{testCustom.isPending && <Loader2 className="animate-spin" size={15} />} {t("settings.byok.test")}</Button><Button onClick={submitProvider} disabled={createCustom.isPending || !formComplete}>{createCustom.isPending && <Loader2 className="animate-spin" size={15} />} {t("settings.byok.add")}</Button></div>
    </div>
  </section>;
}

/**
 * Workspace environment variables the owner defines once and the agent then
 * attaches to deployments BY NAME (deploy_website's environment_variables
 * argument). Values are stored encrypted and are never shown to the agent -
 * the server resolves them privately at deploy time.
 */
function EnvironmentVarsCard() {
  const utils = trpc.useUtils();
  const { t } = useTranslation();
  const vars = trpc.workspace.environmentVars.useQuery(undefined, { retry: false });
  const [rows, setRows] = useState<Array<{ name: string; value: string }>>(
    () => (vars.data ?? []).map(entry => ({ name: entry.name, value: entry.value }))
  );
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (vars.data && !dirty) setRows(vars.data.map(entry => ({ name: entry.name, value: entry.value })));
  }, [vars.data, dirty]);
  const updateRow = (index: number, patch: Partial<{ name: string; value: string }>) => {
    setDirty(true);
    setRows(previous => previous.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };
  const save = trpc.workspace.setEnvironmentVars.useMutation({
    onSuccess: async saved => {
      setDirty(false);
      setRows(saved.map(entry => ({ name: entry.name, value: entry.value })));
      await Promise.all([utils.workspace.environmentVars.invalidate(), utils.workspace.dashboard.invalidate()]);
      toast.success(t("settings.env.saved"));
    },
    onError: error => toast.error(error.message),
  });
  const submit = () => {
    const cleaned = rows.map(row => ({ name: row.name.trim(), value: row.value })).filter(row => row.name || row.value);
    const invalid = cleaned.find(row => !row.name || !row.value);
    if (invalid) { toast.error(t("settings.env.needBoth")); return; }
    const names = cleaned.map(row => row.name.toUpperCase());
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate) { toast.error(t("settings.env.duplicate", { name: duplicate })); return; }
    save.mutate({ vars: cleaned.map(row => ({ ...row, name: row.name.trim().toUpperCase() })) });
  };
  return <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{t("settings.env.eyebrow")}</p><h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.env.title")}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("settings.env.body")}</p></div><div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><Variable size={24} /></div></div>
    {vars.isLoading ? <div className="mt-6 flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div> : <>
      <div className="mt-6 space-y-3">
        {rows.map((row, index) => <div key={index} className="flex flex-wrap items-end gap-3 rounded-2xl border bg-muted/20 p-4 sm:flex-nowrap"><div className="min-w-0 flex-1 space-y-2"><Label htmlFor={`env-name-${index}`}>{t("settings.env.name.label")}</Label><Input id={`env-name-${index}`} value={row.name} onChange={event => updateRow(index, { name: event.target.value.replace(/[^A-Za-z0-9_]/g, "") })} placeholder="STRIPE_API_KEY" maxLength={128} autoComplete="off" spellCheck={false} /></div><div className="min-w-0 flex-1 space-y-2"><Label htmlFor={`env-value-${index}`}>{t("settings.env.value.label")}</Label><Input id={`env-value-${index}`} value={row.value} onChange={event => updateRow(index, { value: event.target.value })} placeholder="sk_live_..." maxLength={4096} autoComplete="off" /></div><Button variant="ghost" size="icon" aria-label={row.name ? t("settings.env.remove.aria", { name: row.name }) : t("settings.env.remove.ariaDefault")} onClick={() => { setDirty(true); setRows(previous => previous.filter((_, rowIndex) => rowIndex !== index)); }} disabled={save.isPending} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button></div>)}
        {rows.length === 0 && <p className="rounded-2xl border border-dashed bg-muted/10 p-4 text-xs text-muted-foreground">{t("settings.env.empty")}</p>}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><Button variant="outline" onClick={() => { setDirty(true); setRows(previous => [...previous, { name: "", value: "" }]); }}><span className="mr-1.5">+</span> {t("settings.env.add")}</Button><Button onClick={submit} disabled={save.isPending || (!dirty && rows.length > 0)}>{save.isPending && <Loader2 size={15} className="animate-spin" />} {t("settings.env.save")}</Button></div>
    </>}
  </section>;
}

function TelegramBotCard() {
  const utils = trpc.useUtils(); const { t } = useTranslation(); const status = trpc.telegram.status.useQuery(undefined, { retry: false, refetchInterval: 30_000 }); const [chatId, setChatId] = useState(""); const [testText, setTestText] = useState(() => t("settings.telegram.test.defaultMessage"));
  const refresh = () => utils.telegram.status.invalidate();
  const configure = trpc.telegram.configure.useMutation({ onSuccess: async data => { await refresh(); setChatId(data.chatId ?? ""); }, onError: error => toast.error(error.message) });
  const discover = trpc.telegram.discoverChat.useMutation({ onSuccess: async data => { await refresh(); setChatId(data.chatId ?? ""); toast.success(t("settings.telegram.discovered")); }, onError: error => toast.error(error.message) });
  const sendTest = trpc.telegram.sendTest.useMutation({ onSuccess: () => toast.success(t("settings.telegram.test.sent")), onError: error => toast.error(error.message) });
  const remove = trpc.telegram.remove.useMutation({ onSuccess: async () => { await refresh(); setChatId(""); toast.success(t("settings.telegram.removed")); }, onError: error => toast.error(error.message) });
  const configured = Boolean(status.data?.configured); const ready = Boolean(configured && status.data?.chatId); const webhookLinked = Boolean(configured && status.data?.webhook?.linked); const waitingForTelegram = configured && !status.data?.chatId;
  return <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{t("settings.telegram.eyebrow")}</p><h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.telegram.title")}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("settings.telegram.body")}</p></div>{ready && <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Check size={14} /> {t("settings.telegram.badge.connected")}</span>}{waitingForTelegram && <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700"><MessageCircle size={14} /> {t("settings.telegram.badge.waiting")}</span>}{configured && !webhookLinked && <span className="inline-flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-700"><AlertTriangle size={14} /> {t("settings.telegram.badge.webhookDown")}</span>}</div><div className="mt-6 grid gap-5 lg:grid-cols-2"><div className="space-y-4 rounded-2xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><MessageCircle className="size-4 text-primary" /><p className="text-sm font-bold">{ready ? t("settings.telegram.disconnect.title") : t("settings.telegram.connect.title")}</p></div><p className="text-xs leading-5 text-muted-foreground">{ready ? t("settings.telegram.disconnect.body") : t("settings.telegram.connect.body")}</p>{ready ? <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => { if (window.confirm(t("settings.telegram.disconnect.confirm"))) remove.mutate(); }} disabled={remove.isPending}>{(remove.isPending || status.isFetching) && <Loader2 className="animate-spin" size={15} />} {t("settings.telegram.disconnect.button")}</Button> : <Button className="w-full" onClick={() => { const knownUsername = status.data?.botUsername ?? null; const knownCode = status.data?.linkCode ?? null; const openBot = (username: string, code: string) => window.open(`https://t.me/${username}?text=${encodeURIComponent(`/start nova_app_link_${code}`)}`, "_blank", "noopener"); if (knownUsername && knownCode) openBot(knownUsername, knownCode); void (async () => { const saved = await configure.mutateAsync({ chatId: chatId.trim() || null }).catch(() => null); if (!saved) return; const code = saved.linkCode ?? knownCode; if (!saved.botUsername || !code) { toast.error(t("settings.telegram.linkError")); return; } if (!(knownUsername && knownCode)) openBot(saved.botUsername, code); toast.success(t("settings.telegram.secured")); })(); }} disabled={configure.isPending}>{configure.isPending && <Loader2 className="animate-spin" size={15} />} {t("settings.telegram.connect.button")}</Button>}{configured && !ready && <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => discover.mutate()} disabled={discover.isPending}>{discover.isPending && <Loader2 className="animate-spin" size={15} />} {t("settings.telegram.check")}</Button><Button variant="ghost" size="icon" aria-label={t("settings.telegram.remove.aria")} onClick={() => remove.mutate()} disabled={remove.isPending} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button></div>}</div><div className="space-y-4 rounded-2xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#638f84]" /><p className="text-sm font-bold">{t("settings.telegram.test.title")}</p></div><p className="text-xs leading-5 text-muted-foreground">{ready ? t("settings.telegram.test.ready", { chatId: status.data?.chatId ?? "" }) : t("settings.telegram.test.notReady")}</p><Textarea value={testText} onChange={event => setTestText(event.target.value)} className="min-h-28" maxLength={4096} disabled={!ready} /><Button variant="outline" className="w-full" onClick={() => sendTest.mutate({ text: testText })} disabled={!ready || !testText.trim() || sendTest.isPending}>{sendTest.isPending && <Loader2 className="animate-spin" size={15} />} <Send size={15} /> {t("settings.telegram.test.button")}</Button></div></div></section>;
}

function toolkitLabel(toolkit: "github" | "gmail" | "vercel", t: (key: TranslationKey) => string) {
  if (toolkit === "github") return t("settings.connectors.toolkit.github");
  if (toolkit === "gmail") return t("settings.connectors.toolkit.gmail");
  return t("settings.connectors.toolkit.vercel");
}

function CodexConnectorCard({ enabled }: { enabled: boolean }) {
  const utils = trpc.useUtils();
  const { t } = useTranslation();
  const status = trpc.codex.status.useQuery(undefined, {
    enabled,
    retry: false,
    refetchInterval: query => query.state.data?.pending ? 2500 : false,
  });
  const connect = trpc.codex.connect.useMutation({
    onSuccess: async () => { await utils.codex.status.invalidate(); },
    onError: error => toast.error(error.message || t("settings.codex.error")),
  });
  const disconnect = trpc.codex.disconnect.useMutation({
    onSuccess: async () => {
      await utils.codex.status.invalidate();
      toast.success(t("settings.codex.disconnected"));
    },
    onError: error => toast.error(error.message || t("settings.codex.error")),
  });
  const connection = status.data;
  const connected = connection?.connected ?? false;
  const pending = connection?.pending ?? false;
  const busy = connect.isPending || disconnect.isPending;
  const canCopyCode = typeof navigator !== "undefined" && Boolean(navigator.clipboard);

  const copyCode = async () => {
    if (!connection?.userCode || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(connection.userCode);
      toast.success(t("settings.codex.device.copied"));
    } catch {
      toast.error(t("settings.codex.device.copyError"));
    }
  };

  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{t("settings.codex.eyebrow")}</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.codex.title")}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("settings.codex.body")}</p>
        </div>
        <span className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-bold ${connected ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : connection?.state === "error" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-muted text-muted-foreground"}`}>
          {connected ? <Check size={14} /> : pending ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
          {connected ? t("settings.codex.connected") : pending ? t("settings.codex.pending") : connection?.state === "error" ? t("settings.codex.failed") : t("settings.codex.notConnected")}
        </span>
      </div>

      <p className="mt-5 rounded-xl border bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground">{t("settings.codex.storage")}</p>

      {pending && (
        <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/[0.035] p-5">
          <p className="text-sm font-bold">{connection?.userCode ? t("settings.codex.device.title") : t("settings.codex.starting")}</p>
          {connection?.userCode && connection.verificationUrl ? (
            <>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("settings.codex.device.body")}</p>
              <a className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-4" href={connection.verificationUrl} target="_blank" rel="noopener noreferrer">{t("settings.codex.device.open")}</a>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <code className="rounded-lg border bg-background px-4 py-3 font-mono text-xl font-bold tracking-[0.18em]">{connection.userCode}</code>
                <Button variant="outline" onClick={copyCode} disabled={!canCopyCode} className="gap-2"><Clipboard size={15} />{t("settings.codex.device.copy")}</Button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("settings.codex.starting.body")}</p>
          )}
        </div>
      )}

      {connected && <p className="mt-5 text-sm leading-6 text-muted-foreground">{t("settings.codex.connected.body")} <code className="rounded bg-muted px-1.5 py-1 font-mono text-xs">npx --yes --package @openai/codex@latest codex</code></p>}
      {connection?.state === "error" && <p role="alert" className="mt-5 text-sm leading-6 text-destructive">{t("settings.codex.error")}</p>}
      {!connection?.configured && !status.isLoading && <p className="mt-5 text-sm leading-6 text-muted-foreground">{t("settings.codex.unavailable")}</p>}
      {status.isError && <p role="alert" className="mt-5 text-sm leading-6 text-destructive">{t("settings.codex.statusError")}</p>}

      <div className="mt-5 flex flex-wrap gap-3">
        {connected || pending ? (
          <Button variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => {
            if (window.confirm(t("settings.codex.disconnect.confirm"))) disconnect.mutate();
          }}>
            {(busy || status.isFetching) && <Loader2 className="animate-spin" size={15} />}{t("settings.codex.disconnect")}
          </Button>
        ) : (
          <Button disabled={!connection?.configured || busy} onClick={() => connect.mutate()}>
            {busy && <Loader2 className="animate-spin" size={15} />}{t("settings.codex.connect")}
          </Button>
        )}
        <Button variant="outline" onClick={() => void status.refetch()} disabled={status.isFetching}>
          {status.isFetching && <Loader2 className="animate-spin" size={15} />}{t("settings.codex.refresh")}
        </Button>
      </div>
    </section>
  );
}

function ConnectorCard({ toolkit }: { toolkit: "github" | "gmail" | "vercel" }) {
  const utils = trpc.useUtils();
  const { t } = useTranslation();
  const status = trpc.composio.status.useQuery(undefined, { retry: false, refetchInterval: 60_000 });
  const connect = trpc.composio.connect.useMutation({
    onSuccess: async result => {
      window.open(result.redirectUrl, "_blank", "noopener");
      toast.success(t("settings.connectors.authOpened", { label: toolkitLabel(toolkit, t) }));
      await utils.composio.status.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const disconnect = trpc.composio.disconnect.useMutation({
    onSuccess: async () => {
      toast.success(t("settings.connectors.disconnected", { label }));
      await utils.composio.status.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const entry = status.data?.toolkits?.[toolkit];
  const configured = entry?.configured ?? false;
  const connected = entry?.connected ?? false;
  const errored = entry?.status === "error";
  const keyLength = status.data?.keyLength ?? 0;
  const label = toolkitLabel(toolkit, t);
  const blurb = toolkit === "github"
    ? t("settings.connectors.blurb.github")
    : toolkit === "gmail"
      ? t("settings.connectors.blurb.gmail")
      : t("settings.connectors.blurb.vercel");
  const hint = toolkit === "github"
    ? t("settings.connectors.hint.github")
    : toolkit === "gmail"
      ? t("settings.connectors.hint.gmail")
      : t("settings.connectors.hint.vercel");
  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{t("settings.connectors.eyebrow")}</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">{label}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{blurb}</p>
        </div>
        {connected && <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Check size={14} /> {t("settings.connectors.badge.connected", { label })}</span>}
        {errored && <span className="inline-flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-700 dark:bg-red-500/10 dark:text-red-300"><AlertTriangle size={14} /> {t("settings.connectors.badge.rejected")}</span>}
        {!connected && !errored && configured && <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700">{toolkit === "github" ? <Github size={14} /> : toolkit === "gmail" ? <Mail size={14} /> : <Rocket size={14} />} {t("settings.connectors.badge.notConnected")}</span>}
        {!configured && <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground"><AlertTriangle size={14} /> {t("settings.connectors.badge.keyMissing")}</span>}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
          <div className="flex items-center gap-2">{toolkit === "github" ? <Github className="size-4 text-primary" /> : toolkit === "gmail" ? <Mail className="size-4 text-primary" /> : <Rocket className="size-4 text-primary" />}<p className="text-sm font-bold">{connected ? t("settings.connectors.disconnect.title", { label }) : t("settings.connectors.connect.title", { label })}</p></div>
          <p className="text-xs leading-5 text-muted-foreground">
            {errored
              ? t("settings.connectors.body.rejected", { length: keyLength })
              : connected
                ? t("settings.connectors.body.connected", { label })
                : configured
                  ? t("settings.connectors.body.configured", { label })
                  : t("settings.connectors.body.unconfigured")}
          </p>
          {connected ? (
            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm(t("settings.connectors.disconnect.confirm", { label })))
                  disconnect.mutate({ toolkit });
              }}
              disabled={disconnect.isPending}
            >
              {(disconnect.isPending || status.isFetching) && <Loader2 className="animate-spin" size={15} />} {t("settings.connectors.disconnect.button", { label })}
            </Button>
          ) : (
            <Button className="w-full" onClick={() => connect.mutate({ toolkit })} disabled={!configured || connect.isPending}>
              {(connect.isPending || status.isFetching) && <Loader2 className="animate-spin" size={15} />} {t("settings.connectors.connect.button", { label })}
            </Button>
          )}
        </div>
        <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
          <div className="flex items-center gap-2"><RefreshCw className="size-4 text-[#638f84]" /><p className="text-sm font-bold">{t("settings.connectors.status.title")}</p></div>
          <p className="text-xs leading-5 text-muted-foreground">
            {connected ? t("settings.connectors.status.connected", { label, hint }) : t("settings.connectors.status.disconnected")}
          </p>
          <Button variant="outline" className="w-full" onClick={() => void status.refetch()} disabled={status.isFetching}>
            {status.isFetching && <Loader2 className="animate-spin" size={15} />} {t("settings.connectors.status.refresh")}
          </Button>
        </div>
      </div>
    </section>
  );
}
