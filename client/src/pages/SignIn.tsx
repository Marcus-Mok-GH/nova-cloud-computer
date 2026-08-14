import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { neonAuth } from "@/lib/neonAuth";
import { ArrowLeft, Mail, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";

export default function SignIn() {
  const { isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && isAuthenticated) setLocation("/app");
  }, [isAuthenticated, loading, setLocation]);

  async function requestLink(event: FormEvent) {
    event.preventDefault();
    if (!neonAuth) {
      setError("Nova’s passwordless login is still being connected to its Neon workspace. Please try again shortly.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await neonAuth.signIn.magicLink({ email, callbackURL: `${window.location.origin}/app` });
    setPending(false);
    if (result.error) setError(result.error.message ?? "Nova could not send that sign-in link.");
    else setSent(true);
  }

  return <main className="min-h-screen bg-[#f4f3eb] text-[#202522] flex items-center justify-center p-6">
    <section className="w-full max-w-md rounded-[2rem] border border-black/10 bg-white/65 p-8 shadow-[0_24px_80px_rgba(32,42,40,.12)] backdrop-blur-sm">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-[#53615a] hover:text-[#18231f]"><ArrowLeft size={15} /> Back to Nova</Link>
      <div className="mt-10 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#19312e] text-[#dff1e7]"><Sparkles size={19} /></div>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[.18em] text-[#647067]">Your personal cloud</p>
      <h1 className="mt-2 font-serif text-4xl leading-none tracking-tight">Sign in without a password.</h1>
      {sent ? <div className="mt-6 rounded-2xl border border-[#9dbdb0] bg-[#e5f0e8] p-5 text-sm leading-relaxed text-[#254239]"><Mail className="mb-3" size={18} /><strong className="block">Check your email.</strong> We sent a private, time-limited link to <span className="font-medium">{email}</span>. Open it in this browser to enter Nova.</div> : <form onSubmit={requestLink} className="mt-7 space-y-4"><label className="block text-sm font-medium">Email address<input className="mt-2 h-12 w-full rounded-xl border border-black/15 bg-white px-4 outline-none transition focus:border-[#386a5c] focus:ring-2 focus:ring-[#8ec6b2]/50" value={email} onChange={event => setEmail(event.target.value)} type="email" autoComplete="email" required placeholder="you@example.com" /></label>{error ? <p className="text-sm text-red-700">{error}</p> : null}<Button className="h-12 w-full rounded-xl bg-[#19312e] text-white hover:bg-[#26463f]" disabled={pending} type="submit">{pending ? "Sending secure link…" : "Email me a sign-in link"}</Button></form>}
      <p className="mt-6 text-xs leading-relaxed text-[#68736c]">Nova uses a passwordless, time-limited magic link. We do not store a password for this sign-in method.</p>
    </section>
  </main>;
}
