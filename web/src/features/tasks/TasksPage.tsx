import { useMemo, useState } from "react";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { EmptyState, PageHeader } from "../../components/EmptyState";
import { formatDue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { parseQuickAdd } from "./quickAdd";
import { DUE_FILTERS, activeTasks, matchesDue, sortByDue, type DueFilter } from "./selectors";
import { TaskRow } from "./TaskRow";
import { Link } from "../../app/router";

type View = "list" | "board";

export function QuickAddField() {
  const store = useStore();
  const { lists, ready } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseQuickAdd(text, now, lists), [text, now, lists]);

  const bits = [
    parsed.due && formatDue(parsed.due, now),
    parsed.listId && lists.find((l) => l.id === parsed.listId)?.name,
    parsed.priority !== "none" && `${parsed.priority} priority`,
  ].filter(Boolean);

  return (
    <form
      className="quick-add"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        const task = store.addTask({
          title: parsed.title,
          due: parsed.due,
          listId: parsed.listId ?? undefined,
          priority: parsed.priority,
        });
        ui.showToast(`Added “${task.title}”`);
        setText("");
      }}
    >
      <input
        className="text-input"
        aria-label="Add a task"
        placeholder="Add a task, e.g. dentist friday 3pm #errands !high"
        value={text}
        disabled={!ready}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="quick-add-hint" aria-live="polite">
        {text.trim() && bits.length > 0 ? bits.join(" · ") : ""}
      </p>
    </form>
  );
}

export function TasksPage() {
  const { tasks, lists } = usePlanner();
  const now = useNow();
  const [view, setView] = useState<View>("list");
  const [due, setDue] = useState<DueFilter>("any");
  const [listId, setListId] = useState("");

  const shown = useMemo(
    () =>
      sortByDue(
        activeTasks(tasks, now).filter(
          (t) => matchesDue(t, due, now) && (listId === "" || t.listId === listId),
        ),
      ),
    [tasks, now, due, listId],
  );

  return (
    <>
      <PageHeader title="Tasks">
        <div className="header-actions">
          <Link to="/completed" className="link-quiet">Completed and deleted</Link>
          <div role="radiogroup" aria-label="View" className="segmented">
            {(["list", "board"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} className="segment" onClick={() => setView(v)}>
                {v === "list" ? "List" : "Board"}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      <div className="filters">
        <div role="radiogroup" aria-label="Due date" className="pills">
          {DUE_FILTERS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={due === f.id} className="pill" onClick={() => setDue(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="select-pill">
          <span className="visually-hidden">List</span>
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">All lists</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={tasks.some((t) => t.deletedAt === null) ? "No tasks match" : "No tasks yet"}
          body={tasks.some((t) => t.deletedAt === null) ? "Try another filter." : "Add one below."}
        />
      ) : view === "list" ? (
        <ul className="task-list">
          {shown.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      ) : (
        <div className="board">
          {([["To do", false], ["Done", true]] as const).map(([label, done]) => {
            const lane = shown.filter((t) => t.done === done);
            return (
              <section key={label} className="lane" aria-label={label}>
                <h2 className="section-title">
                  {label} <span className="meta-text">{lane.length}</span>
                </h2>
                <ul className="task-list">
                  {lane.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <QuickAddField />
    </>
  );
}
