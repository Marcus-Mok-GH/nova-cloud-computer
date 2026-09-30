/** Theme selector: pick from a set of light and dark palettes defined in index.css. */
import React from "react";
import { Check, Moon, Palette, Sun } from "lucide-react";
import { useTheme, type ThemeOption } from "@/contexts/ThemeContext";

/**
 * A miniature of the palette. `data-theme` scopes the CSS variables to this
 * box, and the swatches read them directly so the preview always matches the
 * palette regardless of the active page theme.
 */
function ThemeSwatch({ theme }: { theme: ThemeOption }) {
  return (
    <div
      data-theme={theme.id}
      aria-hidden="true"
      style={{ background: "var(--background)", borderColor: "var(--border)" }}
      className="flex h-16 w-full items-end gap-1.5 rounded-xl border p-2.5"
    >
      <span style={{ background: "var(--card)", borderColor: "var(--border)" }} className="h-6 flex-1 rounded-lg border" />
      <span style={{ background: "var(--primary)" }} className="h-6 w-6 rounded-lg" />
      <span style={{ background: "var(--accent)" }} className="h-6 w-6 rounded-lg" />
    </div>
  );
}

function ThemeGroup({ title, icon, options }: { title: string; icon: React.ReactNode; options: ThemeOption[] }) {
  const { themeName, setThemeName } = useTheme();
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-[.14em]">{title}</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {options.map(theme => {
          const active = themeName === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => setThemeName(theme.id)}
              aria-pressed={active}
              className={`rounded-2xl border p-2.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60 ${active ? "border-primary ring-1 ring-primary/40" : "border-border hover:border-primary/40 hover:bg-accent/40"}`}
            >
              <ThemeSwatch theme={theme} />
              <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
                <span className="text-sm font-bold">{theme.label}</span>
                {active && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary"><Check size={13} /> Active</span>}
              </div>
              <p className="px-0.5 text-xs leading-5 text-muted-foreground">{theme.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ThemeCard() {
  const { themes } = useTheme();
  const light = themes.filter(theme => theme.mode === "light");
  const dark = themes.filter(theme => theme.mode === "dark");
  return (
    <section className="rise-in rounded-2xl border bg-card p-5 text-card-foreground shadow-[0_4px_14px_rgba(10,10,10,0.05)] sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">Appearance</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">Theme</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Pick a palette for your workspace. Every light and dark theme is tuned for readable contrast, and your choice is remembered on this device.</p>
        </div>
        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"><Palette size={24} /></div>
      </div>
      <ThemeGroup title="Light" icon={<Sun className="size-3.5" />} options={light} />
      <ThemeGroup title="Dark" icon={<Moon className="size-3.5" />} options={dark} />
    </section>
  );
}
