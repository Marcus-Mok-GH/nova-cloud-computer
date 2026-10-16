import { Activity, Bell, Bot, Folder, LayoutGrid, MessageSquareText, Puzzle, Rocket, Settings2, ShieldCheck, SquareTerminal, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/i18n";

/** A single entry in Nova's primary dashboard navigation. `badge` renders an optional unread-count pill. Labels and descriptions are translation keys, resolved with `t()` at render time. */
export type NavItem = { icon: LucideIcon; labelKey: TranslationKey; path: string; descriptionKey?: TranslationKey; badge?: number };

export const navItems: NavItem[] = [
  { icon: LayoutGrid, labelKey: "nav.overview", path: "/app", descriptionKey: "nav.overview.desc" },
  { icon: Folder, labelKey: "nav.files", path: "/app/files", descriptionKey: "nav.files.desc" },
  { icon: MessageSquareText, labelKey: "nav.chats", path: "/app/chats", descriptionKey: "nav.chats.desc" },
  { icon: Bot, labelKey: "nav.agents", path: "/app/agents", descriptionKey: "nav.agents.desc" },
  { icon: Puzzle, labelKey: "nav.skills", path: "/app/skills", descriptionKey: "nav.skills.desc" },
  { icon: Rocket, labelKey: "nav.deployments", path: "/app/deployments", descriptionKey: "nav.deployments.desc" },
  { icon: SquareTerminal, labelKey: "nav.terminal", path: "/app/terminal", descriptionKey: "nav.terminal.desc" },
  { icon: Settings2, labelKey: "nav.settings", path: "/app/settings", descriptionKey: "nav.settings.desc" },
  { icon: Activity, labelKey: "nav.status", path: "/app/status", descriptionKey: "nav.status.desc" },
];

/** Shown in the sidebar only for accounts whose role is `admin`. */
export const adminNavItem: NavItem = { icon: ShieldCheck, labelKey: "nav.admin", path: "/app/admin", descriptionKey: "nav.admin.desc" };

/** Shown in the sidebar only for accounts whose role is `admin` or `developer`. Links straight to the admin console's Notifications tab. */
export const notificationsNavItem: NavItem = { icon: Bell, labelKey: "nav.notifications", path: "/app/admin/notifications", descriptionKey: "nav.notifications.desc" };
