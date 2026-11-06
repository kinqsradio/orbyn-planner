import { useMemo } from "react";
import { PageHeader } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { MONTHS, WEEKDAYS } from "../../lib/dates";
import { SyncLine, useSyncStatus } from "../sync/SyncLine";

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function TodayPage() {
  const { status, retry } = useSyncStatus();
  const now = useMemo(() => new Date(), []);
  const days = [1, 2, 3, 4, 5].map((n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));

  return (
    <>
      <PageHeader title={greeting(now)} sub={`${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]} · nothing planned`}>
        <SyncLine status={status} onRetry={retry} />
        <button type="button" className="btn" disabled title="Adding tasks arrives in the next phase">
          <Icon name="plus" small />
          New task
        </button>
      </PageHeader>

      <div className="grid4 today-stats" style={{ padding: "4px 28px 0" }}>
        {["Today", "Overdue", "This week", "Done this week"].map((label) => (
          <div className="stat" key={label}>
            <small>{label}</small>
            <b>0</b>
          </div>
        ))}
      </div>

      <div className="cols">
        <div className="blk">
          <div className="bh">
            <b>Today</b>
            <span>
              {WEEKDAYS[now.getDay()]!.slice(0, 3)} {now.getDate()} {MONTHS[now.getMonth()]!.slice(0, 3)}
            </span>
          </div>
          <div className="empty">
            <h2>Nothing planned yet</h2>
            <p>Add a task to plan your day.</p>
          </div>
        </div>
        <div className="blk aside">
          <div className="bh"><b>This week</b><span></span></div>
          {days.map((d) => (
            <div className="kv" key={d.toISOString()}>
              <span>{WEEKDAYS[d.getDay()]!.slice(0, 3)} {d.getDate()}</span>
              <b className="t3">Nothing planned</b>
            </div>
          ))}
          <div className="bh" style={{ paddingTop: 16 }}><b>Progress</b></div>
          <div className="kv"><span>Tasks done this week</span><b>0 of 0</b></div>
          <div className="meter"><i style={{ width: "0%" }} /></div>
        </div>
      </div>
    </>
  );
}
