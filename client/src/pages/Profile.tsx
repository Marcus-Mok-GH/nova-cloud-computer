import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { AtSign, Copy, Eye, EyeOff, KeyRound, Loader2, Mail, Pencil, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { UsernamePrompt } from "@/components/UsernamePrompt";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Profile() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const [showPassword, setShowPassword] = useState(false);
  const [usernamePromptOpen, setUsernamePromptOpen] = useState(false);
  const email = user?.email ?? "Not available";
  const utils = trpc.useUtils();
  const changeUsername = trpc.auth.setUsername.useMutation({
    onSuccess: updated => {
      utils.auth.me.setData(undefined, updated);
      toast.success(`Your username is now @${updated.username}.`);
      setUsernamePromptOpen(false);
    },
    onError: error => toast.error(error.message || "Could not change that username."),
  });

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
            <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <UserRound size={22} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Account</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground dark:text-foreground">Your profile</h1>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground dark:text-muted-foreground">View the account details connected to your Nova workspace.</p>
        </header>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,10,10,0.03)] dark:border-white/10 dark:bg-card sm:p-7">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Profile details</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground dark:text-foreground">Account information</h2>

          <div className="mt-6 space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted p-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-card/5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><AtSign size={18} /></span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground dark:text-foreground">Username</p>
                  <p className="truncate text-sm text-muted-foreground dark:text-muted-foreground">{user?.username ? `@${user.username}` : "Not chosen yet - pick one so your AI agent knows what to call you."}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-2 self-start sm:self-auto" onClick={() => setUsernamePromptOpen(true)} disabled={changeUsername.isPending}>{changeUsername.isPending ? <Loader2 size={15} className="animate-spin" /> : <Pencil size={15} />} {user?.username ? "Change" : "Choose"}</Button>
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted p-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-card/5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Mail size={18} /></span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground dark:text-foreground">Email address</p>
                  <p className="truncate text-sm text-muted-foreground dark:text-muted-foreground">{email}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-2 self-start sm:self-auto" onClick={copyEmail}><Copy size={15} /> Copy</Button>
            </div>

            <div className="rounded-xl border border-border bg-muted p-5 dark:border-white/10 dark:bg-card/5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><KeyRound size={18} /></span>
                  <div>
                    <p className="text-sm font-bold text-foreground dark:text-foreground">Password</p>
                    <p className="text-sm text-muted-foreground dark:text-muted-foreground">Your account uses passwordless sign-in, so Nova does not store a password that can be displayed.</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="gap-2 self-start sm:self-auto" onClick={() => setShowPassword(value => !value)}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />} {showPassword ? "Hide" : "Reveal"}
                </Button>
              </div>
              {showPassword && <div className="mt-4 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground dark:border-white/10 dark:bg-card dark:text-muted-foreground">No password is stored for this account. Passwordless authentication keeps the credential secret outside the app.</div>}
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted p-5 dark:border-white/10 dark:bg-card/5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><ShieldCheck size={18} /></span>
              <div>
                <p className="text-sm font-bold text-foreground dark:text-foreground">Account security</p>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">Signed in using Nova's passwordless authentication flow.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
      {usernamePromptOpen && user && <UsernamePrompt user={user} onClose={() => setUsernamePromptOpen(false)} />}
    </DashboardLayout>
  );
}