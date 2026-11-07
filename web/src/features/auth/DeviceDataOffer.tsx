import { useEffect, useState } from "react";
import { deviceDataAnswer, hasPlannerData, rememberDeviceDataAnswer } from "../../store/deviceData";
import { closeDevicePlanner, plannerFor, removeDevicePlanner } from "../../store/planners";
import type { PlannerState } from "../../store/types";
import { Modal } from "../../components/Modal";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The first time an account signs in on this browser, offers to bring along what was made while the planner
 * was kept on this device alone. Add moves it into the account's planner as new local edits, which upload the
 * normal way, and empties the device-only planner; Keep separate leaves it as it is, to open after sign-out.
 * Asked once per account per browser: the answer is remembered. Nothing is asked when the device holds nothing.
 */
export function DeviceDataOffer({ accountId }: { accountId: string }) {
  const [summary, setSummary] = useState<PlannerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (deviceDataAnswer(accountId)) return;
    let cancelled = false;
    const device = plannerFor(null);
    void device.ready.then(() => {
      if (cancelled) return;
      if (hasPlannerData(device.getState())) setSummary(device.getState());
      else closeDevicePlanner();
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (!summary) return null;

  const decide = async (add: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (add) {
        const account = plannerFor(accountId);
        await account.ready;
        account.adopt(plannerFor(null).getState());
        await account.flush();
        await removeDevicePlanner();
      } else {
        closeDevicePlanner();
      }
      rememberDeviceDataAnswer(accountId, add ? "added" : "separate");
      setSummary(null);
    } catch {
      setError("Couldn’t add it. Nothing was lost; try again.");
      setBusy(false);
    }
  };

  const lines = [
    summary.tasks.length > 0 && plural(summary.tasks.length, "task"),
    summary.events.length > 0 && plural(summary.events.length, "event"),
    summary.projects.length > 0 && plural(summary.projects.length, "project"),
  ].filter(Boolean);

  return (
    <Modal label="Add this device’s planner" onClose={() => undefined}>
      <b className="card-title">Add this device’s planner to your account?</b>
      <p className="t3 small">{lines.length > 0 ? `${lines.join(", ")} made here before you signed in. ` : ""}Adding them syncs them to your other devices. Keeping them separate leaves them on this device, and you can open them after you sign out.</p>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="ghost" disabled={busy} onClick={() => void decide(false)}>Keep separate</button>
        <button type="button" className="btn" data-autofocus disabled={busy} onClick={() => void decide(true)}>Add to account</button>
      </div>
    </Modal>
  );
}
