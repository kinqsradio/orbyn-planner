import { useEffect, useState } from "react";
import { setSettingsTarget } from "../../app/settingsTarget";
import { useRouter } from "../../app/router";
import { readProtection } from "../../auth/flows";
import { useAuth } from "../../auth/AuthProvider";
import { pendingChange, recordReport } from "../../auth/protectionNotice";
import { EmptyState, PageHeader } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatTime } from "../../lib/dates";
import { levelName } from "../auth/ProtectionSettings";

/** Notifications: so far one kind, a protection change another device made that this browser verified. */
export function NotificationsPage() {
  const auth = useAuth();
  const { navigate } = useRouter();
  const [change, setChange] = useState<ReturnType<typeof pendingChange>>(null);
  const session = auth?.session ?? null;
  const services = auth?.services;
  const trusted = session?.deviceState === "trusted";
  useEffect(() => {
    if (!trusted || !services || !session) return;
    let live = true;
    readProtection(services, session).then(
      (report) => {
        recordReport(session.accountId, report);
        if (live) setChange(pendingChange(session.accountId, report));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [trusted, services, session]);

  if (!change) {
    return (
      <>
        <PageHeader title="Notifications" />
        <EmptyState title="No notifications" body="Reminders and shared changes will appear here." />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Notifications" sub="1 new" />
      <ul className="pad">
        <li className="row notif-row">
          <Icon name="shield" small />
          <button
            type="button"
            className="what link-btn"
            onClick={() => {
              // Until account.orbyn.dev exists, the protection card in Settings is where the change opens.
              setSettingsTarget("Privacy");
              navigate("/settings");
            }}
          >
            Protection was changed to {levelName(change.level)} on {change.name ?? "another device"}
            <br />
            <span className="t3">Opens Data protection in your account</span>
          </button>
          <span className="meta">{formatTime(new Date(change.at * 1000))}</span>
          <span className="unread-dot" aria-label="Unread" />
        </li>
      </ul>
    </>
  );
}
