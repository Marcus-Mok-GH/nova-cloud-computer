import React from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/i18n";
import { CtaButton, landingAnchors, useEnterNova } from "./shared";

interface FooterColumn {
  titleKey: TranslationKey;
  links: ReadonlyArray<{ href: string; key: TranslationKey }>;
}

/** Final CTA, link columns, and the quiet bottom line. */
export default function SiteFooter() {
  const { t } = useTranslation();
  const { isAuthenticated, enterNova } = useEnterNova();

  const columns: FooterColumn[] = [
    { titleKey: "landing.footer.product", links: landingAnchors },
    {
      titleKey: "landing.footer.workspace",
      links: [
        { href: "/app", key: "nav.overview" },
        { href: "/app/files", key: "nav.files" },
        { href: "/app/chats", key: "nav.chats" },
        { href: "/app/terminal", key: "nav.terminal" },
        { href: "/app/status", key: "nav.status" },
      ],
    },
    {
      titleKey: "landing.footer.resources",
      links: [
        { href: "/docs/api", key: "landing.nav.apiDocs" },
        { href: "/sign-in", key: "layout.signIn" },
      ],
    },
  ];

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
        <div className="max-w-2xl">
          <h2 className="landing-display text-2xl leading-snug text-foreground sm:text-4xl">
            {t("landing.footer.cta.title")}
          </h2>
          <div className="mt-6">
            <CtaButton
              label={
                isAuthenticated ? t("landing.cta.open") : t("landing.cta.get")
              }
              onClick={enterNova}
            />
          </div>
        </div>
        <div className="mt-12 grid gap-8 border-t border-border pt-10 sm:grid-cols-3">
          {columns.map(column => (
            <div key={column.titleKey}>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {t(column.titleKey)}
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {column.links.map(link => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t(link.key)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Nova cloud computer</span>
          <span>{t("landing.footer.tagline")}</span>
        </div>
      </div>
    </footer>
  );
}
