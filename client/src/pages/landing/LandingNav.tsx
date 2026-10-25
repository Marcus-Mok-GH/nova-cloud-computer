import React, { useRef, useState } from "react";
import { Moon, Sun, X } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { CtaButton, landingAnchors, useEnterNova } from "./shared";

const navLinkClasses =
  "whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Sticky top navigation: anchors, the theme toggle, and the page's main CTA. */
export default function LandingNav() {
  const { t, language, languages, setLanguage } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated, enterNova } = useEnterNova();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const ctaLabel = isAuthenticated
    ? t("landing.cta.open")
    : t("landing.cta.get");

  const onEnter = () => {
    setMenuOpen(false);
    enterNova();
  };
  const closeMenu = () => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };

  return (
    <header
      className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-xl"
      onKeyDown={event => {
        if (event.key === "Escape" && menuOpen) closeMenu();
      }}
    >
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-2.5" aria-label="Nova">
          <img
            src="/logo-96.png"
            alt=""
            width="27"
            height="27"
            className="rounded-[7px]"
            loading="eager"
          />
          <span className="text-[17px] font-bold tracking-[-0.02em] text-foreground">
            Nova
          </span>
        </a>

        <nav
          className="hidden items-center gap-1 lg:flex"
          aria-label={t("landing.nav.aria")}
        >
          {landingAnchors.map(anchor => (
            <a key={anchor.href} href={anchor.href} className={navLinkClasses}>
              {t(anchor.key)}
            </a>
          ))}
          <a href="/docs/api" className={navLinkClasses}>
            {t("landing.nav.apiDocs")}
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="grid size-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={
              theme === "light"
                ? t("layout.theme.toDark")
                : t("layout.theme.toLight")
            }
          >
            {theme === "light" ? (
              <Moon className="size-4" />
            ) : (
              <Sun className="size-4" />
            )}
          </button>
          <select
            id="landing-language-desktop"
            value={language}
            onChange={event => setLanguage(event.target.value)}
            aria-label={t("settings.language.title")}
            className="hidden h-9 max-w-[124px] rounded-full border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
          >
            {languages.map(option => (
              <option key={option.id} value={option.id} lang={option.locale}>
                {option.label}
              </option>
            ))}
          </select>
          <CtaButton
            label={ctaLabel}
            onClick={onEnter}
            className="hidden px-4 py-2.5 sm:inline-flex"
          />
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            className="grid size-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-nav"
            aria-label={
              menuOpen ? t("landing.nav.closeMenu") : t("landing.nav.menu")
            }
          >
            {menuOpen ? (
              <X className="size-4" />
            ) : (
              <span className="text-lg leading-none">&#9776;</span>
            )}
          </button>
        </div>
      </div>

      <nav
        id="landing-mobile-nav"
        hidden={!menuOpen}
        className="border-t border-border px-5 pb-4 pt-3 lg:hidden"
        aria-label={t("landing.nav.aria")}
      >
        <div className="flex flex-col gap-1">
          {landingAnchors.map(anchor => (
            <a
              key={anchor.href}
              href={anchor.href}
              onClick={closeMenu}
              className={cn(
                navLinkClasses,
                "rounded-lg px-3 py-2.5 text-foreground"
              )}
            >
              {t(anchor.key)}
            </a>
          ))}
          <a
            href="/docs/api"
            onClick={closeMenu}
            className={cn(
              navLinkClasses,
              "rounded-lg px-3 py-2.5 text-foreground"
            )}
          >
            {t("landing.nav.apiDocs")}
          </a>
          <div className="mt-3 rounded-lg border border-border px-3 py-2.5">
            <label
              htmlFor="landing-language-mobile"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              {t("settings.language.title")}
            </label>
            <select
              id="landing-language-mobile"
              value={language}
              onChange={event => setLanguage(event.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {languages.map(option => (
                <option key={option.id} value={option.id} lang={option.locale}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <CtaButton
            label={ctaLabel}
            onClick={onEnter}
            className="mt-2 w-full sm:hidden"
          />
        </div>
      </nav>
    </header>
  );
}
