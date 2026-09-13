import { Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/nav";

export default function More() {
  const [, setLocation] = useLocation();

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">More</h1>
            <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground">Everything in your Nova workspace.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {navItems.map(item => (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className="group flex min-w-0 w-full items-center gap-3 overflow-hidden rounded-2xl border border-border bg-card p-3.5 text-left transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-sm sm:gap-4 sm:p-4 dark:border-white/10 dark:bg-card dark:hover:border-white/20"
            >
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-neutral-100 text-foreground/80 transition group-hover:bg-[oklch(0.72_0.015_250)]/10 group-hover:text-primary dark:bg-muted dark:text-foreground">
                <item.icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.label}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground dark:text-muted-foreground">{item.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
