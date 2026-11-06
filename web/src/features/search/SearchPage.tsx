import { EmptyState, PageHeader } from "../../components/EmptyState";

export function SearchPage() {
  return (
    <>
      <PageHeader title="Search" />
      <EmptyState title="Search your planner" body="Find tasks, lists and projects by name." />
    </>
  );
}
