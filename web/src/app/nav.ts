import { Bell, CalendarDays, CircleCheck, FolderKanban, ListTodo, Search, Settings, Sun, type LucideIcon } from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

export const NAV: readonly NavItem[] = [
  { path: "/today", label: "Today", icon: Sun },
  { path: "/tasks", label: "Tasks", icon: CircleCheck },
  { path: "/calendar", label: "Calendar", icon: CalendarDays },
  { path: "/lists", label: "Lists", icon: ListTodo },
  { path: "/projects", label: "Projects", icon: FolderKanban },
  { path: "/notifications", label: "Notifications", icon: Bell },
];

export const SETTINGS: NavItem = { path: "/settings", label: "Settings", icon: Settings };

/** The phone tab bar: the four daily pages and search. */
export const TABS: readonly NavItem[] = [
  ...NAV.slice(0, 4),
  { path: "/search", label: "Search", icon: Search },
];
