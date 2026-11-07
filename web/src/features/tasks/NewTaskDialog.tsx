import { useRef, useState } from "react";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { Portal } from "../../components/Portal";
import { useDialog } from "../../components/useDialog";
import { dateKey, makeDue, parseDue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { inOrder } from "../../store/order";
import type { Repeat } from "../../store/repeat";
import { PRIORITIES, type Priority } from "../../store/types";
import { RepeatPicker } from "./RepeatPicker";
import { TASK_REMINDERS } from "./reminder";

/** The "New task" card: a title, and the details a person can fill in right away. */
export function NewTaskDialog() {
  const store = useStore();
  const { lists, projects } = usePlanner();
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
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  const [reminder, setReminder] = useState<number | null>(null);
  const [projectId, setProjectId] = useState(ui.newTaskDefaults.projectId ?? "");
  const [sectionId, setSectionId] = useState(ui.newTaskDefaults.sectionId ?? "");
  const project = projects.find((p) => p.id === projectId);

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
    // A repeat needs a date to start from: today when none was given.
    if (repeat && due === null) due = dateKey(now);
    const task = store.addTask({
      title: text,
      due,
      listId: listId || undefined,
      priority,
      repeat,
      reminder,
      projectId: projectId || null,
      sectionId: project && sectionId ? sectionId : null,
    });
    ui.closeNewTask();
    ui.showToast(`Added “${task.title}”`);
  };

  return (
    <Portal>
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && ui.closeNewTask()}>
      <div ref={ref} className="authcard" style={{ width: "var(--sp-480)" }} role="dialog" aria-modal="true" aria-label="New task" tabIndex={-1}>
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
          <div className="kv">
            <label htmlFor="nt-repeat-slot">Repeat</label>
            <b className="ctl" id="nt-repeat-slot">
              <RepeatPicker value={repeat} start={day || dateKey(now)} onChange={setRepeat} />
            </b>
          </div>
          <div className="kv">
            <label htmlFor="nt-reminder">Reminder</label>
            <b className="ctl">
              <select id="nt-reminder" className="inp" value={reminder ?? ""} onChange={(e) => setReminder(e.target.value === "" ? null : Number(e.target.value))}>
                {TASK_REMINDERS.map((r) => (
                  <option key={r.label} value={r.value ?? ""}>{r.label}</option>
                ))}
              </select>
            </b>
          </div>
          {projects.some((p) => !p.archived) && (
            <>
              <label htmlFor="nt-project">Project</label>
              <select
                id="nt-project"
                className="field"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setSectionId("");
                }}
              >
                <option value="">None</option>
                {projects.filter((p) => !p.archived).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {project && project.sections.length > 0 && (
                <>
                  <label htmlFor="nt-section">Section</label>
                  <select id="nt-section" className="field" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                    <option value="">No section</option>
                    {inOrder(project.sections).map((sec) => (
                      <option key={sec.id} value={sec.id}>{sec.name}</option>
                    ))}
                  </select>
                </>
              )}
            </>
          )}
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
