/** Reminder choices for a task: minutes before the due time, 0 being at the due time. */
export const TASK_REMINDERS: readonly { value: number | null; label: string }[] = [
  { value: null, label: "None" },
  { value: 0, label: "At the due time" },
  { value: 5, label: "5 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

export function taskReminderLabel(minutes: number | null): string {
  return TASK_REMINDERS.find((r) => r.value === minutes)?.label ?? `${minutes} minutes before`;
}
