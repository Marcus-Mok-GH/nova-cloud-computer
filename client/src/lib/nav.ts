import { Folder, HardDrive, MessageSquareText, Rocket, Settings2, type LucideIcon } from "lucide-react";

/** A single entry in Nova's primary dashboard navigation. */
export type NavItem = { icon: LucideIcon; label: string; path: string; description?: string };

export const navItems: NavItem[] = [
  { icon: HardDrive, label: "Home", path: "/app", description: "Your Nova workspace and computer" },
  { icon: Folder, label: "Files", path: "/app/files", description: "Browse and manage your files" },
  { icon: MessageSquareText, label: "Chats", path: "/app/chats", description: "Continue conversations with Nova" },
  { icon: Rocket, label: "Deployments", path: "/app/deployments", description: "Manage your deployed apps and services" },
  { icon: Settings2, label: "Settings", path: "/app/settings", description: "Configure your workspace" },
];