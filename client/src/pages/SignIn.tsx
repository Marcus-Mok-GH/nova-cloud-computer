import { updateLastActiveTimestamp, useAuth } from "@/_core/hooks/useAuth";
import { exchangeNeonVerifierAndGetJwt, neonAuth } from "@/lib/neonAuth";
import { clearPendingSignIn, readPendingSignIn, rememberPendingSignIn } from "@/lib/pendingSignIn";
import {
  EMAIL_INPUT_NAME,
  friendlyOtpSendError,
  isValidSignInEmail,
  readSubmittedEmail,
} from "@/lib/signInEmail";
import NovaLogo from "@/components/NovaLogo";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import React, { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { trpc } from "@/lib/trpc";

/**
 * Pause between code sends. Long enough that a visitor mashing resend never
 * trips Neon's send rate limit, short enough that someone whose code is simply
 * late is never stuck waiting on the only recovery path this step has.
 */
const RESEND_COOLDOWN_SECONDS = 60;

export default function SignIn() {
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  // A reload mid-code reopens the same code step: the pending email is kept for
  // the lifetime of the emailed code instead of dropping back to the email form.
  const [resumedEmail] = useState(() => readPendingSignIn());
  const [email, setEmail] = useState(resumedEmail ?? "");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(Boolean(resumedEmail));
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && isAuthenticated) setLocation("/app");
  }, [isAuthenticated, loading, setLocation]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(seconds => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function requestOTP(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read the live input value at submit time: autofill, password managers,
    // and IME input can update the field without React's onChange firing, and
    // submitting that stale state is what produced the misleading
    // "Invalid email address format" dead end for perfectly valid addresses.
    const submittedEmail = readSubmittedEmail(new FormData(event.currentTarget));
    setEmail(submittedEmail);
    if (!isValidSignInEmail(submittedEmail)) {
      setError("Please enter a valid email address, like you@example.com.");
      return;
    }
    if (!neonAuth) {
      setError("Nova's sign-in is temporarily unavailable. Please try again shortly.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await neonAuth.emailOtp.sendVerificationOtp({ email: submittedEmail, type: "sign-in" });
      if (result.error)
        setError(
          friendlyOtpSendError(
            result.error.message,
            "Nova could not send that sign-in code."
          )
        );
      else {
        rememberPendingSignIn(submittedEmail);
        setSent(true);
        setResendIn(RESEND_COOLDOWN_SECONDS);
        setNotice(null);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? friendlyOtpSendError(
              requestError.message,
              "Nova could not send that sign-in code."
            )
          : "Nova could not send that sign-in code."
      );
    } finally {
      setPending(false);
    }
  }

  async function resendOTP() {
    if (!neonAuth || resending || resendIn > 0) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await neonAuth.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (result.error)
        setError(
          friendlyOtpSendError(
            result.error.message,
            "Nova could not send another sign-in code."
          )
        );
      else {
        // Refresh the pending step so a reload keeps the new code's lifetime.
        rememberPendingSignIn(email);
        setOtp("");
        setResendIn(RESEND_COOLDOWN_SECONDS);
        setNotice(`We sent another code to ${email}.`);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? friendlyOtpSendError(
              requestError.message,
              "Nova could not send another sign-in code."
            )
          : "Nova could not send another sign-in code."
      );
    } finally {
      setResending(false);
    }
  }

  async function verifyOTP(event: FormEvent) {
    event.preventDefault();
    if (!neonAuth) {
      setError("Nova's sign-in is temporarily unavailable. Please try again shortly.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await neonAuth.signIn.emailOtp({ email, otp });
      if (result.error) setError(result.error.message ?? "Nova could not verify that sign-in code.");
      else {
        const session = await neonAuth.getSession();
        if (session.data?.session) {
          const jwt = await exchangeNeonVerifierAndGetJwt(neonAuth);
          if (!jwt) {
            setError("Signed in, but Nova could not load your session. Please refresh.");
            return;
          }
          await utils.auth.me.invalidate();
          const user = await utils.auth.me.fetch();
          if (user) {
            clearPendingSignIn();
            updateLastActiveTimestamp(user.id);
            setLocation("/app");
          } else {
            const status = await utils.auth.banStatus.fetch().catch(() => null);
            if (status?.banned) {
              setError("Your account has been disabled by a Nova administrator. Contact the Nova team if you believe this is a mistake.");
            } else {
              setError("Signed in, but Nova could not load your account session. Check your deployment auth configuration.");
            }
          }
        } else {
          setError("Signed in, but Nova could not load your session. Please refresh.");
        }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Nova could not verify that sign-in code.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background p-6 text-foreground">
      <div className="absolute -top-32 left-1/2 size-96 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
      <Link href="/" className="absolute start-5 top-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={15} className="rtl:-scale-x-100" /> Back to site
      </Link>

      <section className="relative w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-[0_8px_30px_rgba(0,0,0,0.12)] sm:p-10">
        <div className="flex items-center gap-2.5">
          <NovaLogo size={26} ariaHidden={false} />
          <span className="text-lg font-extrabold tracking-tight text-card-foreground">Nova</span>
        </div>
        <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-card-foreground">Get started with Nova.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Enter your email and we&rsquo;ll create your account automatically &mdash; new workspaces start with a free
          14-day trial, no card required. Already have one? This signs you back in.
        </p>

        {sent ? (
          <div className="mt-7 rounded-2xl border border-primary/25 bg-primary/10 p-5">
            <Mail className="mb-3 text-primary" size={18} />
            <strong className="block text-sm text-card-foreground">Check your email.</strong>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">We sent a 6-digit code to <span className="font-semibold text-card-foreground">{email}</span>. Enter it below to sign in.</p>
            <form onSubmit={verifyOTP} className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-card-foreground">
                Verification code
                <div className="mt-3 flex justify-center"><InputOTP maxLength={6} value={otp} onChange={setOtp} disabled={pending}><InputOTPGroup><InputOTPSlot index={0} /><InputOTPSlot index={1} /><InputOTPSlot index={2} /><InputOTPSlot index={3} /><InputOTPSlot index={4} /><InputOTPSlot index={5} /></InputOTPGroup></InputOTP></div>
              </label>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {notice ? <p className="text-sm text-primary">{notice}</p> : null}
              <button className="pill-btn pill-btn-primary w-full" disabled={pending || otp.length !== 6} type="submit">{pending ? "Verifying..." : <>Sign in <ArrowRight size={15} className="rtl:-scale-x-100" /></>}</button>
              <div className="space-y-2 text-center text-sm text-muted-foreground">
                <button
                  className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:no-underline"
                  disabled={resending || resendIn > 0}
                  onClick={resendOTP}
                  type="button"
                >
                  {resendIn > 0
                    ? `Resend a new code in ${resendIn}s`
                    : resending
                      ? "Sending a new code..."
                      : "Didn't get the code? Resend it"}
                </button>
                <button type="button" className="w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => { clearPendingSignIn(); setSent(false); setOtp(""); setError(null); setNotice(null); }} disabled={pending}>Use a different email</button>
              </div>
            </form>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Codes expire after a few minutes. If nothing arrives, check your spam folder before resending.</p>
          </div>
        ) : (
          <form onSubmit={requestOTP} className="mt-7 space-y-4">
            <label className="block text-sm font-semibold text-card-foreground">
              Email address
              <input className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-4 text-base text-foreground outline-none transition placeholder:text-muted-foreground sm:text-sm focus:border-ring focus:ring-4 focus:ring-ring/15" name={EMAIL_INPUT_NAME} value={email} onChange={event => setEmail(event.target.value)} type="email" autoComplete="email" required placeholder="you@example.com" />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <button className="pill-btn pill-btn-primary w-full" disabled={pending} type="submit">{pending ? "Sending code..." : <>Create my account <ArrowRight size={15} className="rtl:-scale-x-100" /></>}</button>
          </form>
        )}

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">No password, no card, no install &mdash; we email a one-time code that signs you in or opens your workspace. Your trial starts free and nothing is charged unless you choose a plan.</p>
      </section>
    </main>
  );
}
