import { Search } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { CalendarPage } from "../features/calendar/CalendarPage";
import { ListsPage } from "../features/lists/ListsPage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { SearchPage } from "../features/search/SearchPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { TasksPage } from "../features/tasks/TasksPage";
import { TodayPage } from "../features/today/TodayPage";
import { NAV, SETTINGS, TABS, type NavItem } from "./nav";
import { Link, RouterProvider, useRouter } from "./router";

const PAGES: Record<string, () => ReactNode> = {
  "/today": () => <TodayPage />,
  "/tasks": () => <TasksPage />,
  "/calendar": () => <CalendarPage />,
  "/lists": () => <ListsPage />,
  "/projects": () => <ProjectsPage />,
  "/notifications": () => <NotificationsPage />,
  "/settings": () => <SettingsPage />,
  "/search": () => <SearchPage />,
};

function NavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link to={item.path} className="nav-link">
      <Icon size={18} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

function QuickFind() {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <label className="quick-find">
      <Search size={16} aria-hidden="true" />
      <input ref={input} type="text" placeholder="Search or add" aria-label="Search or add" />
      <kbd>⌘K</kbd>
    </label>
  );
}

function Shell() {
  const { path } = useRouter();
  const page = PAGES[path === "/" ? "/today" : path] ?? PAGES["/today"]!;
  return (
    <div className="shell">
      <aside className="sidebar">
        <QuickFind />
        <nav aria-label="Main" className="nav">
          {NAV.map((item) => (
            <NavLink key={item.path} item={item} />
          ))}
        </nav>
        <div className="nav nav-bottom">
          <NavLink item={SETTINGS} />
        </div>
      </aside>
      <main className="sheet">{page()}</main>
      <nav aria-label="Tabs" className="tabbar">
        {TABS.map((item) => (
          <NavLink key={item.path} item={item} />
        ))}
      </nav>
    </div>
  );
}

export function App() {
  return (
    <RouterProvider>
      <Shell />
    </RouterProvider>
  );
}
