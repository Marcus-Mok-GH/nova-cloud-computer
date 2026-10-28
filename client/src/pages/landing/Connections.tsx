import React from "react";
import { Github, Inbox, Mail, Triangle } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";

/**
 * A quiet band under the hero: the connectors a workspace can reach. Every
 * name here is a connector Nova ships today, so this is a capability list
 * rather than a wall of borrowed logos.
 */
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
    <section
      aria-label={t("landing.connections.aria")}
      className="border-t border-border"
    >
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[minmax(0,17rem)_1fr] lg:items-center lg:gap-12">
        <p className="text-sm leading-6 text-muted-foreground">
          {t("landing.connections.lead")}
        </p>
        <ul className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {connectors.map(connector => {
            const Icon = connector.icon;
            return (
              <li
                key={connector.label}
                className="group rounded-2xl border border-border bg-card px-3.5 py-2.5 transition-colors duration-200 hover:border-primary/30"
              >
                <span className="flex items-center gap-2">
                  <Icon
                    className="size-4 shrink-0 text-muted-foreground transition-colors duration-200 group-hover:text-primary"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium text-card-foreground">
                    {connector.label}
                  </span>
                </span>
                <span className="ms-6 mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {connector.note}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
