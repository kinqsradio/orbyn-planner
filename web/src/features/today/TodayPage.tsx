import { Plus } from "lucide-react";
import { EmptyState, PageHeader } from "../../components/EmptyState";
import { SyncLine, useSyncStatus } from "../sync/SyncLine";

export function TodayPage() {
  const { status, retry } = useSyncStatus();
  return (
    <>
      <PageHeader title="Today">
        <SyncLine status={status} onRetry={retry} />
      </PageHeader>
      <EmptyState title="Nothing planned yet" body="Add a task to plan your day.">
        <button type="button" className="btn btn-primary" disabled title="Adding tasks arrives in the next phase">
          <Plus size={16} aria-hidden="true" />
          New task
        </button>
      </EmptyState>
    </>
  );
}
