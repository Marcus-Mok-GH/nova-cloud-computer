import { useAuth } from "@/_core/hooks/useAuth";
import { exchangeNeonVerifierAndGetJwt, getNeonAccessToken, neonAuth } from "@/lib/neonAuth";
import NovaMark from "@/components/NovaMark";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import React, { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export default function SignIn() {
  const { isAuthenticated, loading, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && isAuthenticated) setLocation("/app");
  }, [isAuthenticated, loading, setLocation]);

  async function requestOTP(event: FormEvent) {
    event.preventDefault();
    if (!neonAuth) {
      setError("Nova's passwordless login is still being connected to its Neon workspace. Please try again shortly.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await neonAuth.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (result.error) setError(result.error.message ?? "Nova could not send that sign-in code.");
      else setSent(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Nova could not send that sign-in code.");
    } finally {
      setPending(false);
    }
  }

  async function verifyOTP(event: FormEvent) {
    event.preventDefault();
    if (!neonAuth) {
      setError("Nova's passwordless login is still being connected to its Neon workspace. Please try again shortly.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await neonAuth.signIn.emailOtp({
        email,
        otp,
      });
      if (result.error) setError(result.error.message ?? "Nova could not verify that sign-in code.");
      else {
        const token = await exchangeNeonVerifierAndGetJwt(neonAuth) ?? await getNeonAccessToken();
        if (!token) {
          setError("Your code was accepted, but Nova could not establish a secure session. Please try again.");
          return;
        }

        const authentication = await refresh();
        if (authentication.data) setLocation("/app");
        else setError("Your code was accepted, but Nova could not confirm your session. Please try again.");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Nova could not verify that sign-in code.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white p-6 dark:bg-neutral-950">
      <div className="absolute -top-32 left-1/2 size-96 -translate-x-1/2 rounded-full bg-[#f97316]/8 blur-3xl" aria-hidden="true" />
      <Link href="/" className="absolute left-5 top-5 inline-flex items-center gap-2 text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
        <ArrowLeft size={15} /> Back to site
      </Link>

      <section className="relative w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-8 shadow-[0_24px_80px_rgba(10,10,10,0.08)] sm:p-10 dark:border-white/10 dark:bg-neutral-900">
        <div className="flex items-center gap-2.5">
          <NovaMark size={26} ariaHidden={false} />
          <span className="text-lg font-extrabold tracking-tight text-neutral-950 dark:text-white">Nova</span>
        </div>
        <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-neutral-950 dark:text-white">Sign in to Nova.</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          Run your projects, files, and AI in a space that works 24/7.
        </p>

        {sent ? (
          <div className="mt-7 rounded-2xl border border-[#f97316]/30 bg-[#f97316]/8 p-5">
            <Mail className="mb-3 text-[#f97316]" size={18} />
            <strong className="block text-sm text-neutral-900 dark:text-white">Check your email.</strong>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
              We sent a 6-digit code to <span className="font-semibold">{email}</span>. Enter it below to sign in.
            </p>
            <form onSubmit={verifyOTP} className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                Verification code
                <div className="mt-3 flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={otp}
                    onChange={setOtp}
                    disabled={pending}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </label>
              {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
              <button
                className="pill-btn pill-btn-primary w-full"
                disabled={pending || otp.length !== 6}
                type="submit"
              >
                {pending ? "Verifying..." : <>Sign in <ArrowRight size={15} /></>}
              </button>
              <button
                type="button"
                className="w-full text-center text-sm text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
                onClick={() => {
                  setSent(false);
                  setOtp("");
                  setError(null);
                }}
                disabled={pending}
              >
                Use a different email
              </button>
            </form>
          </div>
        ) : (
          <form onSubmit={requestOTP} className="mt-7 space-y-4">
            <label className="block text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              Email address
              <input
                className="mt-2 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-base text-neutral-950 sm:text-sm outline-none transition placeholder:text-neutral-400 focus:border-[#f97316] focus:ring-4 focus:ring-[#f97316]/15 dark:border-white/10 dark:bg-neutral-950 dark:text-white"
                value={email}
                onChange={event => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <button
              className="pill-btn pill-btn-primary w-full"
              disabled={pending}
              type="submit"
            >
              {pending ? "Sending code..." : <>Email me a sign-in code <ArrowRight size={15} /></>}
            </button>
          </form>
        )}

        <p className="mt-6 text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
          Nova uses a passwordless, time-limited OTP code. We do not store a password for this sign-in method.
        </p>
      </section>
    </main>
  );
}
