import { useState } from "react";
import { usePlanner, useStore } from "../../store/context";
import { DuplicateTagName, LIST_COLOURS, type Tag } from "../../store/types";
import { TAG_COLOUR_NAMES, tagLabels } from "../tasks/TagChips";
import { Swatch } from "../tasks/TaskRow";

function TagRow({ tag, label }: { tag: Tag; label: string }) {
  const store = useStore();
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const next = name.trim();
    setError(null);
    if (!next) setName(tag.name);
    else if (next !== tag.name) {
      try {
        store.updateTag(tag.id, { name: next });
      } catch (e) {
        if (!(e instanceof DuplicateTagName)) throw e;
        setError(e.message);
        setName(tag.name);
      }
    }
  };
  return (
    <div className="kv" style={{ minHeight: "var(--sp-44)", gap: "var(--sp-10)", flexWrap: "wrap" }}>
      <input className="inp" aria-label={`Name of tag ${tag.name}`} value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      {label !== tag.name && <span className="t3 small">shown as {label}</span>}
      {error && <span className="err" role="alert">{error}</span>}
      <div role="radiogroup" aria-label={`Colour of ${tag.name}`} className="colours">
        {LIST_COLOURS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={tag.colour === c} aria-label={TAG_COLOUR_NAMES[c]} className="colour-btn" onClick={() => store.updateTag(tag.id, { colour: c })}>
            <Swatch colour={c} />
          </button>
        ))}
      </div>
      <button type="button" className="ghost red" aria-label={`Delete tag ${tag.name}`} onClick={() => store.deleteTag(tag.id)}>Delete</button>
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

  const [addError, setAddError] = useState<string | null>(null);
  const labels = tagLabels(tags);

  const add = () => {
    const next = name.trim();
    if (!next) return;
    try {
      store.addTag(next, LIST_COLOURS[tags.length % LIST_COLOURS.length]!);
      setName("");
      setAddError(null);
    } catch (e) {
      if (!(e instanceof DuplicateTagName)) throw e;
      setAddError(e.message);
    }
  };

  return (
    <>
      <div className="bh"><b>Your tags</b><span></span></div>
      <div className="card" style={{ gap: 0, padding: "0 var(--sp-14)" }}>
        {live.length === 0 && <div className="kv" style={{ height: "var(--sp-44)" }}><span className="t3">No tags yet.</span></div>}
        {live.map((t) => <TagRow key={t.id} tag={t} label={labels.get(t.id) ?? t.name} />)}
      </div>
      <div className="ctl" style={{ display: "flex", gap: "var(--sp-8)" }}>
        <input className="inp" aria-label="New tag name" placeholder="New tag" value={name} onChange={(e) => { setName(e.target.value); setAddError(null); }} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button type="button" className="btn" onClick={add}>Add tag</button>
      </div>
      {addError && <span className="err" role="alert">{addError}</span>}
      {deleted.length > 0 && (
        <>
          <div className="bh"><b>Deleted tags</b><span></span></div>
          <div className="card" style={{ gap: 0, padding: "0 var(--sp-14)" }}>
            {deleted.map((t) => (
              <div key={t.id} className="kv" style={{ height: "var(--sp-44)" }}>
                <span><Swatch colour={t.colour} /> {t.name} <span className="t3">· on {uses(t.id)} {uses(t.id) === 1 ? "task" : "tasks"}</span></span>
                <button type="button" className="ghost" aria-label={`Restore tag ${t.name}`} onClick={() => store.restoreTag(t.id)}>Restore</button>
              </div>
            ))}
          </div>
          <span className="t3" style={{ fontSize: "var(--fs-12-5)" }}>A deleted tag is hidden everywhere. Its tasks keep it, so restoring brings it back. It is removed for good after 30 days.</span>
        </>
      )}
    </>
  );
}
