import { useEffect, useState, type ReactNode } from "react";
import { useNow } from "../../app/clock";
import { useStore } from "../../store/context";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { fileSize } from "../../lib/fileSize";
import { buildIcs } from "./exportIcs";
import { exportJson } from "./exportJson";
import { saveFile } from "./save";

const stamp = (d: Date) => d.toISOString().slice(0, 10);

/** The warning in the dialog, while it exports and when it is done: one string, so the three states cannot differ. */
export const EXPORT_WARNING = "The exported file isn’t encrypted. Anyone who gets it can read it, including the addresses of calendars you subscribe to, which can be private links. Keep it somewhere safe.";

type Kind = "json" | "ics";
type Step = { name: "choose" } | { name: "busy" } | { name: "done"; file: string; size: number } | { name: "failed" };

const CHOICES: { kind: Kind; title: string; note: string }[] = [
  { kind: "json", title: "JSON", note: "Everything in your planner, as one file, including events, tags and the trash. Settings stay on this device." },
  // The calendar file holds the events and also the tasks that have a due date (as VTODO), so the note says so.
  { kind: "ics", title: "Calendar (.ics)", note: "Events, and tasks with a due date, for other calendar apps." },
];

/**
 * Settings · Privacy · Your data. The export is made here from what is on this device and saved with a download (or the
 * desktop app's save dialog); nothing is sent to the engine. The dialog says plainly that the file isn't encrypted.
 */
export function ExportSettings({ children }: { children?: ReactNode }) {
  const store = useStore();
  const nowOnScreen = useNow();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("json");
  const [step, setStep] = useState<Step>({ name: "choose" });

  const close = () => {
    setOpen(false);
    setStep({ name: "choose" });
  };

  // When the step changes the buttons change with it, and a real browser drops focus from a button that was disabled (the busy one):
  // so focus goes to the new step's first choice, Try again after a failure and Done at the end. Closing returns focus to Export…
  // on its own (useDialog).
  useEffect(() => {
    if (!open || step.name === "busy") return;
    document.querySelector<HTMLElement>('[role="dialog"][aria-label="Export your data"] [data-autofocus]')?.focus();
  }, [open, step.name]);

  const download = async () => {
    setStep({ name: "busy" });
    const now = new Date(nowOnScreen.getTime());
    const state = store.getState();
    try {
      const file =
        kind === "json"
          ? { name: `orbyn-planner-${stamp(now)}.json`, mime: "application/json", body: exportJson(state, now.toISOString()) }
          : { name: `orbyn-planner-${stamp(now)}.ics`, mime: "text/calendar", body: buildIcs(state, now) };
      const saved = await saveFile(file.name, file.mime, file.body);
      // Closing the desktop app's save dialog is not an export: the choices come back.
      setStep(saved ? { name: "done", file: file.name, size: new Blob([file.body]).size } : { name: "choose" });
    } catch {
      setStep({ name: "failed" });
    }
  };

  const busy = step.name === "busy";
  return (
    <>
      <div className="bh"><b>Your data</b><span></span></div>
      <div className="card" style={{ gap: 0, padding: "0 var(--sp-14)" }}>
        <div className="kv" style={{ height: "auto", minHeight: "var(--sp-44)", padding: "var(--sp-6) 0" }}>
          <span>Export your data<br /><span className="t3 fine">Planner as open files</span></span>
          <button type="button" id="export-planner" className="ghost" onClick={() => { setStep({ name: "choose" }); setOpen(true); }}>Export…</button>
        </div>
        {children}
      </div>
      {open && (
        <Modal label="Export your data" onClose={busy ? () => undefined : close}>
          <b className="card-title">Export your data</b>
          {step.name === "done" && (
            <span className="t2 line" role="status"><span className="pv-ok"><Icon name="check2" small /></span>Downloaded {step.file} · {fileSize(step.size)}</span>
          )}
          {step.name === "failed" && (
            <span className="t2 line" role="alert"><span className="pv-red"><Icon name="alert" small /></span>Couldn’t export your data. Nothing was changed.</span>
          )}
          {(step.name === "choose" || step.name === "busy") && (
            <div role="radiogroup" aria-label="Format" className="export-choices">
              {CHOICES.map((c) => (
                <label key={c.kind} className={kind === c.kind ? "choice on" : "choice"}>
                  <input type="radio" name="export-kind" checked={kind === c.kind} disabled={busy} onChange={() => setKind(c.kind)} />
                  <span>
                    <b>{c.title}</b>
                    <small>{c.note}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          {step.name !== "failed" && (
            <p role="note" className="t3 small line"><span className="warn-icon"><Icon name="alert" small /></span>{EXPORT_WARNING}</p>
          )}
          <div className="dialog-actions">
            {step.name === "done" ? (
              <button type="button" className="btn" data-autofocus onClick={close}>Done</button>
            ) : step.name === "failed" ? (
              <>
                <button type="button" className="ghost" onClick={close}>Cancel</button>
                <button type="button" className="btn" data-autofocus onClick={() => void download()}>Try again</button>
              </>
            ) : (
              <>
                <button type="button" className="ghost" data-autofocus disabled={busy} onClick={close}>Cancel</button>
                {/* aria-disabled, not disabled: a focused button that becomes disabled loses focus in a browser. */}
                <button type="button" className="btn" aria-disabled={busy || undefined} onClick={() => !busy && void download()}>
                  {busy ? <><span className="spin" aria-hidden="true" />Exporting…</> : "Export"}
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
