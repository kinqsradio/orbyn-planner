import { useState } from "react";
import { usePlanner, useStore } from "../../store/context";
import { LIST_COLOURS, type Tag } from "../../store/types";
import { TAG_COLOUR_NAMES } from "../tasks/TagChips";
import { Swatch } from "../tasks/TaskRow";

function TagRow({ tag }: { tag: Tag }) {
  const store = useStore();
  const [name, setName] = useState(tag.name);
  const save = () => {
    const next = name.trim();
    if (!next) setName(tag.name);
    else if (next !== tag.name) store.updateTag(tag.id, { name: next });
  };
  return (
    <div className="kv" style={{ height: 44, gap: 10 }}>
      <input className="inp" aria-label={`Name of tag ${tag.name}`} value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      <div role="radiogroup" aria-label={`Colour of ${tag.name}`} className="colours">
        {LIST_COLOURS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={tag.colour === c} aria-label={TAG_COLOUR_NAMES[c]} className="colour-btn" onClick={() => store.updateTag(tag.id, { colour: c })}>
            <Swatch colour={c} />
          </button>
        ))}
      </div>
      <button type="button" className="ghost danger" aria-label={`Delete tag ${tag.name}`} onClick={() => store.deleteTag(tag.id)}>Delete</button>
    </div>
  );
}

/** Settings · Tags: make, rename, recolour and delete the account's tags; a deleted tag can be restored, with its tasks' tags. */
export function TagsSettings() {
  const store = useStore();
  const { tags, tasks } = usePlanner();
  const [name, setName] = useState("");
  const live = tags.filter((t) => t.deletedAt === null);
  const deleted = tags.filter((t) => t.deletedAt !== null);
  const uses = (id: string) => tasks.filter((t) => t.deletedAt === null && t.tags.includes(id)).length;

  const add = () => {
    const next = name.trim();
    if (!next) return;
    store.addTag(next, LIST_COLOURS[tags.length % LIST_COLOURS.length]!);
    setName("");
  };

  return (
    <>
      <div className="bh"><b>Your tags</b><span></span></div>
      <div className="card" style={{ gap: 0, padding: "0 14px" }}>
        {live.length === 0 && <div className="kv" style={{ height: 44 }}><span className="t3">No tags yet.</span></div>}
        {live.map((t) => <TagRow key={t.id} tag={t} />)}
      </div>
      <div className="ctl" style={{ display: "flex", gap: 8 }}>
        <input className="inp" aria-label="New tag name" placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button type="button" className="btn" onClick={add}>Add tag</button>
      </div>
      {deleted.length > 0 && (
        <>
          <div className="bh"><b>Deleted tags</b><span></span></div>
          <div className="card" style={{ gap: 0, padding: "0 14px" }}>
            {deleted.map((t) => (
              <div key={t.id} className="kv" style={{ height: 44 }}>
                <span><Swatch colour={t.colour} /> {t.name} <span className="t3">· on {uses(t.id)} {uses(t.id) === 1 ? "task" : "tasks"}</span></span>
                <button type="button" className="ghost" aria-label={`Restore tag ${t.name}`} onClick={() => store.restoreTag(t.id)}>Restore</button>
              </div>
            ))}
          </div>
          <span className="t3" style={{ fontSize: 12.5 }}>A deleted tag is hidden everywhere. Its tasks keep it, so restoring brings it back. It is removed for good after 30 days.</span>
        </>
      )}
    </>
  );
}
