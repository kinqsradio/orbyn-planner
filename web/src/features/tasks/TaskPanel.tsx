import { X } from "lucide-react";
import { useRef, useState } from "react";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { useDialog } from "../../components/useDialog";
import { makeDue, parseDue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { PRIORITIES, type Task } from "../../store/types";

function Panel({ task }: { task: Task }) {
  const store = useStore();
  const { lists } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useDialog(ref, ui.closeTask);

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [step, setStep] = useState("");

  const due = task.due ? parseDue(task.due) : null;
  const dayValue = task.due ? task.due.slice(0, 10) : "";
  const timeValue = due?.hasTime ? task.due!.slice(11, 16) : "";

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
    <aside ref={ref} className="panel" role="dialog" aria-modal="true" aria-label="Task" tabIndex={-1}>
      <div className="panel-head">
        <input
          className="panel-title"
          aria-label="Title"
          value={title}
          data-autofocus
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <button type="button" className="icon-btn" aria-label="Close" onClick={ui.closeTask}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="panel-body">
        <div className="field-row">
          <label className="field">
            <span>Due date</span>
            <input type="date" value={dayValue} onChange={(e) => setDue(e.target.value, timeValue)} />
          </label>
          <label className="field">
            <span>Time</span>
            <input type="time" value={timeValue} onChange={(e) => setDue(dayValue, e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>List</span>
            <select value={task.listId} onChange={(e) => store.updateTask(task.id, { listId: e.target.value })}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Priority</span>
            <select
              value={task.priority}
              onChange={(e) => store.updateTask(task.id, { priority: e.target.value as Task["priority"] })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p === "none" ? "None" : p[0]!.toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section aria-labelledby="checklist-h">
          <h2 id="checklist-h" className="section-title">Checklist</h2>
          <ul className="checklist">
            {task.checklist.map((item) => (
              <li key={item.id}>
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
                <span data-done={item.done}>{item.title}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${item.title}`}
                  onClick={() => store.updateTask(task.id, { checklist: task.checklist.filter((c) => c.id !== item.id) })}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              addStep();
            }}
          >
            <input className="text-input" aria-label="Add a step" placeholder="Add a step" value={step} onChange={(e) => setStep(e.target.value)} />
            <button type="submit" className="btn btn-soft">Add</button>
          </form>
        </section>

        <label className="field">
          <span>Notes</span>
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== task.notes && store.updateTask(task.id, { notes })}
          />
        </label>
      </div>

      <div className="panel-foot">
        <button type="button" className="btn btn-primary" onClick={() => store.setDone(task.id, !task.done)}>
          {task.done ? "Mark not done" : "Complete"}
        </button>
        <button type="button" className="btn btn-danger" onClick={remove}>
          Delete
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
