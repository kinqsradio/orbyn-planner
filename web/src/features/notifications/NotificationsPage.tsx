import { setSettingsTarget } from "../../app/settingsTarget";
import { useRouter } from "../../app/router";
import { useUi } from "../../app/ui";
import { PageHeader } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatTime } from "../../lib/dates";
import { levelName } from "../auth/ProtectionSettings";
import { protectionId, useNotifications } from "./useNotifications";

/**
 * Notifications: one list. Unread is a small dot; a reminder that is due is the only amber. So far two kinds: reminders that came due,
 * and a protection change another device made.
 */
export function NotificationsPage() {
  const { reminders, protection, unread, isRead, markRead, markAllRead } = useNotifications();
  const ui = useUi();
  const { navigate } = useRouter();

  if (reminders.length === 0 && !protection) {
    return (
      <>
        <PageHeader title="Notifications" sub="All caught up" />
        <div className="empty">
          <h4>You’re all caught up</h4>
          <p>Reminders and changes to shared lists appear here.</p>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setSettingsTarget("Notifications");
              navigate("/settings");
            }}
          >
            Notification settings
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Notifications" sub={unread > 0 ? `${unread} unread` : "All caught up"}>
        {unread > 0 && <button type="button" className="ghost" onClick={markAllRead}>Mark all as read</button>}
      </PageHeader>
      <div className="pad">
        {reminders.length > 0 && (
          <>
            <div className="bh"><b>Reminders</b><span>{reminders.length}</span></div>
            <ul>
              {reminders.map((r) => (
                <li className="row notif-row" key={r.id}>
                  <span className={isRead(r.id) ? "dot none" : "dot amber"} aria-label={isRead(r.id) ? undefined : "Unread"} />
                  <span className="what">“{r.title}” is due at {formatTime(r.dueAt)}</span>
                  <button
                    type="button"
                    className="ghost sm"
                    onClick={() => {
                      markRead(r.id);
                      ui.openTask(r.taskId);
                    }}
                  >
                    Open task
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {protection && (
          <>
            <div className="bh"><b>Earlier</b><span></span></div>
            <ul>
              <li className="row notif-row">
                <Icon name="shield" small />
                <button
                  type="button"
                  className="what link-btn"
                  onClick={() => {
                    markRead(protectionId(protection.seq));
                    // Until account.orbyn.dev exists, the protection card in Settings is where the change opens.
                    setSettingsTarget("Privacy");
                    navigate("/settings");
                  }}
                >
                  Protection was changed to {levelName(protection.level)} on {protection.name ?? "another device"}
                  <br />
                  <span className="t3">Opens Data protection in your account</span>
                </button>
                <span className="meta">{formatTime(new Date(protection.at * 1000))}</span>
                {!isRead(protectionId(protection.seq)) && <span className="unread-dot" aria-label="Unread" />}
              </li>
            </ul>
          </>
        )}
      </div>
    </>
  );
}
