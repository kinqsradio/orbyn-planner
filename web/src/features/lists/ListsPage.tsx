import { EmptyState, PageHeader } from "../../components/EmptyState";

export function ListsPage() {
  return (
    <>
      <PageHeader title="Lists" />
      <EmptyState title="No lists yet" body="Lists you create will appear here." />
    </>
  );
}
