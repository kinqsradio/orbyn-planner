import { useRef, useState } from "react";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { Icon } from "../../components/Icon";
import { useDialog } from "../../components/useDialog";
import { makeDue, parseDue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { PRIORITIES, type Task } from "../../store/types";
import { needsAction } from "./selectors";

const isPhone = () => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;

function Panel({ task }: { task: Task }) {
  const store = useStore();
  const { lists } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  const phone = isPhone();
  useDialog(ref, ui.closeTask, phone);

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [step, setStep] = useState("");

  const dayValue = task.due ? task.due.slice(0, 10) : "";
  const timeValue = task.due && parseDue(task.due).hasTime ? task.due.slice(11, 16) : "";
  const doneSteps = task.checklist.filter((c) => c.done).length;

  const setDue = (day: string, time: string) => {
    if (!day && !time) return store.updateTask(task.id, { due: null });
    const base = day ? parseDue(day).date : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [h = 0, m = 0] = time ? time.split(":").map(Number) : [];
    base.setHours(h, m);
    store.updateTask(task.id, { due: makeDue(base, time !== "") });
  };

  const commitTitle = () => {
    const next = title.trim();
    if (next === "") setTitle(task.title);
    else if (next !== task.title) store.updateTask(task.id, { title: next });
  };

  const addStep = () => {
    const text = step.trim();
    if (!text) return;
    store.updateTask(task.id, { checklist: [...task.checklist, { id: crypto.randomUUID(), title: text, done: false }] });
    setStep("");
  };

  const remove = () => {
    store.deleteTask(task.id);
    ui.closeTask();
    ui.showToast("Task deleted", () => store.restoreTask(task.id));
  };

  return (
    <aside ref={ref} className="task-panel" role={phone ? "dialog" : "complementary"} aria-modal={phone ? "true" : undefined} aria-label="Task" tabIndex={-1}>
      <div className="tp-head">
        <input
          type="checkbox"
          className="check"
          checked={task.done}
          aria-label={`Complete ${task.title}`}
          onChange={(e) => store.setDone(task.id, e.target.checked)}
        />
        <input
          className="tp-title"
          aria-label="Title"
          value={title}
          data-autofocus
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <button type="button" className="icon-btn" aria-label="Close" onClick={ui.closeTask}>
          <Icon name="x" />
        </button>
      </div>

      <div className="kv">
        <span>Due</span>
        <b className="ctl" style={needsAction(task, now) ? { color: "var(--amber)" } : undefined}>
          <input className="inp" type="date" aria-label="Due date" value={dayValue} onChange={(e) => setDue(e.target.value, timeValue)} />
          <input className="inp" type="time" aria-label="Due time" value={timeValue} onChange={(e) => setDue(dayValue, e.target.value)} />
        </b>
      </div>
      <div className="kv">
        <span>List</span>
        <b className="ctl">
          <select className="inp" aria-label="List" value={task.listId} onChange={(e) => store.updateTask(task.id, { listId: e.target.value })}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </b>
      </div>
      <div className="kv">
        <span>Priority</span>
        <b className="ctl">
          <select className="inp" aria-label="Priority" value={task.priority} onChange={(e) => store.updateTask(task.id, { priority: e.target.value as Task["priority"] })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p === "none" ? "None" : p[0]!.toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </b>
      </div>

      <div className="bh">
        <b>Checklist</b>
        <span>{task.checklist.length > 0 ? `${doneSteps} of ${task.checklist.length}` : ""}</span>
      </div>
      <ul>
        {task.checklist.map((item) => (
          <li key={item.id} className="row step-row" data-done={item.done}>
            <input
              type="checkbox"
              className="check"
              checked={item.done}
              aria-label={item.title}
              onChange={(e) =>
                store.updateTask(task.id, {
                  checklist: task.checklist.map((c) => (c.id === item.id ? { ...c, done: e.target.checked } : c)),
                })
              }
            />
            <span className="what">{item.title}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${item.title}`}
              onClick={() => store.updateTask(task.id, { checklist: task.checklist.filter((c) => c.id !== item.id) })}
            >
              <Icon name="x" small />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="step-form"
        onSubmit={(e) => {
          e.preventDefault();
          addStep();
        }}
      >
        <input className="field" aria-label="Add a step" placeholder="Add a step" value={step} onChange={(e) => setStep(e.target.value)} />
      </form>

      <div className="bh"><b>Notes</b><span></span></div>
      <textarea
        className="field notes"
        aria-label="Notes"
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== task.notes && store.updateTask(task.id, { notes })}
      />

      <div className="tp-foot">
        <button type="button" className="ghost danger" onClick={remove}>Delete</button>
        <button type="button" className="btn" onClick={() => store.setDone(task.id, !task.done)}>
          {task.done ? "Mark not done" : "Complete"}
        </button>
      </div>
    </aside>
  );
}

export function TaskPanel() {
  const { tasks } = usePlanner();
  const { taskId } = useUi();
  const task = tasks.find((t) => t.id === taskId && t.deletedAt === null);
  return task ? <Panel key={task.id} task={task} /> : null;
}
