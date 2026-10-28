import NovaLogo from "@/components/NovaLogo";
import { waitlistLaunchLabel } from "@shared/waitlist";
import { ArrowRight, Check, Mail } from "lucide-react";
import React, { FormEvent, useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const LAUNCH_LABEL = waitlistLaunchLabel();

function messageForStatus(status: number, error: string | undefined): string {
  if (error === "waitlist-not-configured") return "The waitlist is briefly unavailable. Please try again in a moment.";
  if (status === 429 || error === "too-many-attempts") return "That is a lot of attempts. Please try again in a few minutes.";
  if (status === 400 || error === "enter-a-valid-email") return "Please enter a valid email address, like you@example.com.";
  return "That did not go through. Please try again.";
}

/**
 * Pre-launch `/sign-in`: collect an address, promise exactly one email when
 * Nova opens. Nothing is written to Nova's own database - the address goes
 * straight to the list provider.
 */
export default function Waitlist() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const launchLabel = waitlistLaunchLabel();

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
              We&rsquo;ll email <span className="font-semibold text-card-foreground">{email}</span> the moment Nova opens on{" "}
              {launchLabel}. Nothing else lands in your inbox.
            </p>
          </div>
        ) : (
          <>
            <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-card-foreground">Nova opens on {launchLabel}.</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              A cloud computer that runs your projects, files, and AI around the clock. Leave your email and we&rsquo;ll write to you
              once, when the doors open.
            </p>

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
          <span>One launch email. No newsletter, no sharing your address. Ask us to delete it any time.</span>
        </p>
      </section>
    </main>
  );
}