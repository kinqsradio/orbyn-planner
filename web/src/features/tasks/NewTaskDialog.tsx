import { useRef, useState } from "react";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { Portal } from "../../components/Portal";
import { useDialog } from "../../components/useDialog";
import { makeDue, parseDue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { PRIORITIES, type Priority } from "../../store/types";

/** The "New task" card: a title, and the details a person can fill in right away. */
export function NewTaskDialog() {
  const store = useStore();
  const { lists } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, ui.closeNewTask);

  const inbox = lists.find((l) => l.isInbox);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [listId, setListId] = useState(inbox?.id ?? "");
  const [priority, setPriority] = useState<Priority>("none");

  const submit = () => {
    const text = title.trim();
    if (!text) return;
    let due: string | null = null;
    if (day || time) {
      const base = day ? parseDue(day).date : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const [h = 0, m = 0] = time ? time.split(":").map(Number) : [];
      base.setHours(h, m);
      due = makeDue(base, time !== "");
    }
    const task = store.addTask({ title: text, due, listId: listId || undefined, priority });
    ui.closeNewTask();
    ui.showToast(`Added “${task.title}”`);
  };

  return (
    <Portal>
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && ui.closeNewTask()}>
      <div ref={ref} className="authcard" style={{ width: 480 }} role="dialog" aria-modal="true" aria-label="New task" tabIndex={-1}>
        <b className="card-title">New task</b>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="nt-title">Title</label>
          <input id="nt-title" className="field" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} />
          <label htmlFor="nt-day">Due</label>
          <div className="two">
            <input id="nt-day" className="field" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            <input className="field" type="time" aria-label="Due time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <label htmlFor="nt-list">List</label>
          <select id="nt-list" className="field" value={listId} onChange={(e) => setListId(e.target.value)}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <label htmlFor="nt-priority">Priority</label>
          <select id="nt-priority" className="field" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p === "none" ? "None" : p[0]!.toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={ui.closeNewTask}>Cancel</button>
            <button type="submit" className="btn" disabled={!title.trim()}>Add task</button>
          </div>
        </form>
      </div>
    </div>
    </Portal>
  );
}
