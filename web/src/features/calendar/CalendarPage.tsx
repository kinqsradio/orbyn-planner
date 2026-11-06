import { EmptyState, PageHeader } from "../../components/EmptyState";

export function CalendarPage() {
  return (
    <>
      <PageHeader title="Calendar" />
      <EmptyState title="Nothing on the calendar" body="Dated tasks and events will appear here." />
    </>
  );
}
