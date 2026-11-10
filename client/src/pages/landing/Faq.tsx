import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useTranslation } from "@/contexts/LanguageContext";
import { Eyebrow } from "./shared";

/** Six real questions, answered without marketing fog. */
export default function Faq() {
  const { t } = useTranslation();
  const items = [
    { q: t("landing.faq.q1"), a: t("landing.faq.a1") },
    { q: t("landing.faq.q2"), a: t("landing.faq.a2") },
    { q: t("landing.faq.q3"), a: t("landing.faq.a3") },
    { q: t("landing.faq.q4"), a: t("landing.faq.a4") },
    { q: t("landing.faq.q5"), a: t("landing.faq.a5") },
    { q: t("landing.faq.q6"), a: t("landing.faq.a6") },
  ];

  return (
    <section id="faq" className="scroll-mt-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Eyebrow>{t("landing.faq.eyebrow")}</Eyebrow>
          <h2 className="landing-display mt-4 text-3xl leading-tight text-foreground sm:text-5xl">
            {t("landing.faq.title")}
          </h2>
        </div>
        <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <Accordion type="single" collapsible className="w-full">
            {items.map((item, index) => (
              <AccordionItem
                key={item.q}
                value={`question-${index}`}
                className="border-border last:border-b-0"
              >
                <AccordionTrigger className="py-5 text-start text-base font-semibold tracking-[-0.01em] text-card-foreground hover:no-underline">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="max-w-2xl pb-5 text-sm leading-6 text-muted-foreground">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}