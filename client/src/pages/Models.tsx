import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Check, Eye, Loader2, RefreshCw, Sparkles, Type } from "lucide-react";
import { toast } from "sonner";
import React, { useEffect, useRef, useState } from "react";

/** A dedicated home for the chat-capable NVIDIA NIM models available to this workspace. */
export default function Models() {
  const utils = trpc.useUtils();
  const [forceRefresh, setForceRefresh] = useState(false);
  const refreshStartedAt = useRef(0);
  const models = trpc.nvidia.models.useQuery({ forceRefresh }, {
    retry: false,
    refetchInterval: 300000,
  });
  useEffect(() => {
    if (forceRefresh && models.dataUpdatedAt > refreshStartedAt.current) setForceRefresh(false);
  }, [forceRefresh, models.dataUpdatedAt]);
  const settings = trpc.workspace.modelSettings.useQuery(undefined, {
    retry: false,
  });
  const selectModel = trpc.workspace.updateSettings.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.workspace.modelSettings.invalidate(),
        utils.telegram.modelSettings.invalidate(),
      ]);
      toast.success("Model selected for Nova and Telegram.");
    },
    onError: error => toast.error(error.message),
  });
  const activeModelId =
    settings.data?.activeProvider === "nvidia-nim"
      ? settings.data.activeModelId
      : "";

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl p-4 sm:p-5 md:p-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
              NVIDIA NIM
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-neutral-950 dark:text-white">
              Model home
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">
              Choose the text or vision-language model that powers Nova.
              Available models are discovered from your configured NVIDIA
              gateway; image, audio, and video generation models are not shown.
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => { refreshStartedAt.current = models.dataUpdatedAt; setForceRefresh(true); }}
            disabled={models.isFetching || forceRefresh}
          >
            <RefreshCw
              className={models.isFetching || forceRefresh ? "size-4 animate-spin" : "size-4"}
            />{" "}
            Refresh models
          </Button>
        </header>

        {models.isLoading || settings.isLoading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-neutral-500">
            <Loader2 className="size-4 animate-spin" /> Loading available
            models…
          </div>
        ) : models.isError || settings.isError ? (
          <section className="mt-8 rounded-3xl border border-dashed p-8 text-center">
            <h2 className="text-lg font-bold">
              Model settings are unavailable
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Nova could not load the available NVIDIA models or your workspace
              model settings. Refresh and try again.
            </p>
          </section>
        ) : (
          <section className="mt-8" aria-label="Available NVIDIA models">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="size-4 text-[oklch(0.72_0.015_250)]" />
              <h2 className="font-bold">Available chat models</h2>
              <span className="text-sm text-muted-foreground">
                {models.data?.length ?? 0}
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {models.data?.map(model => {
                const selected = model.id === activeModelId;
                const vision = model.kind === "vision";
                return (
                  <article
                    key={model.id}
                    className={`flex min-h-52 flex-col rounded-3xl border p-5 shadow-sm transition ${selected ? "border-[oklch(0.60_0.02_250)] bg-[oklch(0.60_0.02_250/0.08)] ring-1 ring-[oklch(0.60_0.02_250/0.25)]" : "bg-white dark:bg-[#141414]"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`grid size-10 place-items-center rounded-xl ${vision ? "bg-sky-500/10 text-sky-600" : "bg-[oklch(0.60_0.02_250/0.10)] text-[oklch(0.72_0.015_250)]"}`}
                      >
                        {vision ? (
                          <Eye className="size-5" />
                        ) : (
                          <Type className="size-5" />
                        )}
                      </span>
                      {selected && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.60_0.02_250)] px-2.5 py-1 text-[11px] font-bold text-white">
                          <Check className="size-3" /> Selected
                        </span>
                      )}
                    </div>
                    <h3 className="mt-5 break-all text-sm font-bold leading-5">
                      {model.id}
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {vision
                        ? "Vision-language · text and image understanding"
                        : "Text · chat and language tasks"}
                    </p>
                    <Button
                      className="mt-auto w-full"
                      variant={selected ? "outline" : "default"}
                      disabled={selected || selectModel.isPending}
                      onClick={() =>
                        selectModel.mutate({
                          activeProvider: "nvidia-nim",
                          activeModelId: model.id,
                        })
                      }
                    >
                      {selectModel.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : selected ? (
                        "Currently selected"
                      ) : (
                        "Use this model"
                      )}
                    </Button>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
