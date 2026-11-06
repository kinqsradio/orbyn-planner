import { useMemo, useState } from "react";
import { useNow } from "../../app/clock";
import { Link } from "../../app/router";
import { useUi } from "../../app/ui";
import { EmptyState, PageHeader } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatDue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { describeParse, parseQuickAdd } from "./quickAdd";
import { DUE_FILTERS, activeTasks, groupTasks, isOpen, matchesDue, sortByDue, type DueFilter } from "./selectors";
import { Swatch, TaskRow, useTaskActions } from "./TaskRow";
import type { Task } from "../../store/types";

type View = "list" | "board";

export function QuickAddField() {
  const store = useStore();
  const { lists, ready } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const [text, setText] = useState("");
  const [keep, setKeep] = useState(false);
  const typed = text.trim();
  const parsed = useMemo(
    () => (keep ? { title: typed, due: null, listId: null, priority: "none" as const, repeat: null } : parseQuickAdd(text, now, lists)),
    [text, typed, keep, now, lists],
  );
  const preview = keep ? "" : describeParse(parsed, lists, now);

  return (
    <div className="addbar">
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!typed) return;
        const task = store.addTask({ title: parsed.title, due: parsed.due, listId: parsed.listId ?? undefined, priority: parsed.priority, repeat: parsed.repeat });
        ui.showToast(`Added “${task.title}”`);
        setText("");
      }}
    >
      <input
        className="field"
        aria-label="Add a task"
        placeholder="Add a task: Call Sam tomorrow 3pm #work !high"
        value={text}
        disabled={!ready}
        onChange={(e) => setText(e.target.value)}
      />
    </form>
    <div className="hint-row">
      <p className="hint" aria-live="polite">{preview}</p>
      {(preview !== "" || keep) && (
        <label className="check-row">
          <input type="checkbox" className="check" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          Keep as typed
        </label>
      )}
    </div>
    </div>
  );
}

function BoardCard({ task }: { task: Task }) {
  const { lists } = usePlanner();
  const { open } = useTaskActions(task);
  const now = useNow();
  const list = lists.find((l) => l.id === task.listId);
  return (
    <li className="tcard" data-row-id={task.id} data-done={task.done}>
      <button type="button" className="tt link-btn" onClick={open}>{task.title}</button>
      <span className="m">
        {list && <Swatch colour={list.colour} />}
        {[list?.name, task.due && formatDue(task.due, now)].filter(Boolean).join(" · ")}
      </span>
    </li>
  );
}

export function TasksPage() {
  const { tasks, lists } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const [view, setView] = useState<View>("list");
  const [due, setDue] = useState<DueFilter>("any");
  const [listId, setListId] = useState("");

  const shown = useMemo(
    () => activeTasks(tasks, now).filter((t) => matchesDue(t, due, now) && (listId === "" || t.listId === listId)),
    [tasks, now, due, listId],
  );
  const groups = useMemo(() => groupTasks(shown, now), [shown, now]);
  const openCount = tasks.filter(isOpen).length;
  const anyTask = tasks.some((t) => t.deletedAt === null);

  return (
    <>
      <PageHeader title="Tasks" sub={view === "board" ? "Board" : `${openCount} open`}>
        <Link to="/completed" className="ghost">Completed and deleted</Link>
        <button type="button" className="btn" onClick={() => ui.openNewTask()}>
          <Icon name="plus" small />
          Add a task
        </button>
      </PageHeader>

      <div className="filters">
        <div role="radiogroup" aria-label="View" className="pills">
          {(["list", "board"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} className="pill" onClick={() => setView(v)}>
              {v === "list" ? "List" : "Board"}
            </button>
          ))}
        </div>
        <span style={{ width: 12 }} />
        <div role="radiogroup" aria-label="Due date" className="pills">
          {DUE_FILTERS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={due === f.id} className="pill" onClick={() => setDue(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="pill select-pill">
          <span className="visually-hidden">List</span>
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Any list</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="pill" style={{ marginLeft: "auto" }} onClick={ui.openSearch}>
          <Icon name="search" small />
          Search tasks
        </button>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={anyTask ? "No tasks match" : "No tasks yet"}
          body={anyTask ? "Try another filter." : "Add one below, or use Add a task."}
        />
      ) : view === "list" ? (
        <div className="tbl-wrap">
          <ul className="tbl">
            <li className="tr h" aria-hidden="true" style={{ gridTemplateColumns: "22px minmax(0,1fr) 120px 110px 70px" }}>
              <span /><span>Task</span><span>List</span><span>Due</span><span>Priority</span>
            </li>
          </ul>
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <div className="bh" style={{ padding: "8px 4px 4px" }}>
                <b className={g.amber ? "amber" : undefined}>{g.label}</b>
                <span>{g.tasks.length}</span>
              </div>
              <ul className="tbl">
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="board">
          {([["To do", false], ["Done", true]] as const).map(([label, done]) => {
            const lane = sortByDue(shown.filter((t) => t.done === done));
            return (
              <section key={label} className="lane" aria-label={label}>
                <h2 className="lane-h">{label}<span>{lane.length}</span></h2>
                <ul className="cards">
                  {lane.map((t) => (
                    <BoardCard key={t.id} task={t} />
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
