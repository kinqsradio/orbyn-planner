import { EmptyState, PageHeader } from "../../components/EmptyState";

export function NotificationsPage() {
  return (
    <>
      <PageHeader title="Notifications" />
      <EmptyState title="No notifications" body="Reminders and shared changes will appear here." />
    </>
  );
}
