import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Braces, Check, Clipboard, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

type ApiKeyRow = {
  id: number;
  name: string;
  keyPreview: string;
  createdAt: string | Date;
  lastUsedAt: string | Date | null;
};

function formatDay(value: string | Date) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function relativeTime(value: string | Date | null) {
  if (!value) return "never used";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "used just now";
  if (minutes < 60) return `used ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `used ${hours}h ago`;
  return `used ${Math.round(hours / 24)}d ago`;
}

/**
 * Settings card for the OpenAI-compatible inference API: create, inspect and
 * revoke Nova API keys. The full key value is shown exactly once, at creation.
 */
export default function ApiKeysCard() {
  const utils = trpc.useUtils();
  const keys = trpc.apiKeys.list.useQuery(undefined, { retry: false });
  const createKey = trpc.apiKeys.create.useMutation({
    onSuccess: async created => {
      await utils.apiKeys.list.invalidate();
      setNewKeyName("");
      setFreshKey(created.key);
      toast.success("API key created. Copy it now - Nova will not show it again.");
    },
    onError: error => toast.error(error.message || "Could not create the API key."),
  });
  const revokeKey = trpc.apiKeys.revoke.useMutation({
    onSuccess: async () => {
      await utils.apiKeys.list.invalidate();
      toast.success("API key revoked.");
    },
    onError: error => toast.error(error.message || "Could not revoke the API key."),
  });

  const [newKeyName, setNewKeyName] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyKey = async () => {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Select the key text and copy it manually.");
    }
  };

  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">API access</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">Inference API keys</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Call Nova's AI from your own scripts with an OpenAI-compatible API. Every request draws from the same daily credits and workspace allowance as your chats.
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
            placeholder="Key name, e.g. nightly-scripts"
            maxLength={120}
            onKeyDown={event => { if (event.key === "Enter" && newKeyName.trim() && !createKey.isPending) createKey.mutate({ name: newKeyName.trim() }); }}
          />
          <Button className="sm:w-40" onClick={() => { if (newKeyName.trim()) createKey.mutate({ name: newKeyName.trim() }); }} disabled={!newKeyName.trim() || createKey.isPending}>
            {createKey.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Create key
          </Button>
        </div>
      </div>

      {freshKey && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck size={15} />
            <p className="text-xs font-bold uppercase tracking-wide">Copy this key now</p>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-3 py-2 font-mono text-xs">{freshKey}</code>
            <Button size="sm" variant="outline" onClick={() => { void copyKey(); }} className="sm:w-28">
              {copied ? <Check size={14} /> : <Clipboard size={14} />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFreshKey(null)} className="sm:w-20">Done</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Nova stores only a hash of the key. Once you close this panel it cannot be shown again.</p>
        </div>
      )}

      <div className="mt-5">
        {keys.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading keys…</p>
        ) : keys.isError ? (
          <p className="text-sm text-muted-foreground">Your API keys could not load. <button className="underline underline-offset-2" onClick={() => void keys.refetch()}>Try again</button></p>
        ) : (keys.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys yet. Create one above to start calling the API.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border">
            {(keys.data ?? []).map((key: ApiKeyRow) => (
              <li key={key.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{key.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{key.keyPreview}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Created {formatDay(key.createdAt)} · {relativeTime(key.lastUsedAt)}</p>
                </div>
                <Button size="sm" variant="outline" className="shrink-0 border-red-500/30 text-red-600 hover:bg-red-500/10" onClick={() => revokeKey.mutate({ id: key.id })} disabled={revokeKey.isPending && revokeKey.variables?.id === key.id}>
                  {revokeKey.isPending && revokeKey.variables?.id === key.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 rounded-xl bg-muted/40 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Example request</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-card p-3 font-mono text-xs leading-5">{`curl https://nova-cloud-computer.vercel.app/api/v1/chat/completions \\
  -H "Authorization: Bearer nova_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "nova-pro", "messages": [{"role": "user", "content": "Say hello"}]}'`}</pre>
      </div>
    </section>
  );
}
