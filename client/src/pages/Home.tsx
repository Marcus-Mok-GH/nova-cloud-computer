import React from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import LandingNav from "./landing/LandingNav";
import Hero from "./landing/Hero";

/**
 * The public landing page: the top menu and the task prompt that leads into
 * Nova. The marketing sections (connectors, deep dives, pricing, FAQ, ...)
 * were retired in favor of the prompt screen, which carries the only CTA on
 * the page.
 */
export default function Home() {
  const { t } = useTranslation();

  return (
    <div id="top" className="landing-shell min-h-dvh overflow-x-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        {t("landing.skipToContent")}
      </a>
      <LandingNav />
      <main id="main">
        <Hero />
      </main>
    </div>
  );
}
