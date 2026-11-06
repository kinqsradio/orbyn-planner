import { useEffect, useMemo, useRef, useState } from "react";
import { useNow } from "../../app/clock";
import { usePrefs } from "../../app/prefs";
import { Link } from "../../app/router";
import { useUi } from "../../app/ui";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { MONTHS, WEEKDAYS, addDays, dateKey, dateOf, formatDue, weekStartOf } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import type { Project, Task } from "../../store/types";
import { dueText, needsAction } from "../tasks/selectors";
import { Swatch, useTaskActions } from "../tasks/TaskRow";
import { ProjectDialog } from "./ProjectDialog";
import { groupBySection, projectStats, tasksOf, type Lane } from "./stats";

type Tab = "tasks" | "board" | "calendar";

/** A task in a project: check, title, and when it is due. */
function ProjectRow({ task }: { task: Task }) {
  const { toggle, open } = useTaskActions(task);
  const now = useNow();
  const act = needsAction(task, now);
  return (
    <li className={task.done ? "row done" : "row"} data-row-id={task.id} data-done={task.done} style={{ gridTemplateColumns: "16px minmax(0,1fr) auto" }}>
      <input type="checkbox" className="check" checked={task.done} aria-label={`Complete ${task.title}`} onChange={(e) => toggle(e.target.checked)} />
      <button type="button" className="what link-btn" onClick={open}>{task.title}</button>
      <span className="meta" style={act ? { color: "var(--amber)", fontWeight: 500 } : undefined}>{task.done ? "Done" : dueText(task, now)}</span>
    </li>
  );
}

function SectionHeader({ project, lane, index, count }: { project: Project; lane: Lane; index: number; count: number }) {
  const store = useStore();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(lane.name);
  const done = lane.tasks.filter((t) => t.done).length;
  const section = lane.sectionId;

  const save = () => {
    if (section && name.trim()) store.renameSection(project.id, section, name);
    setRenaming(false);
  };

  return (
    <div className="bh">
      {renaming && section ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input className="inp" aria-label="Section name" value={name} autoFocus onChange={(e) => setName(e.target.value)} onBlur={save} />
        </form>
      ) : (
        <b>{lane.name}</b>
      )}
      <span className="group-tools">
        {section && (
          <>
            <button type="button" className="icon-btn" aria-label={`Move ${lane.name} up`} disabled={index === 0} onClick={() => store.moveSection(project.id, section, "up")}>
              <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Icon name="down" small /></span>
            </button>
            <button type="button" className="icon-btn" aria-label={`Move ${lane.name} down`} disabled={index >= count - 1} onClick={() => store.moveSection(project.id, section, "down")}>
              <Icon name="down" small />
            </button>
            <button type="button" className="icon-btn" aria-label={`Rename ${lane.name}`} onClick={() => { setName(lane.name); setRenaming(true); }}>
              <Icon name="edit" small />
            </button>
            <button type="button" className="icon-btn" aria-label={`Delete ${lane.name}`} onClick={() => store.deleteSection(project.id, section)}>
              <Icon name="x" small />
            </button>
          </>
        )}
        <span style={{ marginLeft: 8 }}>{done} of {lane.tasks.length}</span>
      </span>
    </div>
  );
}

function TasksTab({ project }: { project: Project }) {
  const store = useStore();
  const { tasks } = usePlanner();
  const [newSection, setNewSection] = useState("");
  const lanes = groupBySection(project, tasks);
  const stats = projectStats(tasks, project.id);
  const realSections = lanes.filter((l) => l.sectionId !== null);

  return (
    <div className="cols">
      <div className="blk">
        {lanes.map((lane, i) => (
          <section key={lane.sectionId ?? "none"} aria-label={lane.name}>
            <div style={i > 0 ? { paddingTop: 16 } : undefined}>
              <SectionHeader project={project} lane={lane} index={realSections.indexOf(lane)} count={realSections.length} />
            </div>
            {lane.tasks.length === 0 ? (
              <p className="quiet note" style={{ padding: "6px 0" }}>No tasks in this section.</p>
            ) : (
              <ul>
                {lane.tasks.map((t) => (
                  <ProjectRow key={t.id} task={t} />
                ))}
              </ul>
            )}
          </section>
        ))}
        <form
          className="inline-form"
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!newSection.trim()) return;
            store.addSection(project.id, newSection);
            setNewSection("");
          }}
        >
          <input className="field" aria-label="New section name" placeholder="Add a section" value={newSection} onChange={(e) => setNewSection(e.target.value)} />
          <button type="submit" className="ghost" disabled={!newSection.trim()}>Add section</button>
        </form>
      </div>
      <div className="blk aside">
        <div className="bh"><b>Progress</b><span></span></div>
        <div className="meter" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats.percent}><i style={{ width: `${stats.percent}%` }} /></div>
        <div className="kv" style={{ marginTop: 6 }}><span>Done</span><b>{stats.done} of {stats.total} tasks</b></div>
        <div className="kv"><span>Next</span><b>{stats.next?.title ?? "Nothing open"}</b></div>
      </div>
    </div>
  );
}

function MoveMenu({ task, project }: { task: Task; project: Project }) {
  const store = useStore();
  const complete = useTaskActions(task).toggle;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const targets = [
    ...[...project.sections].sort((a, b) => (a.order < b.order ? -1 : 1)).map((s) => ({ key: s.id, label: s.name, sectionId: s.id as string | null, done: false })),
    { key: "none", label: "No section", sectionId: null, done: false },
    { key: "done", label: "Done", sectionId: task.sectionId, done: true },
  ];
  const move = (t: (typeof targets)[number]) => {
    setOpen(false);
    if (t.done) {
      if (!task.done) complete(true);
      return;
    }
    if (task.done) store.setDone(task.id, false);
    store.updateTask(task.id, { sectionId: t.sectionId });
  };

  return (
    <div className="menu-wrap" ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button type="button" className="move-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Move ${task.title} to`} onClick={() => setOpen(!open)}>
        Move to
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={`Move ${task.title} to`}>
          {targets.map((t) => (
            <button key={t.key} type="button" role="menuitem" autoFocus={t === targets[0]} onClick={() => move(t)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BoardTab({ project }: { project: Project }) {
  const { tasks } = usePlanner();
  const { openTask: open } = useUi();
  const now = useNow();
  const lanes = groupBySection(project, tasks).map((l) => ({ ...l, tasks: l.tasks.filter((t) => !t.done) }));
  const visible = lanes.filter((l) => l.sectionId !== null || l.tasks.length > 0 || lanes.length === 1);
  const finished = tasksOf(tasks, project.id).filter((t) => t.done);
  const all: { key: string; name: string; tasks: Task[]; done?: boolean }[] = [
    ...visible.map((l) => ({ key: l.sectionId ?? "none", name: l.name === "Tasks" ? "To do" : l.name, tasks: l.tasks })),
    { key: "done", name: "Done", tasks: finished, done: true },
  ];
  return (
    <div className="board scroll" style={{ gridTemplateColumns: `repeat(${all.length}, minmax(200px, 1fr))` }}>
      {all.map((lane) => (
        <section key={lane.key} className="lane" aria-label={lane.name}>
          <h2 className="lane-h">{lane.name}<span>{lane.tasks.length}</span></h2>
          <ul className="cards">
            {lane.tasks.map((t) => (
              <li className="tcard" key={t.id} data-row-id={t.id} data-done={t.done}>
                <button type="button" className="tt link-btn" onClick={() => open(t.id)}>{t.title}</button>
                <span className="m" style={needsAction(t, now) ? { color: "var(--amber)" } : undefined}>{t.done ? "Done" : t.due ? formatDue(t.due, now) : ""}</span>
                <MoveMenu task={t} project={project} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** That project's tasks on the month grid. */
function CalendarTab({ project }: { project: Project }) {
  const { tasks } = usePlanner();
  const { prefs } = usePrefs();
  const { openTask: open } = useUi();
  const now = useNow();
  const [anchor, setAnchor] = useState(() => dateKey(new Date(now.getFullYear(), now.getMonth(), 1)));
  const first = dateOf(anchor);
  const gridStart = weekStartOf(first, prefs.weekStart);
  const days = Array.from({ length: 42 }, (_, i) => dateKey(addDays(gridStart, i)));
  const shownDays = days.slice(0, 35).concat(dateOf(days[35]!).getMonth() === first.getMonth() ? days.slice(35) : []);
  const mine = tasksOf(tasks, project.id);
  const undated = mine.filter((t) => t.due === null && !t.done).length;
  const order = prefs.weekStart === "mon" ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const today = dateKey(now);
  const step = (n: number) => setAnchor(dateKey(new Date(first.getFullYear(), first.getMonth() + n, 1)));

  return (
    <>
      <div className="filters">
        <button type="button" className="ghost icon" aria-label="Previous month" onClick={() => step(-1)}><Icon name="left" small /></button>
        <b aria-live="polite">{MONTHS[first.getMonth()]} {first.getFullYear()}</b>
        <button type="button" className="ghost icon" aria-label="Next month" onClick={() => step(1)}><Icon name="right" small /></button>
        {undated > 0 && <span className="t3" style={{ marginLeft: "auto" }}>{undated} {undated === 1 ? "task has" : "tasks have"} no date</span>}
      </div>
      <div className="month" role="grid" aria-label="Project calendar">
        {order.map((d) => (
          <div className="mh" role="columnheader" key={d}>{WEEKDAYS[d]!.slice(0, 3)}</div>
        ))}
        {shownDays.map((day) => {
          const date = dateOf(day);
          const here = mine.filter((t) => t.due !== null && t.due.slice(0, 10) === day);
          const cls = ["md", day === today ? "today" : "", date.getMonth() === first.getMonth() ? "" : "out"].filter(Boolean).join(" ");
          return (
            <div className={cls} role="gridcell" key={day} data-day={day}>
              <span className="n">{date.getDate()}</span>
              {here.map((t) => (
                <button key={t.id} type="button" className="chipx" data-row-id={t.id} style={t.done ? { textDecoration: "line-through", color: "var(--t4)" } : undefined} onClick={() => open(t.id)}>
                  <Swatch colour={project.colour} />
                  {t.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function ProjectPage({ id }: { id: string }) {
  const store = useStore();
  const { projects, tasks, ready } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("tasks");
  const [editing, setEditing] = useState(false);
  const project = projects.find((p) => p.id === id);
  const stats = useMemo(() => projectStats(tasks, id), [tasks, id]);

  if (!project) {
    return ready ? (
      <EmptyState title="Project not found" body="It may have been removed on another device.">
        <Link to="/projects" className="btn">All projects</Link>
      </EmptyState>
    ) : null;
  }

  const sub = [project.goal && `Due ${formatDue(project.goal, now)}`, `${stats.percent}%`, project.archived && "Done"].filter(Boolean).join(" · ");

  return (
    <>
      <div className="ph">
        <h1>
          <Swatch colour={project.colour} /> {project.name}
        </h1>
        <span className="sub">{sub}</span>
        <div className="acts">
          <Link to="/projects" className="ghost">All projects</Link>
          <button type="button" className="ghost" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="ghost" onClick={() => store.updateProject(project.id, { archived: !project.archived })}>
            {project.archived ? "Reopen" : "Mark done"}
          </button>
          <button type="button" className="btn keep" onClick={() => ui.openNewTask({ projectId: project.id })}>
            <Icon name="plus" small />
            Add task
          </button>
        </div>
      </div>
      <div role="tablist" aria-label="Project views" className="tabs2">
        {(["tasks", "board", "calendar"] as const).map((t) => (
          <button key={t} type="button" role="tab" id={`ptab-${t}`} aria-selected={tab === t} aria-controls="ptab-panel" className={tab === t ? "tab2 on" : "tab2"} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="ptab-panel" aria-labelledby={`ptab-${tab}`} className="project-panel">
        {tab === "tasks" ? <TasksTab project={project} /> : tab === "board" ? <BoardTab project={project} /> : <CalendarTab project={project} />}
      </div>
      {editing && <ProjectDialog project={project} onClose={() => setEditing(false)} />}
    </>
  );
}
