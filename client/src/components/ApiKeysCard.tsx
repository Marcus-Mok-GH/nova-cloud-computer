import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Braces, Check, Clipboard, Loader2, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { NOVA_PUBLIC_APP_URL } from "@shared/const";

type ApiKeyRow = {
  id: number;
  name: string;
  keyPreview: string;
  createdAt: string | Date;
  lastUsedAt: string | Date | null;
};

/**
 * Settings card for the OpenAI-compatible inference API: create, rename,
 * inspect and revoke Nova API keys. The full key value is shown exactly once,
 * at creation.
 */
export default function ApiKeysCard() {
  const utils = trpc.useUtils();
  const { t, locale } = useTranslation();
  const keys = trpc.apiKeys.list.useQuery(undefined, { retry: false });
  const createKey = trpc.apiKeys.create.useMutation({
    onSuccess: async created => {
      await utils.apiKeys.list.invalidate();
      setNewKeyName("");
      setFreshKey(created.key);
      toast.success(t("settings.apiKeys.created"));
    },
    onError: error => toast.error(error.message || t("settings.apiKeys.createError")),
  });
  const revokeKey = trpc.apiKeys.revoke.useMutation({
    onSuccess: async () => {
      await utils.apiKeys.list.invalidate();
      toast.success(t("settings.apiKeys.revoked"));
    },
    onError: error => toast.error(error.message || t("settings.apiKeys.revokeError")),
  });
  const renameKey = trpc.apiKeys.rename.useMutation({
    onSuccess: async () => {
      await utils.apiKeys.list.invalidate();
      setEditingId(null);
      setDraftName("");
      toast.success(t("settings.apiKeys.renamed"));
    },
    onError: error => toast.error(error.message || t("settings.apiKeys.renameError")),
  });

  const formatDay = (value: string | Date) =>
    new Date(value).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });

  const relativeTime = (value: string | Date | null) => {
    if (!value) return t("settings.apiKeys.used.never");
    const diff = Date.now() - new Date(value).getTime();
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return t("settings.apiKeys.used.justNow");
    if (minutes < 60) return t("settings.apiKeys.used.minutesAgo", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t("settings.apiKeys.used.hoursAgo", { count: hours });
    return t("settings.apiKeys.used.daysAgo", { count: Math.round(hours / 24) });
  };

  const [newKeyName, setNewKeyName] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");

  const startRenaming = (key: ApiKeyRow) => {
    setFreshKey(null);
    setEditingId(key.id);
    setDraftName(key.name);
  };

  const saveRename = (key: ApiKeyRow) => {
    const name = draftName.trim();
    if (!name || name === key.name) { setEditingId(null); return; }
    renameKey.mutate({ id: key.id, name });
  };

  const copyKey = async () => {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("settings.apiKeys.copyManual"));
    }
  };

  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{t("settings.apiKeys.eyebrow")}</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.apiKeys.title")}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("settings.apiKeys.body")}
          </p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          <Braces size={24} />
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-dashed bg-muted/30 p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={newKeyName}
            onChange={event => setNewKeyName(event.target.value)}
            placeholder={t("settings.apiKeys.name.placeholder")}
            maxLength={120}
            onKeyDown={event => { if (event.key === "Enter" && newKeyName.trim() && !createKey.isPending) createKey.mutate({ name: newKeyName.trim() }); }}
          />
          <Button className="sm:w-40" onClick={() => { if (newKeyName.trim()) createKey.mutate({ name: newKeyName.trim() }); }} disabled={!newKeyName.trim() || createKey.isPending}>
            {createKey.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {t("settings.apiKeys.create")}
          </Button>
        </div>
      </div>

      {freshKey && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck size={15} />
            <p className="text-xs font-bold uppercase tracking-wide">{t("settings.apiKeys.copyNow")}</p>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-3 py-2 font-mono text-xs">{freshKey}</code>
            <Button size="sm" variant="outline" onClick={() => { void copyKey(); }} className="sm:w-28">
              {copied ? <Check size={14} /> : <Clipboard size={14} />}
              {copied ? t("settings.apiKeys.copied") : t("settings.apiKeys.copy")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFreshKey(null)} className="sm:w-20">{t("settings.apiKeys.done")}</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("settings.apiKeys.hashNote")}</p>
        </div>
      )}

      <div className="mt-5">
        {keys.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> {t("settings.apiKeys.loading")}</p>
        ) : keys.isError ? (
          <p className="text-sm text-muted-foreground">{t("settings.apiKeys.loadError")} <button className="underline underline-offset-2" onClick={() => void keys.refetch()}>{t("common.tryAgain")}</button></p>
        ) : (keys.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.apiKeys.empty")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border">
            {(keys.data ?? []).map((key: ApiKeyRow) => (
              <li key={key.id} className="flex items-center justify-between gap-3 px-4 py-3">
                {editingId === key.id ? (
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={draftName}
                      onChange={event => setDraftName(event.target.value)}
                      maxLength={120}
                      autoFocus
                      aria-label={t("settings.apiKeys.rename.aria", { name: key.name })}
                      onKeyDown={event => {
                        if (event.key === "Enter") saveRename(key);
                        if (event.key === "Escape") setEditingId(null);
                      }}
                    />
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" className="sm:w-24" onClick={() => saveRename(key)} disabled={!draftName.trim() || (renameKey.isPending && renameKey.variables?.id === key.id)}>
                        {renameKey.isPending && renameKey.variables?.id === key.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        {t("common.save")}
                      </Button>
                      <Button size="sm" variant="ghost" className="sm:w-20" onClick={() => setEditingId(null)} disabled={renameKey.isPending && renameKey.variables?.id === key.id}>
                        <X size={14} />
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{key.name}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{key.keyPreview}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.apiKeys.createdAt", { date: formatDay(key.createdAt) })} · {relativeTime(key.lastUsedAt)}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" onClick={() => startRenaming(key)} disabled={renameKey.isPending || revokeKey.isPending}>
                        <Pencil size={14} />
                        {t("settings.apiKeys.rename")}
                      </Button>
                      <Button size="sm" variant="outline" className="border-red-500/30 text-red-600 hover:bg-red-500/10" onClick={() => revokeKey.mutate({ id: key.id })} disabled={revokeKey.isPending && revokeKey.variables?.id === key.id}>
                        {revokeKey.isPending && revokeKey.variables?.id === key.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        {t("settings.apiKeys.revoke")}
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 rounded-xl bg-muted/40 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("settings.apiKeys.example")}</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-card p-3 font-mono text-xs leading-5">{`curl ${NOVA_PUBLIC_APP_URL}/api/v1/chat/completions \\
  -H "Authorization: Bearer nova_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "nova-pro", "messages": [{"role": "user", "content": "Say hello"}]}'`}</pre>
      </div>
    </section>
  );
}
