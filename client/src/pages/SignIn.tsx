import { updateLastActiveTimestamp, useAuth } from "@/_core/hooks/useAuth";
import { exchangeNeonVerifierAndGetJwt, neonAuth } from "@/lib/neonAuth";
import NovaMark from "@/components/NovaMark";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import React, { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { trpc } from "@/lib/trpc";

export default function SignIn() {
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();
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
        const session = await neonAuth.getSession();
        if (session.data?.session) {
          const jwt = await exchangeNeonVerifierAndGetJwt(neonAuth);
          if (!jwt) {
            setError("Signed in, but Nova could not load your session. Please refresh.");
            return;
          }

          // /app uses auth.me to decide whether the user is authenticated.
          // Clear the query created before the OTP exchange; otherwise its
          // cached unauthenticated result can mask the fresh Neon session.
          await utils.auth.me.invalidate();
          // Fetch it before navigation so the backend sees the Neon JWT and
          // creates Nova's first-party session cookie on the same request.
          const user = await utils.auth.me.fetch();
          if (user) {
            // A fresh OTP proves a new interactive session. Reset any prior
            // inactivity marker before the workspace auth hook evaluates it.
            updateLastActiveTimestamp(user.id);
            setLocation("/app");
          } else {
            setError("Signed in, but Nova could not load your account session. Check your deployment auth configuration.");
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0a] p-6">
      <div className="absolute -top-32 left-1/2 size-96 -translate-x-1/2 rounded-full bg-[oklch(0.60_0.02_250/0.06)] blur-3xl" aria-hidden="true" />
      <Link href="/" className="absolute left-5 top-5 inline-flex items-center gap-2 text-sm font-medium text-neutral-400 transition-colors hover:text-white">
        <ArrowLeft size={15} /> Back to site
      </Link>

      <section className="relative w-full max-w-md rounded-2xl border border-white/8 bg-[#141414] p-8 shadow-[0_8px_30px_rgba(0,0,0,0.3)] sm:p-10">
        <div className="flex items-center gap-2.5">
          <NovaMark size={26} ariaHidden={false} />
          <span className="text-lg font-extrabold tracking-tight text-white">Nova</span>
        </div>
        <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-white">Sign in to Nova.</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          Run your projects, files, and AI in a space that works 24/7.
        </p>

        {sent ? (
          <div className="mt-7 rounded-2xl border border-[oklch(0.60_0.02_250/0.25)] bg-[oklch(0.60_0.02_250/0.06)] p-5">
            <Mail className="mb-3 text-[oklch(0.60_0.02_250)]" size={18} />
            <strong className="block text-sm text-white">Check your email.</strong>
            <p className="mt-2 text-sm leading-relaxed text-neutral-300">
              We sent a 6-digit code to <span className="font-semibold">{email}</span>. Enter it below to sign in.
            </p>
            <form onSubmit={verifyOTP} className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-neutral-200">
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
              {error ? <p className="text-sm text-red-400">{error}</p> : null}
              <button
                className="pill-btn pill-btn-primary w-full"
                disabled={pending || otp.length !== 6}
                type="submit"
              >
                {pending ? "Verifying..." : <>Sign in <ArrowRight size={15} /></>}
              </button>
              <button
                type="button"
                className="w-full text-center text-sm text-neutral-400 hover:text-white"
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
            <label className="block text-sm font-semibold text-neutral-200">
              Email address
              <input
                className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#0a0a0a] px-4 text-base text-white sm:text-sm outline-none transition placeholder:text-neutral-500 focus:border-[oklch(0.60_0.02_250)] focus:ring-4 focus:ring-[oklch(0.60_0.02_250/0.15)]"
                value={email}
                onChange={event => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <button
              className="pill-btn pill-btn-primary w-full"
              disabled={pending}
              type="submit"
            >
              {pending ? "Sending code..." : <>Email me a sign-in code <ArrowRight size={15} /></>}
            </button>
          </form>
        )}

        <p className="mt-6 text-xs leading-relaxed text-neutral-500">
          Nova uses a passwordless, time-limited OTP code. We do not store a password for this sign-in method.
        </p>
      </section>
    </main>
  );
}
