import { useMemo, useState } from "react";
import { useNow } from "../../app/clock";
import { Link } from "../../app/router";
import { useUi } from "../../app/ui";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePlanner, useStore } from "../../store/context";
import { StrandedZones } from "../sync/StrandedZones";
import { LIST_COLOURS, type ListColour, type TaskList } from "../../store/types";
import { activeTasks, openCount, sortByDue } from "../tasks/selectors";
import { Swatch, TaskRow } from "../tasks/TaskRow";

const COLOUR_NAMES: Record<ListColour, string> = { c1: "Blue", c2: "Green", c3: "Purple", c4: "Orange" };

function ListTitle({ list }: { list: TaskList }) {
  const store = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);

  const save = () => {
    const next = name.trim();
    if (next && next !== list.name) store.updateList(list.id, { name: next });
    setEditing(false);
  };

  return editing ? (
    <form
      className="rename"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input className="field" aria-label="List name" value={name} autoFocus onChange={(e) => setName(e.target.value)} onBlur={save} />
    </form>
  ) : (
    <>
      <h1>
        <Swatch colour={list.colour} /> {list.name}
      </h1>
      {!list.isInbox && (
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setName(list.name);
            setEditing(true);
          }}
        >
          Rename
        </button>
      )}
    </>
  );
}

export function ListsPage() {
  const store = useStore();
  const { lists, tasks, ready } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [find, setFind] = useState("");

  const ordered = useMemo(() => [...lists].sort((a, b) => Number(b.isInbox) - Number(a.isInbox)), [lists]);
  const selected = ordered.find((l) => l.id === ui.listId) ?? ordered[0];
  const shown = useMemo(
    () => (selected ? sortByDue(activeTasks(tasks, now).filter((t) => t.listId === selected.id)) : []),
    [tasks, now, selected],
  );
  const inbox = ordered.find((l) => l.isInbox);
  const mine = ordered.filter((l) => !l.isInbox && l.name.toLowerCase().includes(find.trim().toLowerCase()));

  const create = () => {
    const name = newName.trim();
    if (name) {
      const list = store.addList(name, LIST_COLOURS[lists.length % LIST_COLOURS.length]!);
      ui.selectList(list.id);
    }
    setNewName("");
    setAdding(false);
  };

  const count = (id: string) => (
    <span className="n" aria-label={`${openCount(tasks, id)} open`}>{openCount(tasks, id)}</span>
  );

  return (
    <div className="split">
      <nav className="l" aria-label="Your lists">
        <label className="search">
          <Icon name="search" small />
          <input placeholder="Find a list" aria-label="Find a list" value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        {inbox && (
          <button type="button" className={selected?.id === inbox.id ? "nav on" : "nav"} aria-current={selected?.id === inbox.id ? "true" : undefined} onClick={() => ui.selectList(inbox.id)}>
            <Icon name="inbox" small />
            Inbox
            {count(inbox.id)}
          </button>
        )}
        <div className="grp">My lists</div>
        {mine.map((l) => (
          <button key={l.id} type="button" className={selected?.id === l.id ? "nav on" : "nav"} aria-current={selected?.id === l.id ? "true" : undefined} onClick={() => ui.selectList(l.id)}>
            <Swatch colour={l.colour} />
            {l.name}
            {count(l.id)}
          </button>
        ))}
        {adding ? (
          <form
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input className="field" aria-label="New list name" placeholder="List name" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onBlur={create} />
          </form>
        ) : (
          <button type="button" className="nav" style={{ marginTop: 8 }} disabled={!ready} onClick={() => setAdding(true)}>
            <Icon name="plus" small />
            New list
          </button>
        )}
        <StrandedZones only="list" />
      </nav>

      <div className="r" aria-label={selected?.name ?? "List"} role="region">
        {selected && (
          <div className="ph" key={selected.id}>
            <ListTitle list={selected} />
            <span className="sub">{openCount(tasks, selected.id)} open</span>
            <div className="acts">
              <Link to="/completed" className="ghost">Completed and deleted</Link>
              <div role="radiogroup" aria-label="Colour" className="colours">
                {LIST_COLOURS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={selected.colour === c} aria-label={COLOUR_NAMES[c]} className="colour-btn" onClick={() => store.updateList(selected.id, { colour: c })}>
                    <Swatch colour={c} />
                  </button>
                ))}
              </div>
              <button type="button" className="btn" onClick={() => ui.openNewTask()}>
                <Icon name="plus" small />
                Add a task
              </button>
            </div>
          </div>
        )}
        {shown.length === 0 ? (
          <EmptyState title="Nothing in this list" body="Tasks added to this list will appear here." />
        ) : (
          <div className="tbl-wrap">
            <ul className="tbl">
              {shown.map((t) => (
                <TaskRow key={t.id} task={t} layout="list" />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
