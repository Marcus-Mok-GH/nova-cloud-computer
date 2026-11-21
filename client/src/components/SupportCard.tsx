import React, { useEffect, useState } from "react";
import { Coffee, ExternalLink, X } from "lucide-react";
import { dismissSupport, isSupportDismissed, SUPPORT_URL } from "@/lib/support";

const DEFAULT_TITLE = "Buy us a coffee";
const DEFAULT_BODY =
  "Donations help us add bigger, better AI models — like Claude Opus 5.5, GPT-6.1 Astra and Gemini Carbon/Argon.";
const DEFAULT_CTA = "Support Nova on Buy Me a Coffee";

/**
 * Dismissible “Buy me a coffee” card. The dismissal persists per browser in
 * localStorage; the link opens the external page in a new tab.
 */
export default function SupportCard({
  title = DEFAULT_TITLE,
  body = DEFAULT_BODY,
  cta = DEFAULT_CTA,
  className,
}: {
  title?: string;
  body?: string;
  cta?: string;
  className?: string;
}) {
  const [visible, setVisible] = useState(true);
  // Read storage after mount so server and client markup agree during hydration.
  useEffect(() => {
    if (isSupportDismissed()) setVisible(false);
  }, []);
  if (!visible) return null;
  return (
    <div
      data-testid="support-card"
      className={`rise-in relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.06] p-4 sm:p-5 dark:bg-primary/[0.08] ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          <Coffee size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            {body}
          </p>
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground transition hover:-translate-y-0.5 hover:shadow-md"
          >
            {cta}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            dismissSupport();
            setVisible(false);
          }}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-background/70 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
