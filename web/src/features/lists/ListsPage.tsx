import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNow } from "../../app/clock";
import { Link } from "../../app/router";
import { useUi } from "../../app/ui";
import { EmptyState, PageHeader } from "../../components/EmptyState";
import { usePlanner, useStore } from "../../store/context";
import { LIST_COLOURS, type ListColour, type TaskList } from "../../store/types";
import { activeTasks, openCount, sortByDue } from "../tasks/selectors";
import { Swatch, TaskRow } from "../tasks/TaskRow";

const COLOUR_NAMES: Record<ListColour, string> = {
  c1: "Grey", c2: "Blue", c3: "Green", c4: "Orange", c5: "Red", c6: "Violet", c7: "Pink", c8: "Teal",
};

function ListHeader({ list }: { list: TaskList }) {
  const store = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);

  const save = () => {
    const next = name.trim();
    if (next && next !== list.name) store.updateList(list.id, { name: next });
    setEditing(false);
  };

  return (
    <div className="list-head">
      {editing ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input className="text-input" aria-label="List name" value={name} data-autofocus autoFocus onChange={(e) => setName(e.target.value)} onBlur={save} />
        </form>
      ) : (
        <h2 className="list-name">{list.name}</h2>
      )}
      {!list.isInbox && !editing && (
        <button
          type="button"
          className="btn btn-soft"
          onClick={() => {
            setName(list.name);
            setEditing(true);
          }}
        >
          Rename
        </button>
      )}
      <div role="radiogroup" aria-label="Colour" className="colours">
        {LIST_COLOURS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={list.colour === c}
            aria-label={COLOUR_NAMES[c]}
            className="colour-btn"
            onClick={() => store.updateList(list.id, { colour: c })}
          >
            <Swatch colour={c} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function ListsPage() {
  const store = useStore();
  const { lists, tasks, ready } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const ordered = useMemo(() => [...lists].sort((a, b) => Number(b.isInbox) - Number(a.isInbox)), [lists]);
  const selected = ordered.find((l) => l.id === ui.listId) ?? ordered[0];
  const shown = useMemo(
    () => (selected ? sortByDue(activeTasks(tasks, now).filter((t) => t.listId === selected.id)) : []),
    [tasks, now, selected],
  );

  const create = () => {
    const name = newName.trim();
    if (name) {
      const list = store.addList(name, LIST_COLOURS[(lists.length % (LIST_COLOURS.length - 1)) + 1]!);
      ui.selectList(list.id);
    }
    setNewName("");
    setAdding(false);
  };

  return (
    <>
      <PageHeader title="Lists">
        <Link to="/completed" className="link-quiet">Completed and deleted</Link>
      </PageHeader>
      <div className="lists-layout">
        <nav aria-label="Your lists" className="list-column">
          <ul className="list-nav">
            {ordered.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className="list-item"
                  aria-current={selected?.id === l.id ? "true" : undefined}
                  onClick={() => ui.selectList(l.id)}
                >
                  <Swatch colour={l.colour} />
                  <span className="list-item-name">{l.name}</span>
                  <span className="meta-text" aria-label={`${openCount(tasks, l.id)} open`}>{openCount(tasks, l.id)}</span>
                </button>
              </li>
            ))}
          </ul>
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <input className="text-input" aria-label="New list name" placeholder="List name" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onBlur={create} />
            </form>
          ) : (
            <button type="button" className="btn btn-soft" disabled={!ready} onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" />
              New list
            </button>
          )}
        </nav>

        <section className="list-detail" aria-label={selected?.name ?? "List"}>
          {selected && <ListHeader key={selected.id} list={selected} />}
          {shown.length === 0 ? (
            <EmptyState title="Nothing in this list" body="Tasks added to this list will appear here." />
          ) : (
            <ul className="task-list">
              {shown.map((t) => (
                <TaskRow key={t.id} task={t} showList={false} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
