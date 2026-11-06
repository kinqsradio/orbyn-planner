import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { formatDue, isDueToday, isOverdue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import type { Task } from "../../store/types";

export function Swatch({ colour }: { colour: string }) {
  return <span className="swatch" data-colour={colour} aria-hidden="true" />;
}

export function TaskRow({ task, showList = true }: { task: Task; showList?: boolean }) {
  const store = useStore();
  const { lists } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const list = lists.find((l) => l.id === task.listId);
  const act = !task.done && task.due !== null && (isOverdue(task.due, now) || isDueToday(task.due, now));
  const checked = task.checklist.filter((c) => c.done).length;

  return (
    <li className="task-row" data-done={task.done}>
      <input
        type="checkbox"
        className="check"
        checked={task.done}
        aria-label={`Complete ${task.title}`}
        onChange={(event) => store.setDone(task.id, event.target.checked)}
      />
      <button type="button" className="task-title" onClick={() => ui.openTask(task.id)}>
        {task.title}
      </button>
      <span className="task-meta">
        {task.checklist.length > 0 && (
          <span className="meta-text">
            {checked}/{task.checklist.length}
          </span>
        )}
        {task.priority !== "none" && <span className="chip">{task.priority}</span>}
        {task.due && <span className={act ? "meta-text due-act" : "meta-text"}>{formatDue(task.due, now)}</span>}
        {showList && list && (
          <span className="meta-text list-tag">
            <Swatch colour={list.colour} />
            {list.name}
          </span>
        )}
      </span>
    </li>
  );
}
