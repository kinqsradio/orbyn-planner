import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNow } from "../../app/clock";
import { useRouter } from "../../app/router";
import { useUi } from "../../app/ui";
import { Icon } from "../../components/Icon";
import { Portal } from "../../components/Portal";
import { useDialog } from "../../components/useDialog";
import { formatDue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import type { Task, TaskList } from "../../store/types";
import { describeRepeat, parseQuickAdd } from "../tasks/quickAdd";
import { isLive, openCount } from "../tasks/selectors";
import { Swatch } from "../tasks/TaskRow";

type Item =
  | { kind: "add"; id: string; label: string }
  | { kind: "task"; id: string; task: Task; list?: TaskList }
  | { kind: "list"; id: string; list: TaskList };

interface Section {
  title: string;
  items: Item[];
}

/** Search or add: finds tasks and lists as you type, or adds a task from plain words. */
export function SearchDialog() {
  const store = useStore();
  const { tasks, lists } = usePlanner();
  const ui = useUi();
  const router = useRouter();
  const now = useNow();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, ui.closeSearch);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [keep, setKeep] = useState(false);
  const q = query.trim();

  const sections = useMemo<Section[]>(() => {
    if (!q) return [];
    const needle = q.toLowerCase();
    const matchedTasks = tasks
      .filter((t) => isLive(t) && t.title.toLowerCase().includes(needle))
      .sort((a, b) => Number(a.done) - Number(b.done))
      .slice(0, 6);
    const matchedLists = lists.filter((l) => l.name.toLowerCase().includes(needle)).slice(0, 4);
    const exact = tasks.some((t) => isLive(t) && t.title.trim().toLowerCase() === needle);

    const out: Section[] = [];
    const taskSection: Section = {
      title: "Tasks",
      items: matchedTasks.map((t) => ({ kind: "task", id: `task-${t.id}`, task: t, list: lists.find((l) => l.id === t.listId) })),
    };
    const listSection: Section = { title: "Lists", items: matchedLists.map((l) => ({ kind: "list", id: `list-${l.id}`, list: l })) };
    let addSection: Section | null = null;
    if (!exact) {
      const parsed = keep ? { title: q, due: null, listId: null, priority: "none" as const, repeat: null } : parseQuickAdd(q, now, lists);
      const bits = [
        parsed.due && `due ${formatDue(parsed.due, now)}`,
        parsed.listId && lists.find((l) => l.id === parsed.listId)?.name,
        parsed.repeat && describeRepeat(parsed.repeat),
        parsed.priority !== "none" && `${parsed.priority} priority`,
      ].filter(Boolean);
      addSection = {
        title: "Add",
        items: [{ kind: "add", id: "add", label: `Add task “${parsed.title}”${bits.length ? ` · ${bits.join(" · ")}` : ""}` }],
      };
    }
    // A phrase that matches nothing is most likely an add; otherwise the matches come first.
    const found = taskSection.items.length + listSection.items.length > 0;
    if (addSection && !found) out.push(addSection);
    if (taskSection.items.length) out.push(taskSection);
    if (listSection.items.length) out.push(listSection);
    if (addSection && found) out.push(addSection);
    return out;
  }, [q, tasks, lists, now, keep]);

  const flat = sections.flatMap((s) => s.items);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  const pick = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "add") {
      const parsed = keep ? { title: q, due: null, listId: null, priority: "none" as const, repeat: null } : parseQuickAdd(q, now, lists);
      const task = store.addTask({ title: parsed.title, due: parsed.due, listId: parsed.listId ?? undefined, priority: parsed.priority, repeat: parsed.repeat });
      ui.closeSearch();
      ui.showToast(`Added “${task.title}”`);
    } else if (item.kind === "task") {
      ui.closeSearch();
      ui.openTask(item.task.id);
    } else {
      ui.closeSearch();
      ui.selectList(item.list.id);
      router.navigate("/lists");
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(flat[current]);
    }
  };

  const activeItem = flat[current];

  return (
    <Portal>
    <div className="modal-back top" onMouseDown={(e) => e.target === e.currentTarget && ui.closeSearch()}>
      <div ref={ref} className="authcard" style={{ width: "var(--sp-620)", padding: "var(--sp-10)", gap: "var(--sp-4)" }} role="dialog" aria-modal="true" aria-label="Search or add" tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="field bare">
          <Icon name="search" small />
          <input
            data-autofocus
            role="combobox"
            aria-label="Search or add"
            aria-expanded={flat.length > 0}
            aria-controls="search-results"
            aria-activedescendant={activeItem?.id}
            aria-autocomplete="list"
            placeholder="Search tasks and lists, or add: Call Sam tomorrow 3pm #work !high"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
          {activeItem?.kind === "add" && <span className="t3 hint-right">Enter to add</span>}
        </div>
        <div id="search-results" role="listbox" aria-label="Results">
          {sections.map((section) => (
            <div key={section.title} role="group" aria-label={section.title}>
              <div className="grp" aria-hidden="true">{section.title}</div>
              {section.items.map((item) => (
                <div
                  key={item.id}
                  id={item.id}
                  role="option"
                  aria-selected={item === activeItem}
                  className={item === activeItem ? "nav on" : "nav"}
                  onMouseMove={() => setActive(flat.indexOf(item))}
                  onClick={() => pick(item)}
                >
                  {item.kind === "add" && (<><Icon name="plus" small />{item.label}</>)}
                  {item.kind === "task" && (<><Icon name="check" small />{item.task.title}<span className="n">{item.list?.name}</span></>)}
                  {item.kind === "list" && (<><Swatch colour={item.list.colour} />{item.list.name}<span className="n">{openCount(tasks, item.list.id)} open</span></>)}
                </div>
              ))}
            </div>
          ))}
        </div>
        {flat.some((i) => i.kind === "add") && (
          <label className="check-row search-hint">
            <input type="checkbox" className="check" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            Keep as typed
          </label>
        )}
        {!q && <p className="t3 search-hint">Type to search, or add a task in plain words.</p>}
        {q && sections.length === 0 && <p className="t3 search-hint">No match.</p>}
      </div>
    </div>
    </Portal>
  );
}
