import { useRef, useState } from "react";
import { useUi } from "../../app/ui";
import { Portal } from "../../components/Portal";
import { useDialog } from "../../components/useDialog";
import { useStore } from "../../store/context";
import { LIST_COLOURS, type ListColour, type Project } from "../../store/types";
import { Swatch } from "../tasks/TaskRow";

const COLOUR_NAMES: Record<ListColour, string> = { c1: "Blue", c2: "Green", c3: "Purple", c4: "Orange" };

/** New project, or Edit project when given one: name, colour and the date it should be done by. */
export function ProjectDialog({ project, onClose, onSaved }: { project?: Project; onClose: () => void; onSaved?: (p: Project) => void }) {
  const store = useStore();
  const ui = useUi();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  const [name, setName] = useState(project?.name ?? "");
  const [colour, setColour] = useState<ListColour>(project?.colour ?? "c1");
  const [goal, setGoal] = useState(project?.goal ?? "");

  const submit = () => {
    if (!name.trim()) return;
    if (project) {
      store.updateProject(project.id, { name, colour, goal: goal || null });
      onSaved?.({ ...project, name: name.trim(), colour, goal: goal || null });
    } else {
      const created = store.addProject({ name, colour, goal: goal || null });
      ui.showToast(`Added “${created.name}”`);
      onSaved?.(created);
    }
    onClose();
  };

  return (
    <Portal>
      <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className="authcard" role="dialog" aria-modal="true" aria-label={project ? "Edit project" : "New project"} tabIndex={-1}>
          <b className="card-title">{project ? "Edit project" : "New project"}</b>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="pj-name">Name</label>
            <input id="pj-name" className="field" data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
            <span id="pj-colour" className="form-label">Colour</span>
            <div role="radiogroup" aria-labelledby="pj-colour" className="colours">
              {LIST_COLOURS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={colour === c} aria-label={COLOUR_NAMES[c]} className="colour-btn" onClick={() => setColour(c)}>
                  <Swatch colour={c} />
                </button>
              ))}
            </div>
            <label htmlFor="pj-goal">Done by</label>
            <input id="pj-goal" className="field" type="date" value={goal} onChange={(e) => setGoal(e.target.value)} />
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn" disabled={!name.trim()}>{project ? "Save" : "Add project"}</button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
