import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Copy, Eye, EyeOff, KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function Profile() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const [showPassword, setShowPassword] = useState(false);
  const email = user?.email ?? "Not available";

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      toast.success("Email copied to clipboard.");
    } catch {
      toast.error("Could not copy your email.");
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-7 px-4 pb-12 pt-5 sm:px-6">
        <header>
          <div className="flex items-center gap-4">
            <div className="grid size-12 place-items-center rounded-2xl bg-[oklch(0.72 0.015 250)]/10 text-[oklch(0.72 0.015 250)]">
              <UserRound size={22} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[oklch(0.72 0.015 250)]">Account</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-neutral-950 dark:text-white">Your profile</h1>
            </div>
          </div>
          <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">View the account details connected to your Nova workspace.</p>
        </header>

        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_1px_2px_rgba(10,10,10,0.03)] dark:border-white/10 dark:bg-neutral-900 sm:p-7">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Profile details</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-neutral-950 dark:text-white">Account information</h2>

          <div className="mt-6 space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-white/5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[oklch(0.72 0.015 250)]/10 text-[oklch(0.72 0.015 250)]"><Mail size={18} /></span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-neutral-900 dark:text-white">Email address</p>
                  <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{email}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-2 self-start sm:self-auto" onClick={copyEmail}><Copy size={15} /> Copy</Button>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[oklch(0.72 0.015 250)]/10 text-[oklch(0.72 0.015 250)]"><KeyRound size={18} /></span>
                  <div>
                    <p className="text-sm font-bold text-neutral-900 dark:text-white">Password</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">Your account uses passwordless sign-in, so Nova does not store a password that can be displayed.</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="gap-2 self-start sm:self-auto" onClick={() => setShowPassword(value => !value)}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />} {showPassword ? "Hide" : "Reveal"}
                </Button>
              </div>
              {showPassword && <div className="mt-4 rounded-xl border border-dashed border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-500 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-400">No password is stored for this account. Passwordless authentication keeps the credential secret outside the app.</div>}
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-white/10 dark:bg-white/5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><ShieldCheck size={18} /></span>
              <div>
                <p className="text-sm font-bold text-neutral-900 dark:text-white">Account security</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Signed in using Nova's passwordless authentication flow.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}