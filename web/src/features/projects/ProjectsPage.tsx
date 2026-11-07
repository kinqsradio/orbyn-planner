import { useMemo, useState } from "react";
import { useNow } from "../../app/clock";
import { useRouter } from "../../app/router";
import { EmptyState, PageHeader } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatDue, isDueToday, isOverdue } from "../../lib/dates";
import { usePlanner } from "../../store/context";
import { Swatch } from "../tasks/TaskRow";
import { ProjectDialog } from "./ProjectDialog";
import { projectStats } from "./stats";

const COLS = "minmax(0,1.4fr) minmax(0,1.2fr) var(--sp-110) var(--sp-120)";

export function ProjectsPage() {
  const { projects, tasks } = usePlanner();
  const { navigate } = useRouter();
  const now = useNow();
  const [show, setShow] = useState<"active" | "done">("active");
  const [find, setFind] = useState("");
  const [creating, setCreating] = useState(false);

  const active = projects.filter((p) => !p.archived).length;
  const shown = useMemo(
    () => projects.filter((p) => p.archived === (show === "done") && p.name.toLowerCase().includes(find.trim().toLowerCase())),
    [projects, show, find],
  );

  return (
    <>
      <PageHeader title="Projects" sub={`${active} active`}>
        <button type="button" className="btn" onClick={() => setCreating(true)}>
          <Icon name="plus" small />
          New project
        </button>
      </PageHeader>

      <div className="filters">
        <label className="pill find-pill">
          <Icon name="search" small />
          <input aria-label="Find a project" placeholder="Find a project" value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        <div role="radiogroup" aria-label="Show" className="pills">
          {(["active", "done"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={show === v} className="pill" onClick={() => setShow(v)}>
              {v === "active" ? "Active" : "Done"}
            </button>
          ))}
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState title="No projects yet" body="A project groups tasks toward something you want done by a date.">
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Icon name="plus" small />
            New project
          </button>
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="quiet note" style={{ padding: "0 var(--sp-28)" }}>{show === "done" ? "No finished projects." : "No projects match."}</p>
      ) : (
        <div className="tbl-wrap">
          <ul className="tbl">
            <li className="tr h" aria-hidden="true" style={{ gridTemplateColumns: COLS }}>
              <span>Project</span><span>Next</span><span>Due</span><span>Done</span>
            </li>
            {shown.map((p) => {
              const stats = projectStats(tasks, p.id);
              const act = !p.archived && p.goal !== null && (isOverdue(p.goal, now) || isDueToday(p.goal, now));
              return (
                <li key={p.id} className="tr" style={{ gridTemplateColumns: COLS }} data-row-id={p.id}>
                  <span>
                    <button type="button" className="tag link-btn" style={{ color: "var(--t1)" }} onClick={() => navigate(`/projects/${p.id}`)}>
                      <Swatch colour={p.colour} />
                      {p.name}
                    </button>
                  </span>
                  <span className="clip">{stats.next?.title ?? <span className="t3">Nothing open</span>}</span>
                  <span style={act ? { color: "var(--amber-text)", fontWeight: "var(--fw-medium)" } : undefined}>{p.goal ? formatDue(p.goal, now) : <span className="t3">No date</span>}</span>
                  <span>
                    <div className="meter" role="progressbar" aria-label={`${p.name}: ${stats.done} of ${stats.total} tasks`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats.percent}>
                      <i style={{ width: `${stats.percent}%` }} />
                    </div>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {creating && <ProjectDialog onClose={() => setCreating(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />}
    </>
  );
}
