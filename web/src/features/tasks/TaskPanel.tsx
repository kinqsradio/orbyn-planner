import { linksIn } from "../../app/links";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { Icon } from "../../components/Icon";
import { Portal } from "../../components/Portal";
import { PHONE_QUERY, useMediaQuery } from "../../components/useMediaQuery";
import { useDialog } from "../../components/useDialog";
import { dateKey, makeDue, parseDue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { inOrder, keyBetween } from "../../store/order";
import { CannotMoveSeries, type Scope } from "../../store/eventScope";
import type { Repeat } from "../../store/repeat";
import { allowedScopes, editTaskRepeat, undoableTasks, type RepeatEdit } from "../../store/taskRepeat";
import { MAX_TAGS_PER_TASK } from "../../store/records";
import { LIST_COLOURS, PRIORITIES, type Task } from "../../store/types";
import { ScopeDialog } from "../calendar/ScopeDialog";
import { RepeatPicker } from "./RepeatPicker";
import { shownTags, TagChip, tagLabels } from "./TagChips";
import { TASK_REMINDERS } from "./reminder";
import { needsAction } from "./selectors";
import { useComplete } from "./useComplete";

const SAVE_DELAY_MS = 500;

function Panel({ task }: { task: Task }) {
  const store = useStore();
  const { lists, projects, tags } = usePlanner();
  const [newTag, setNewTag] = useState("");
  const labels = tagLabels(tags);
  const ui = useUi();
  const now = useNow();
  const complete = useComplete();
  const ref = useRef<HTMLElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [step, setStep] = useState("");
  // A change to a repeating task waits here while the person says how far it reaches.
  const [asking, setAsking] = useState<RepeatEdit | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Title and notes are saved a moment after typing stops, and always when the panel is left.
  const latest = useRef({ title, notes, task });
  useEffect(() => {
    latest.current = { title, notes, task };
  });
  const flush = useCallback(() => {
    const { title: t, notes: n, task: current } = latest.current;
    const patch: { title?: string; notes?: string } = {};
    if (t.trim() !== "" && t.trim() !== current.title) patch.title = t.trim();
    if (n !== current.notes) patch.notes = n;
    if (patch.title !== undefined || patch.notes !== undefined) {
      store.updateTask(current.id, patch);
      latest.current = { ...latest.current, task: { ...current, ...patch } };
    }
  }, [store]);
  useEffect(() => {
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [title, notes, flush]);
  useEffect(() => flush, [flush]);

  const close = () => {
    flush();
    ui.closeTask();
  };
  useDialog(ref, close, phone);

  const dayValue = task.due ? task.due.slice(0, 10) : "";
  const timeValue = task.due && parseDue(task.due).hasTime ? task.due.slice(11, 16) : "";
  const steps = inOrder(task.checklist);
  const doneSteps = task.checklist.filter((c) => c.done).length;

  const today = dateKey(now);
  /** Apply an edit to due or repeat; a repeating task asks how far it reaches first. */
  const edit = (change: RepeatEdit) => {
    if (task.repeat && change.due !== null) setAsking(change);
    else editTaskRepeat(store, task, change, "all", today);
  };

  const setDue = (day: string, time: string) => {
    // No day means no due date, so a time left in the field goes with it. A repeating task keeps
    // its date: stop the repeat first to remove it.
    if (!day) return task.repeat ? undefined : edit({ due: null });
    const base = parseDue(day).date;
    const [h = 0, m = 0] = time ? time.split(":").map(Number) : [];
    base.setHours(h, m);
    edit({ due: makeDue(base, time !== "") });
  };

  const choose = (scope: Scope) => {
    if (asking) {
      try {
        const { undo } = undoableTasks(store, () => editTaskRepeat(store, task, asking, scope, today));
        setSaveError(null);
        ui.showToast("Repeat changed", undo);
      } catch (e) {
        setSaveError(e instanceof CannotMoveSeries ? e.message : "Couldn’t save that change.");
      }
    }
    setAsking(null);
    setPickerKey((k) => k + 1); // show what is really stored, whatever happened
  };
  const cancelAsk = () => {
    setAsking(null);
    setPickerKey((k) => k + 1); // show what is really stored again
  };
  const project = projects.find((p) => p.id === task.projectId);

  const commitTitle = () => {
    if (title.trim() === "") setTitle(task.title);
    else flush();
  };

  const addStep = () => {
    const text = step.trim();
    if (!text) return;
    // A new step goes last: a key after the current last one.
    const order = keyBetween(steps.at(-1)?.order ?? null, null);
    if (order === null) return;
    store.updateTask(task.id, { checklist: [...task.checklist, { id: crypto.randomUUID(), title: text, done: false, order }] });
    setStep("");
  };

  const remove = () => {
    flush();
    store.deleteTask(task.id);
    ui.closeTask();
    ui.showToast("Task deleted", () => store.restoreTask(task.id), { focusUndo: true, focusRowOnUndo: task.id });
  };

  const panel = (
    <aside
      ref={ref}
      className="task-panel"
      role={phone ? "dialog" : "complementary"}
      aria-modal={phone ? "true" : undefined}
      aria-label="Task"
      tabIndex={-1}
      onBlur={(e) => {
        // Leaving the panel saves what was typed.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) flush();
      }}
    >
      <div className="tp-head">
        <input
          type="checkbox"
          className="check"
          checked={task.done}
          aria-label={`Complete ${task.title}`}
          onChange={(e) => complete(task, e.target.checked)}
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
        <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
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
      <div className="kv">
        <span id="task-tags-label">Tags</span>
        <b className="ctl tagrow" role="group" aria-labelledby="task-tags-label">
          {shownTags(task, tags).map((t) => (
            <TagChip key={t.id} tag={t} label={labels.get(t.id)} onRemove={() => store.setTaskTag(task.id, t.id, false)} />
          ))}
          {task.tags.length >= MAX_TAGS_PER_TASK ? (
            <span className="t3 small" role="note">A task can have 100 tags at most.</span>
          ) : (
            <>
            {tags.some((t) => t.deletedAt === null && !task.tags.includes(t.id)) && (
              <select className="inp" aria-label="Add a tag" value="" onChange={(e) => e.target.value && store.setTaskTag(task.id, e.target.value, true)}>
                <option value="">Add a tag</option>
                {tags.filter((t) => t.deletedAt === null && !task.tags.includes(t.id)).map((t) => (
                  <option key={t.id} value={t.id}>{labels.get(t.id) ?? t.name}</option>
                ))}
              </select>
            )}
            <input
              className="inp"
              aria-label="New tag"
              placeholder="New tag"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const name = newTag.trim();
                if (!name) return;
                // An existing tag of that name is used, not made twice.
                const same = tags.find((t) => t.deletedAt === null && t.name.toLowerCase() === name.toLowerCase());
                const tag = same ?? store.addTag(name, LIST_COLOURS[tags.length % LIST_COLOURS.length]!);
                store.setTaskTag(task.id, tag.id, true);
                setNewTag("");
              }}
            />
            </>
          )}
        </b>
      </div>
      <div className="kv">
        <span>Repeat</span>
        <b className="ctl">
          <RepeatPicker
            key={`${pickerKey}-${task.repeat ? JSON.stringify(task.repeat.repeat) : ""}`}
            value={task.repeat?.repeat ?? null}
            start={dayValue || today}
            onChange={(rule: Repeat | null) => edit({ repeat: rule })}
          />
        </b>
      </div>
      <div className="kv">
        <span>Reminder</span>
        <b className="ctl">
          <select
            className="inp"
            aria-label="Reminder"
            value={task.reminder ?? ""}
            onChange={(e) => store.updateTask(task.id, { reminder: e.target.value === "" ? null : Number(e.target.value) })}
          >
            {TASK_REMINDERS.map((r) => (
              <option key={r.label} value={r.value ?? ""}>{r.label}</option>
            ))}
          </select>
        </b>
      </div>
      {task.reminder !== null && !task.due && <p className="t3 hint">Set a due date to get this reminder.</p>}
      {projects.length > 0 && (
        <>
          <div className="kv">
            <span>Project</span>
            <b className="ctl">
              <select
                className="inp"
                aria-label="Project"
                value={task.projectId ?? ""}
                onChange={(e) => store.updateTask(task.id, { projectId: e.target.value || null, sectionId: null })}
              >
                <option value="">None</option>
                {projects.filter((p) => !p.archived || p.id === task.projectId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </b>
          </div>
          {project && project.sections.length > 0 && (
            <div className="kv">
              <span>Section</span>
              <b className="ctl">
                <select
                  className="inp"
                  aria-label="Section"
                  value={task.sectionId ?? ""}
                  onChange={(e) => store.updateTask(task.id, { sectionId: e.target.value || null })}
                >
                  <option value="">No section</option>
                  {inOrder(project.sections).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </b>
            </div>
          )}
        </>
      )}

      <div className="bh">
        <b>Checklist</b>
        <span>{task.checklist.length > 0 ? `${doneSteps} of ${task.checklist.length}` : ""}</span>
      </div>
      <ul>
        {steps.map((item) => (
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
      {linksIn(notes).length > 0 && (
        <ul className="note-links" aria-label="Links in the notes">
          {linksIn(notes).map((u) => (
            <li key={u}>
              <a href={u} target="_blank" rel="noopener noreferrer" className="t3">{u}</a>
            </li>
          ))}
        </ul>
      )}

      <div className="tp-foot">
        <button type="button" className="ghost danger" onClick={remove}>Delete</button>
        <button type="button" className="btn" onClick={() => complete(task, !task.done)}>
          {task.done ? "Mark not done" : "Complete"}
        </button>
      </div>
      {saveError && <p role="alert" className="t3">{saveError}</p>}
      {asking && <ScopeDialog title="Change" noun="task" allowed={allowedScopes(asking)} onChoose={choose} onCancel={cancelAsk} />}
    </aside>
  );
  return phone ? <Portal>{panel}</Portal> : panel;
}

export function TaskPanel() {
  const { tasks } = usePlanner();
  const { taskId } = useUi();
  const task = tasks.find((t) => t.id === taskId && t.deletedAt === null);
  return task ? <Panel key={task.id} task={task} /> : null;
}
