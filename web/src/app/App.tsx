import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { useDialog } from "../components/useDialog";
import { CalendarPage } from "../features/calendar/CalendarPage";
import { ListsPage } from "../features/lists/ListsPage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { SearchPage } from "../features/search/SearchPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { TasksPage } from "../features/tasks/TasksPage";
import { TodayPage } from "../features/today/TodayPage";
import { MORE, NAV, SETTINGS, TABS, type NavItem } from "./nav";
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

function NavLink({ item, className = "nav", onNavigate }: { item: NavItem; className?: string; onNavigate?: () => void }) {
  return (
    <Link to={item.path} className={className} onClick={onNavigate}>
      <Icon name={item.icon} />
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
    <label className="search">
      <Icon name="search" small />
      <input ref={input} type="text" placeholder="Search or add" aria-label="Search or add" aria-keyshortcuts="Control+K Meta+K" />
      <kbd>⌘K</kbd>
    </label>
  );
}

/** The phone's way to Projects, Notifications and Settings, which have no room in the bar. */
function MoreSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  return (
    <>
      <button type="button" className="more-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div ref={ref} className="more-sheet" role="dialog" aria-modal="true" aria-label="More" tabIndex={-1}>
        {MORE.map((item) => (
          <NavLink key={item.path} item={item} onNavigate={onClose} />
        ))}
      </div>
    </>
  );
}

function Shell() {
  const { path } = useRouter();
  const [more, setMore] = useState(false);
  const main = useRef<HTMLElement>(null);
  const page = PAGES[path === "/" ? "/today" : path] ?? PAGES["/today"]!;
  const inMore = MORE.some((item) => item.path === path);

  return (
    <div className="app">
      <a
        className="skip"
        href="#content"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="side">
        <QuickFind />
        <nav aria-label="Primary" className="primary">
          {NAV.map((item) => (
            <NavLink key={item.path} item={item} />
          ))}
          <NavLink item={SETTINGS} className="nav bottom" />
        </nav>
      </aside>
      <main id="content" ref={main} tabIndex={-1} className="sheet">
        {page()}
      </main>
      <nav aria-label="Tabs" className="tabbar">
        {TABS.map((item) => (
          <NavLink key={item.path} item={item} className="tab" />
        ))}
        <button type="button" className={more || inMore ? "tab on" : "tab"} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
          <Icon name="more" />
          <span>More</span>
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
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
