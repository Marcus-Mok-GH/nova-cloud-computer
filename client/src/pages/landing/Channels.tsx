import React from "react";
import { Mail, MonitorSmartphone, Send } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { Eyebrow } from "./shared";

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
        <ul className="mt-10 grid border-y border-border sm:mt-12 lg:grid-cols-3">
          {channels.map(channel => {
            const Icon = channel.icon;
            return (
              <li
                key={channel.title}
                className="border-b border-border py-6 sm:py-7 lg:border-b-0 lg:pe-8 lg:ps-6 lg:first:ps-0 lg:not-first:border-s lg:not-first:border-border"
              >
                <div className="flex items-center gap-3">
                  <Icon className="size-4 text-primary" aria-hidden="true" />
                  <h3 className="text-base font-semibold tracking-[-0.02em] text-foreground">
                    {channel.title}
                  </h3>
                </div>
                <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
                  {channel.body}
                </p>
              </li>
            );
          })}
        </ul>
        <ul className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-5 text-xs text-muted-foreground">
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
