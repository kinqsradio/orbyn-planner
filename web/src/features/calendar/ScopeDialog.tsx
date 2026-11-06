import { useRef } from "react";
import { Portal } from "../../components/Portal";
import { useDialog } from "../../components/useDialog";
import type { Scope } from "../../store/eventScope";

type Noun = "event" | "task";

const CHOICES: Record<Noun, readonly { scope: Scope; label: string; hint: string }[]> = {
  event: [
    { scope: "this", label: "This event", hint: "Only this date" },
    { scope: "following", label: "This and following", hint: "This date and every later one" },
    { scope: "all", label: "All events", hint: "Every date in the series" },
  ],
  task: [
    { scope: "this", label: "This task", hint: "Only this time" },
    { scope: "following", label: "This and following", hint: "This time and every later one" },
    { scope: "all", label: "All", hint: "The whole repeat" },
  ],
};

/** Asks which events of a repeating series an edit or delete should reach. */
export function ScopeDialog({ title, noun = "event", allowed, onChoose, onCancel }: { title: string; noun?: Noun; allowed?: readonly Scope[]; onChoose: (scope: Scope) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onCancel);
  return (
    <Portal>
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={ref} className="authcard" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <b className="card-title">{title}</b>
        <p className="t3">This {noun} repeats. Which ones should change?</p>
        {CHOICES[noun].filter((c) => !allowed || allowed.includes(c.scope)).map((c, i) => (
          <button key={c.scope} type="button" className="ghost scope-choice" data-autofocus={i === 0 ? "" : undefined} onClick={() => onChoose(c.scope)}>
            <span>{c.label}</span>
            <span className="t3">{c.hint}</span>
          </button>
        ))}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
