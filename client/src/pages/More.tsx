import React from "react";
import { Folder, HardDrive, MessageSquareText, Rocket, Settings2, Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";

const nav = [
  { icon: HardDrive, label: "Home", path: "/app", description: "Your Nova workspace and computer" },
  { icon: Folder, label: "Files", path: "/app/files", description: "Browse and manage your files" },
  { icon: MessageSquareText, label: "Chats", path: "/app/chats", description: "Continue conversations with Nova" },
  { icon: Rocket, label: "Deployments", path: "/app/deployments", description: "Manage your deployed apps and services" },
  { icon: Settings2, label: "Settings", path: "/app/settings", description: "Configure your workspace" },
];

export default function More() {
  const [, setLocation] = useLocation();

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-[#f97316]/10 text-[#f97316]">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">More</h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Everything in your Nova workspace.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {nav.map(item => (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className="group flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-sm dark:border-white/10 dark:bg-neutral-900 dark:hover:border-white/20"
            >
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-neutral-100 text-neutral-700 transition group-hover:bg-[#f97316]/10 group-hover:text-[#f97316] dark:bg-neutral-800 dark:text-neutral-200">
                <item.icon className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">{item.label}</p>
                <p className="mt-1 truncate text-sm text-neutral-500 dark:text-neutral-400">{item.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
