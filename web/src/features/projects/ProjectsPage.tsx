import { EmptyState, PageHeader } from "../../components/EmptyState";

export function ProjectsPage() {
  return (
    <>
      <PageHeader title="Projects" />
      <EmptyState title="No projects yet" body="Projects you create will appear here." />
    </>
  );
}
