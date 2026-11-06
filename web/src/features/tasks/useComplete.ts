import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { formatDue } from "../../lib/dates";
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
    const before = { due: task.due, completions: task.completions ?? [] };
    store.setDone(task.id, true);
    const after = store.getState().tasks.find((t) => t.id === task.id);
    if (!after) return;
    ui.showToast(
      after.done ? "Done. That was the last one." : `Done. Next: ${formatDue(after.due!, now)}`,
      () => {
        if (after.done) store.setDone(task.id, false);
        store.updateTask(task.id, { due: before.due, completions: before.completions });
      },
    );
  };
}
