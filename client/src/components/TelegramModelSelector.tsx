import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function TelegramModelSelector() {
  const utils = trpc.useUtils();
  const settings = trpc.telegram.modelSettings.useQuery(undefined, { retry: false, refetchInterval: 300000 });
  const update = trpc.telegram.updateModel.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.telegram.modelSettings.invalidate(), utils.workspace.modelSettings.invalidate()]);
      toast.success("Telegram model updated.");
    },
    onError: error => toast.error(error.message),
  });
  const options = settings.data?.options ?? [];
  const selected = settings.data?.modelId ?? "";

  return (
    <section className="rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Telegram AI</p>
          <h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Telegram model</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Choose which NVIDIA text or vision-language model powers your Telegram bot. The list is fetched dynamically from the configured NVIDIA gateway.
          </p>
        </div>
        <Button variant="outline" size="icon" aria-label="Refresh NVIDIA models" onClick={() => settings.refetch()} disabled={settings.isFetching}>
          <RefreshCw className={settings.isFetching ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>
      <div className="mt-6 rounded-2xl border bg-muted/20 p-4">
        <div className="flex items-center gap-2 text-sm font-bold"><Sparkles className="size-4 text-[#638f84]" /> Available NVIDIA models</div>
        {settings.isLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading models...</div>
        ) : settings.isError ? (
          <div className="mt-4 text-sm text-muted-foreground">NVIDIA model discovery is unavailable right now.</div>
        ) : (
          <select
            aria-label="Telegram AI model"
            value={selected}
            onChange={event => update.mutate({ provider: "nvidia-nim", modelId: event.target.value })}
            disabled={!options.length || update.isPending}
            className="mt-4 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#f97316]/30"
          >
            {!selected && <option value="">Select a model</option>}
            {options.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
          </select>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Changing this setting updates the model used by Telegram and keeps it synchronized with the workspace agent.</p>
      </div>
    </section>
  );
}
