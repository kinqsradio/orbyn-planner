import type { IconName } from "../components/icons";

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

export const NAV: readonly NavItem[] = [
  { path: "/today", label: "Today", icon: "home" },
  { path: "/tasks", label: "Tasks", icon: "check" },
  { path: "/calendar", label: "Calendar", icon: "cal" },
  { path: "/lists", label: "Lists", icon: "list" },
  { path: "/projects", label: "Projects", icon: "folder" },
  { path: "/notifications", label: "Notifications", icon: "bell" },
];

export const SETTINGS: NavItem = { path: "/settings", label: "Settings", icon: "gear" };

/** Reached from the phone's More tab, which has no room for them in the bar. */
export const MORE: readonly NavItem[] = [NAV[4]!, NAV[5]!, SETTINGS];

/** The phone tab bar: four daily pages and search; More opens the rest. */
export const TABS: readonly NavItem[] = [
  ...NAV.slice(0, 4),
  { path: "/search", label: "Search", icon: "search" },
];
