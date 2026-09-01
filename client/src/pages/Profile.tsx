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
        <section className="rounded-3xl border border-stone-200 bg-[#f2f2ea] px-6 py-8 shadow-sm dark:border-white/10 dark:bg-[#1d292a] sm:px-9">
          <div className="flex items-center gap-4">
            <div className="grid size-14 place-items-center rounded-2xl bg-[#f97316] text-white shadow-sm">
              <UserRound size={26} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.16em] text-stone-500 dark:text-stone-300">Account</p>
              <h1 className="mt-1 font-[DM_Serif_Display] text-4xl tracking-tight text-stone-800 dark:text-stone-100">Your profile</h1>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">View the account details connected to your Nova workspace.</p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border bg-card p-5 shadow-sm sm:p-7">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Profile details</p>
          <h2 className="mt-1 font-[DM_Serif_Display] text-3xl tracking-tight">Account information</h2>

          <div className="mt-6 space-y-4">
            <div className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f97316]/10 text-[#f97316]"><Mail size={18} /></span>
                <div className="min-w-0">
                  <p className="text-sm font-bold">Email address</p>
                  <p className="truncate text-sm text-muted-foreground">{email}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-2 self-start sm:self-auto" onClick={copyEmail}><Copy size={15} /> Copy</Button>
            </div>

            <div className="rounded-2xl border bg-muted/20 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f97316]/10 text-[#f97316]"><KeyRound size={18} /></span>
                  <div>
                    <p className="text-sm font-bold">Password</p>
                    <p className="text-sm text-muted-foreground">Your account uses passwordless sign-in, so Nova does not store a password that can be displayed.</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="gap-2 self-start sm:self-auto" onClick={() => setShowPassword(value => !value)}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />} {showPassword ? "Hide" : "Reveal"}
                </Button>
              </div>
              {showPassword && <div className="mt-4 rounded-xl border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground">No password is stored for this account. Passwordless authentication keeps the credential secret outside the app.</div>}
            </div>

            <div className="flex items-center gap-3 rounded-2xl border bg-muted/20 p-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600"><ShieldCheck size={18} /></span>
              <div>
                <p className="text-sm font-bold">Account security</p>
                <p className="text-sm text-muted-foreground">Signed in using Nova's passwordless authentication flow.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
