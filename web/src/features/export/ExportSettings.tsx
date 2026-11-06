import { useState } from "react";
import { useNow } from "../../app/clock";
import { useStore } from "../../store/context";
import { Modal } from "../auth/AccountSettings";
import { buildIcs } from "./exportIcs";
import { exportJson } from "./exportJson";
import { saveFile } from "./save";

const stamp = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Settings · Privacy · Your data. The export is made here from what is on this device and saved with a download (or the
 * desktop app's save dialog); nothing goes to the engine. The dialog says plainly that the file isn't encrypted.
 */
export function ExportSettings() {
  const store = useStore();
  const nowOnScreen = useNow();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const download = async (kind: "json" | "ics") => {
    const now = new Date(nowOnScreen.getTime());
    const state = store.getState();
    const file =
      kind === "json"
        ? { name: `orbyn-planner-${stamp(now)}.json`, mime: "application/json", body: exportJson(state, now.toISOString()) }
        : { name: `orbyn-planner-${stamp(now)}.ics`, mime: "text/calendar", body: buildIcs(state, now) };
    try {
      const saved = await saveFile(file.name, file.mime, file.body);
      setMessage(saved ? `Saved ${file.name}.` : null);
      if (saved) setOpen(false);
    } catch {
      setMessage("Couldn’t save the file. Nothing was lost; try again.");
    }
  };

  return (
    <>
      <div className="bh"><b>Your data</b><span></span></div>
      <div className="card" style={{ gap: 0, padding: "0 14px" }}>
        <div className="kv" style={{ height: 44 }}>
          <span>Export your planner</span>
          <button type="button" className="ghost" onClick={() => { setMessage(null); setOpen(true); }}>Export…</button>
        </div>
      </div>
      {message && <span className="t3 small" role="status">{message}</span>}
      {open && (
        <Modal label="Export your planner" onClose={() => setOpen(false)}>
          <b className="card-title">Export your planner</b>
          <p className="t3 small">Made on this device from what is stored here, and saved as a file. Nothing is sent to Orbyn.</p>
          <p role="note" className="small"><b style={{ fontWeight: 500 }}>The file is not encrypted.</b> Anyone who gets it can read your planner, so keep it somewhere safe. It has no keys or sign-in details.</p>
          {message && <p className="err" role="alert">{message}</p>}
          <div className="dialog-actions" style={{ flexWrap: "wrap" }}>
            <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="ghost" onClick={() => void download("ics")}>Calendar (.ics)</button>
            <button type="button" className="btn" data-autofocus onClick={() => void download("json")}>Everything (JSON)</button>
          </div>
          <p className="t3 small">JSON has your tasks, lists, projects, calendars, events and the trash. The calendar file has your events and the tasks that have a due date, with their repeats.</p>
        </Modal>
      )}
    </>
  );
}
