import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { formatTime, parseDue } from "../../lib/dates";
import { usePlanner } from "../../store/context";
import { shownTags, TagChip, tagLabels } from "./TagChips";
import type { Task } from "../../store/types";
import { dueText, needsAction } from "./selectors";
import { useComplete } from "./useComplete";

export function Swatch({ colour }: { colour: string }) {
  return <span className="sw" style={{ background: `var(--${colour})` }} aria-hidden="true" />;
}

export function useTaskActions(task: Task) {
  const ui = useUi();
  const complete = useComplete();
  return {
    toggle: (done: boolean) => complete(task, done),
    open: () => ui.openTask(task.id),
  };
}

function Check({ task }: { task: Task }) {
  const { toggle } = useTaskActions(task);
  return (
    <input
      type="checkbox"
      className="check"
      checked={task.done}
      aria-label={`Complete ${task.title}`}
      onChange={(event) => toggle(event.target.checked)}
    />
  );
}

const TASKS_COLS = "var(--sp-22) minmax(0,1fr) var(--sp-120) var(--sp-110) var(--sp-70)";
const LIST_COLS = "var(--sp-22) minmax(0,1fr) var(--sp-110)";
const priorityLabel = (t: Task) => (t.priority === "none" ? "" : t.priority[0]!.toUpperCase() + t.priority.slice(1));

/** One aligned table row: Tasks (list, due, priority), a list's own tasks, or Completed. */
export function TaskRow({ task, layout = "tasks", extra }: { task: Task; layout?: "tasks" | "list" | "completed"; extra?: string }) {
  const { lists, tags } = usePlanner();
  const { open } = useTaskActions(task);
  const now = useNow();
  const chips = shownTags(task, tags);
  const labels = tagLabels(tags);
  const list = lists.find((l) => l.id === task.listId);
  const due = (
    <span className={needsAction(task, now) ? "due amber" : "due"}>{task.done && layout === "list" ? "Done" : dueText(task, now)}</span>
  );
  const tag = list && (
    <span className="tag">
      <Swatch colour={list.colour} />
      {list.name}
    </span>
  );
  const columns = layout === "tasks" ? TASKS_COLS : layout === "list" ? LIST_COLS : "var(--sp-22) minmax(0,1fr) var(--sp-140) var(--sp-120)";

  return (
    <li className={`tr ${layout}${task.done ? " done" : ""}`} data-row-id={task.id} style={{ gridTemplateColumns: columns }} data-done={task.done}>
      <span><Check task={task} /></span>
      <span className="ttwrap">
        <button type="button" className="tt link-btn" onClick={open}>{task.title}</button>
        {chips.map((t) => <TagChip key={t.id} tag={t} label={labels.get(t.id)} />)}
      </span>
      {layout === "tasks" && (
        <>
          <span>{tag}</span>
          <span>{due}</span>
          <span>{priorityLabel(task)}</span>
        </>
      )}
      {layout === "list" && <span>{due}</span>}
      {layout === "completed" && (
        <>
          <span>{tag}</span>
          <span>{extra}</span>
        </>
      )}
    </li>
  );
}

/** A Today row: time, check, title, and what matters about it. */
export function TodayRow({ task, late, compact = false, quietLate = false, unsynced = false, at }: { task: Task; late?: number; compact?: boolean; /** The change to it has not left this device yet. */ unsynced?: boolean; /** On a phone an overdue row has no meta. */ quietLate?: boolean; /** Where the row stands in a list drawn in steps, for a screen reader. */ at?: { index: number; of: number } }) {
  const { lists } = usePlanner();
  const { open } = useTaskActions(task);
  const now = useNow();
  const list = lists.find((l) => l.id === task.listId);
  const parsed = task.due ? parseDue(task.due) : null;
  let time = "Any";
  if (late !== undefined && parsed) time = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parsed.date.getDay()]!;
  else if (parsed?.hasTime) time = formatTime(parsed.date);
  // The time turns amber when the task is overdue or due within the hour.
  const soon = !task.done && parsed !== null && (late !== undefined || (parsed.hasTime && parsed.date.getTime() - now.getTime() <= 3_600_000));

  let meta: string;
  if (task.done) meta = "Done";
  else if (late !== undefined) meta = quietLate ? "" : `${late} ${late === 1 ? "day" : "days"} late`;
  else meta = list?.name ?? "";
  if (unsynced && !task.done) meta = meta ? `${meta} · not synced yet` : "not synced yet";

  return (
    <li className={task.done ? "row done" : "row"} data-row-id={task.id} data-done={task.done} {...(at ? { "aria-posinset": at.index + 1, "aria-setsize": at.of } : {})} style={compact ? { gridTemplateColumns: "var(--sp-16) minmax(0,1fr) auto" } : undefined}>
      {!compact && <span className={soon ? "time amber" : "time"}>{time}</span>}
      <Check task={task} />
      <button type="button" className="what link-btn" onClick={open}>{task.title}</button>
      <span className={late !== undefined && !task.done ? "meta amber" : "meta"}>{compact ? (parsed?.hasTime ? formatTime(parsed.date) : "") : meta}</span>
    </li>
  );
}
