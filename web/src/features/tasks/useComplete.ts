import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { dateKey, formatDue } from "../../lib/dates";
import { nextUpcoming } from "../../store/taskRepeat";
import { useStore } from "../../store/context";
import type { Task } from "../../store/types";

/**
 * Completes or reopens a task. Completing a repeating task moves it to its next date, so it says so
 * with an Undo; the last one of a series just finishes it.
 */
export function useComplete() {
  const store = useStore();
  const ui = useUi();
  const now = useNow();
  return (task: Task, done: boolean) => {
    if (!done || !task.repeat) return store.setDone(task.id, done);
    const before = { due: task.due, completions: task.completions ?? [], checklist: task.checklist };
    store.setDone(task.id, true);
    const after = store.getState().tasks.find((t) => t.id === task.id);
    if (!after) return;
    // Finishing a long-overdue one lands on another past date; offer to jump to the next that is still ahead.
    const today = dateKey(now);
    const ahead = !after.done && after.due && after.due.slice(0, 10) < today ? nextUpcoming(after, today) : null;
    const undo = () => {
      if (after.done) store.setDone(task.id, false);
      store.updateTask(task.id, { due: before.due, completions: before.completions, checklist: before.checklist });
    };
    ui.showToast(
      after.done ? "Done. That was the last one." : `Done. Next: ${formatDue(after.due!, now)}`,
      undo,
      { focusRowOnUndo: task.id, secondary: ahead ? { label: "Skip to next upcoming", run: () => store.updateTask(task.id, { due: ahead }) } : undefined },
    );
  };
}
