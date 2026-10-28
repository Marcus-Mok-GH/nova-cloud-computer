import React from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import LandingNav from "./landing/LandingNav";
import Hero from "./landing/Hero";
import Connections from "./landing/Connections";
import DeepDives from "./landing/DeepDives";
import HowItWorks from "./landing/HowItWorks";
import Jobs from "./landing/Jobs";
import Channels from "./landing/Channels";
import Pricing from "./landing/Pricing";
import Faq from "./landing/Faq";
import DevCallout from "./landing/DevCallout";
import SiteFooter from "./landing/SiteFooter";

/**
 * The public landing page. Each section lives in its own component under
 * `landing/`; this file only sets the order and the shared shell.
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
        <Connections />
        <DeepDives />
        <HowItWorks />
        <Jobs />
        <Channels />
        <Pricing />
        <Faq />
        <DevCallout />
      </main>
      <SiteFooter />
    </div>
  );
}
