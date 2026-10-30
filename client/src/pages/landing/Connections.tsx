import React from "react";
import { Github, Inbox, Mail, Triangle } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";

export default function Connections() {
  const { t } = useTranslation();
  const connectors = [
    {
      icon: Github,
      label: t("landing.connections.github"),
      note: t("landing.connections.github.note"),
    },
    {
      icon: Mail,
      label: t("landing.connections.gmail"),
      note: t("landing.connections.gmail.note"),
    },
    {
      icon: Triangle,
      label: t("landing.connections.vercel"),
      note: t("landing.connections.vercel.note"),
    },
    {
      icon: Inbox,
      label: t("landing.connections.inbox"),
      note: t("landing.connections.inbox.note"),
    },
  ];

  return (
    <section aria-label={t("landing.connections.aria")} className="border-y border-border">
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-7 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,15rem)_1fr] lg:items-center lg:gap-10">
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">
          {t("landing.connections.lead")}
        </p>
        <ul className="grid gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          {connectors.map(connector => {
            const Icon = connector.icon;
            return (
              <li key={connector.label} className="flex gap-3 lg:border-s lg:ps-5">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    {connector.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {connector.note}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
