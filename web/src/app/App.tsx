import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { useDialog } from "../components/useDialog";
import { CalendarPage } from "../features/calendar/CalendarPage";
import { ListsPage } from "../features/lists/ListsPage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { CompletedPage } from "../features/completed/CompletedPage";
import { SearchDialog } from "../features/search/SearchDialog";
import { NewTaskDialog } from "../features/tasks/NewTaskDialog";
import { TaskPanel } from "../features/tasks/TaskPanel";
import { dueCount } from "../features/tasks/selectors";
import { TasksPage } from "../features/tasks/TasksPage";
import { LocalStore } from "../store/LocalStore";
import { StoreProvider, usePlanner } from "../store/context";
import type { PlannerStore } from "../store/types";
import { Toast } from "../components/Toast";
import { useNow } from "./clock";
import { UiProvider, useUi } from "./ui";
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
  "/completed": () => <CompletedPage />,
};

function NavLink({ item, className = "nav", onNavigate, badge }: { item: NavItem; className?: string; onNavigate?: () => void; badge?: string }) {
  return (
    <Link to={item.path} className={className} onClick={onNavigate}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {badge && <span className="n amber">{badge}</span>}
    </Link>
  );
}

/** The sidebar's search-or-add field: opens the dialog, also from Ctrl+K or Cmd+K. */
function QuickFind() {
  const ui = useUi();
  const { searchOpen, openSearch, closeSearch } = ui;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (searchOpen) closeSearch();
        else openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, openSearch, closeSearch]);
  return (
    <button type="button" className="search" onClick={openSearch} aria-keyshortcuts="Control+K Meta+K" aria-label="Search or add">
      <Icon name="search" small />
      <span>Search or add</span>
      <kbd>⌘K</kbd>
    </button>
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
  const ui = useUi();
  const { tasks } = usePlanner();
  const now = useNow();
  const due = dueCount(tasks, now);
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
            <NavLink key={item.path} item={item} badge={item.path === "/tasks" && due > 0 ? `${due} due` : undefined} />
          ))}
          <NavLink item={SETTINGS} className="nav bottom" />
        </nav>
      </aside>
      <main id="content" ref={main} tabIndex={-1} className="sheet">
        <div className={ui.taskId ? "sheet-grid has-panel" : "sheet-grid"}>
          <div className="sheet-main">{page()}</div>
          <TaskPanel />
        </div>
      </main>
      <nav aria-label="Tabs" className="tabbar">
        {TABS.map((item) =>
          item.path === "/search" ? (
            <button key={item.path} type="button" className="tab" onClick={ui.openSearch}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ) : (
            <NavLink key={item.path} item={item} className="tab" />
          ),
        )}
        <button type="button" className={more || inMore ? "tab on" : "tab"} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
          <Icon name="more" />
          <span>More</span>
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
      {ui.newTaskOpen && <NewTaskDialog />}
      {ui.searchOpen && <SearchDialog />}
      <Toast />
    </div>
  );
}

export function App({ store }: { store?: PlannerStore }) {
  const [own] = useState(() => store ?? new LocalStore());
  return (
    <StoreProvider store={own}>
      <UiProvider>
        <RouterProvider>
          <Shell />
        </RouterProvider>
      </UiProvider>
    </StoreProvider>
  );
}
