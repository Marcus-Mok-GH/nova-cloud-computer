import NovaLogo from "@/components/NovaLogo";
import { formatCredits } from "@shared/money";
import { OUTAGE_COMPENSATION_CREDITS } from "@shared/outageCompensation";
import { waitlistReopenLabel } from "@shared/waitlist";
import { ArrowRight, Check, Mail, Sparkles } from "lucide-react";
import React, { FormEvent, useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function messageForStatus(status: number, error: string | undefined): string {
  if (error === "waitlist-not-configured") return "The waitlist is briefly unavailable. Please try again in a moment.";
  if (status === 429 || error === "too-many-attempts") return "That is a lot of attempts. Please try again in a few minutes.";
  if (status === 400 || error === "enter-a-valid-email") return "Please enter a valid email address, like you@example.com.";
  return "That did not go through. Please try again.";
}

/**
 * Shown on the database-backed routes while Nova's storage limits reset.
 * Collects an address and promises exactly one email when the app is back.
 * Nothing is written to Nova's own database - the address goes straight to the
 * list provider, so signups keep working while the database is unavailable.
 */
export default function Waitlist() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const reopenLabel = waitlistReopenLabel();

  async function joinWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = (new FormData(event.currentTarget).get("email") ?? "").toString().trim();
    setEmail(submitted);
    if (!EMAIL_PATTERN.test(submitted)) {
      setState({ kind: "error", message: "Please enter a valid email address, like you@example.com." });
      return;
    }

    setState({ kind: "sending" });
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email: submitted, company }),
      });
      if (response.ok) {
        setState({ kind: "done" });
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setState({ kind: "error", message: messageForStatus(response.status, payload.error) });
    } catch {
      setState({ kind: "error", message: "That did not go through. Please try again." });
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-[0_8px_30px_rgba(0,0,0,0.12)] sm:p-10">
        <div className="flex items-center gap-2.5">
          <NovaLogo size={26} ariaHidden={false} />
          <span className="text-lg font-extrabold tracking-tight text-card-foreground">Nova</span>
        </div>

        {state.kind === "done" ? (
          <div className="mt-8">
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-primary/12 text-primary">
              <Check size={18} />
            </span>
            <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-card-foreground">You&rsquo;re on the list.</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              We&rsquo;ll email <span className="font-semibold text-card-foreground">{email}</span> the moment Nova is back on{" "}
              {reopenLabel}. Nothing else lands in your inbox.
            </p>
          </div>
        ) : (
          <>
            <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-card-foreground">Nova is back on {reopenLabel}.</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              We&rsquo;re upgrading Nova&rsquo;s storage and pausing the app while the new limits switch on. Leave your email and
              we&rsquo;ll write to you once, the moment it&rsquo;s back.
            </p>

            {/* The apology, where the inconvenience is actually being felt:
                every account that already existed is being credited for the
                time it could not use Nova. */}
            <div className="mt-6 flex gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] p-4">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-card-foreground">
                  We&rsquo;re sorry for the disruption.
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Every existing account is getting {formatCredits(OUTAGE_COMPENSATION_CREDITS)} in
                  credits as an apology. Those credits never expire, and there&rsquo;s nothing you need to do.
                </p>
              </div>
            </div>

            <form onSubmit={joinWaitlist} className="mt-7 space-y-4">
              <label className="block text-sm font-semibold text-card-foreground">
                Email address
                <input
                  className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-4 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-4 focus:ring-ring/15 sm:text-sm"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                />
              </label>

              {/* Honeypot: hidden from people, filled by bots. */}
              <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0">
                <label>
                  Company
                  <input tabIndex={-1} autoComplete="off" name="company" value={company} onChange={event => setCompany(event.target.value)} />
                </label>
              </div>

              {state.kind === "error" ? <p className="text-sm text-destructive">{state.message}</p> : null}

              <button className="pill-btn pill-btn-primary w-full" disabled={state.kind === "sending"} type="submit">
                {state.kind === "sending" ? (
                  "Adding you..."
                ) : (
                  <>
                    Join the waitlist <ArrowRight size={15} className="rtl:-scale-x-100" />
                  </>
                )}
              </button>
            </form>
          </>
        )}

        <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Mail size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>One email when we&rsquo;re back. No newsletter, no sharing your address. Ask us to delete it any time.</span>
        </p>
      </section>
    </main>
  );
}
