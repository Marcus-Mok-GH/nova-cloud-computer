import React from "react";
import { Mail, MonitorSmartphone, Send } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { Eyebrow } from "./shared";

/** The three ways in: Telegram, email, and any browser. */
export default function Channels() {
  const { t } = useTranslation();
  const channels = [
    {
      icon: Send,
      title: t("landing.channels.telegram.title"),
      body: t("landing.channels.telegram.body"),
    },
    {
      icon: Mail,
      title: t("landing.channels.email.title"),
      body: t("landing.channels.email.body"),
    },
    {
      icon: MonitorSmartphone,
      title: t("landing.channels.browser.title"),
      body: t("landing.channels.browser.body"),
    },
  ];
  const trust = [
    t("landing.channels.trust.storage"),
    t("landing.channels.trust.execution"),
    t("landing.channels.trust.byok"),
  ];

  return (
    <section id="channels" className="scroll-mt-24">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t("landing.channels.eyebrow")}</Eyebrow>
          <h2 className="landing-display mt-4 text-3xl leading-tight text-foreground sm:text-5xl">
            {t("landing.channels.title")}
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            {t("landing.channels.body")}
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:mt-12 lg:grid-cols-3 lg:gap-5">
          {channels.map(channel => {
            const Icon = channel.icon;
            return (
              <div
                key={channel.title}
                className="group rounded-3xl border border-border bg-card p-6 transition-colors duration-200 hover:border-primary/30 sm:p-7"
              >
                <span className="grid size-11 place-items-center rounded-2xl bg-accent text-accent-foreground transition-colors duration-200 group-hover:bg-primary/10 group-hover:text-primary">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 text-base font-semibold tracking-[-0.02em] text-foreground">
                  {channel.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {channel.body}
                </p>
              </div>
            );
          })}
        </div>
        <ul className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-5 text-xs text-muted-foreground">
          {trust.map((item, index) => (
            <li key={item} className="flex items-center gap-4">
              {index > 0 ? (
                <span aria-hidden="true" className="text-border">
                  &#183;
                </span>
              ) : null}
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
