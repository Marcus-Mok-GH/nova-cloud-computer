import { Activity, Folder, LayoutGrid, MessageSquareText, Rocket, Settings2, ShieldCheck, SquareTerminal, type LucideIcon } from "lucide-react";

/** A single entry in Nova's primary dashboard navigation. */
export type NavItem = { icon: LucideIcon; label: string; path: string; description?: string };

export const navItems: NavItem[] = [
  { icon: LayoutGrid, label: "Overview", path: "/app", description: "Your Nova workspace and computer" },
  { icon: Folder, label: "Files", path: "/app/files", description: "Browse and manage your files" },
  { icon: MessageSquareText, label: "Chats", path: "/app/chats", description: "Continue conversations with Nova" },
  { icon: Rocket, label: "Deployments", path: "/app/deployments", description: "Manage your deployed apps and services" },
  { icon: SquareTerminal, label: "Terminal", path: "/app/terminal", description: "A live shell in your agent VM" },
  { icon: Settings2, label: "Settings", path: "/app/settings", description: "Configure your workspace" },
  { icon: Activity, label: "Status", path: "/app/status", description: "Live health of every page and service" },
];

/** Shown in the sidebar only for accounts whose role is `admin`. */
export const adminNavItem: NavItem = { icon: ShieldCheck, label: "Admin", path: "/app/admin", description: "System health and account management" };
