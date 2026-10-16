/** Language selector: pick the interface language; persisted on this device by LanguageContext. */
import React from "react";
import { Check, Languages } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";

export default function LanguageCard() {
  const { language, languages, setLanguage, t } = useTranslation();
  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{t("settings.language.eyebrow")}</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">{t("settings.language.title")}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("settings.language.body")}</p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><Languages size={24} /></div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {languages.map(option => {
          const active = language === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setLanguage(option.id)}
              aria-pressed={active}
              lang={option.locale}
              className={`flex items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60 ${active ? "border-primary ring-1 ring-primary/40" : "border-border hover:border-primary/40 hover:bg-accent/40"}`}
            >
              <span className="text-sm font-bold">{option.label}</span>
              {active && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary"><Check size={13} /> {t("common.active")}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
