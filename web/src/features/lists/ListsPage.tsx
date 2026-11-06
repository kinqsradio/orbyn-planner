import { EmptyState, PageHeader } from "../../components/EmptyState";

export function ListsPage() {
  return (
    <>
      <PageHeader title="Lists" />
      <EmptyState title="No lists yet" body="Lists keep related tasks together, like groceries or a trip." />
    </>
  );
}
