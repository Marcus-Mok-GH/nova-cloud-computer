import React from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/contexts/LanguageContext";
import { Eyebrow } from "./shared";
import { AgentVignette, AutomationVignette, FilesVignette } from "./vignettes";

/** One editorial pair: a narrative column and a wide product scene. */
function Row({
  eyebrow,
  title,
  body,
  scene,
  flip,
}: {
  eyebrow: string;
  title: string;
  body: string;
  scene: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 py-10 sm:py-14 lg:grid-cols-2 lg:gap-16">
      <div className={cn("max-w-lg", flip && "lg:order-2")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-3xl">
          {title}
        </h3>
        <p className="mt-4 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          {body}
        </p>
      </div>
      <div className={cn(flip && "lg:order-1")}>{scene}</div>
    </div>
  );
}

/**
 * The product story: three scenes - workspace, agent, automations - in
 * alternating editorial pairs instead of a card grid.
 */
export default function DeepDives() {
  const { t } = useTranslation();

  return (
    <section id="product" className="scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-5 pb-4 pt-14 sm:px-8 sm:pb-6 sm:pt-20">
        <div className="max-w-2xl">
          <Eyebrow>{t("landing.product.eyebrow")}</Eyebrow>
          <h2 className="landing-display mt-4 text-3xl leading-tight text-foreground sm:text-5xl">
            {t("landing.product.title")}
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            {t("landing.product.body")}
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-6xl divide-y divide-border border-t border-border px-5 sm:px-8">
        <Row
          eyebrow={t("landing.workspace.eyebrow")}
          title={t("landing.workspace.title")}
          body={t("landing.workspace.body")}
          scene={<FilesVignette />}
        />
        <Row
          eyebrow={t("landing.agent.eyebrow")}
          title={t("landing.agent.title")}
          body={t("landing.agent.body")}
          scene={<AgentVignette />}
          flip
        />
        <Row
          eyebrow={t("landing.automations.eyebrow")}
          title={t("landing.automations.title")}
          body={t("landing.automations.body")}
          scene={<AutomationVignette />}
        />
      </div>
    </section>
  );
}
