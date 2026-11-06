import { EmptyState, PageHeader } from "../../components/EmptyState";

export function TasksPage() {
  return (
    <>
      <PageHeader title="Tasks" />
      <EmptyState title="No tasks yet" body="Tasks you add will appear here." />
    </>
  );
}
