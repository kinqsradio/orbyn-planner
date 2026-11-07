import { useEffect, useState } from "react";
import { useNow } from "../../app/clock";
import { deletedAccount, type DeletedAccount } from "../../auth/deletedAccount";
import { deletionDay } from "../../auth/deletionNotice";
import type { AuthServices } from "../../auth/services";
import { forgetProtectionNotice } from "../../auth/protectionNotice";
import { BusyButton } from "../../components/BusyButton";
import { Icon } from "../../components/Icon";
import { motionMs } from "../../styles/tokens";
import { forgetDeviceDataAnswer } from "../../store/deviceData";
import { accountPlannerExists, closePlanner, plannerFor, removeAccountPlanner } from "../../store/planners";
import { exportJson } from "../export/exportJson";
import { saveFile } from "../export/save";
import { fileSize } from "../../lib/fileSize";
export { fileSize };

/**
 * Forgets this device's keys, but only if they are still this account's: another tab may have signed in to a different account since,
 * which replaced the device, and those keys are not ours to remove. Under the engine's lock, so the check and the removal are one step.
 */
async function forgetDeviceOf(services: AuthServices, accountId: string): Promise<void> {
  await services.engine.exclusive(async () => {
    const identity = await services.keys.loadIdentity();
    if (identity && identity.accountId === accountId) await services.keys.clearDevice();
  });
}

const EXPORT_FAILED = "Couldn’t export your data. Nothing was removed from this browser.";
const REMOVE_FAILED = "Couldn’t remove this browser’s copy. Try again, or clear this site’s data in your browser settings.";

/**
 * Shown over everything once the engine has said the account was deleted. The copy on this browser is now the only one, so it is not
 * removed until the person chooses: export it first, or remove it. Removing deletes for good, so there is no second confirmation.
 */
export function DeletedAccountScreen({ account, services, onLeave }: { account: DeletedAccount; services: AuthServices; onLeave: (to: "signup" | "signin") => void }) {
  const now = useNow();
  /** Which action is under way, so its button shows the spinner and the other is disabled. */
  const [working, setWorking] = useState<"export" | "remove" | null>(null);
  const day = deletionDay(account.deletedAt);
  const who = `${account.email} was deleted on ${day}`;

  const exportCopy = async () => {
    if (working) return;
    setWorking("export");
    try {
      // Another tab may have removed the copy already: opening it now would make an empty one.
      if (!(await accountPlannerExists(account.accountId))) {
        deletedAccount.update({ phase: "final", hadCopy: false });
        return;
      }
      const store = plannerFor(account.accountId);
      await store.ready;
      const stamp = new Date(now.getTime()).toISOString().slice(0, 10);
      const name = `orbyn-planner-${stamp}.json`;
      const body = exportJson(store.getState(), new Date(now.getTime()).toISOString());
      // The person may close the save dialog (desktop): then nothing was exported and nothing changes.
      if (await saveFile(name, "application/json", body)) deletedAccount.update({ phase: "exported", file: { name, size: new Blob([body]).size } });
    } catch {
      deletedAccount.update({ phase: "export-failed" });
    } finally {
      setWorking(null);
    }
  };

  const removeCopy = async () => {
    if (working) return;
    setWorking("remove");
    // The button shows Removing… first (after 400 ms); if the removal is still going after twice that, the screen for it replaces the buttons.
    const slow = setTimeout(() => deletedAccount.update({ phase: "removing" }), motionMs("wait") * 2);
    try {
      await removeAccountPlanner(account.accountId);
      await forgetDeviceOf(services, account.accountId);
      forgetProtectionNotice(account.accountId);
      forgetDeviceDataAnswer(account.accountId);
      deletedAccount.update({ phase: "final" });
    } catch {
      deletedAccount.update({ phase: "remove-failed" });
    } finally {
      clearTimeout(slow);
      setWorking(null);
    }
  };

  const leave = (to: "signup" | "signin") => {
    // A browser that held the account in memory only lets go of what the tab still has.
    if (!account.hadCopy) {
      closePlanner(account.accountId);
      void forgetDeviceOf(services, account.accountId).catch(() => undefined);
    }
    onLeave(to);
  };

  const note = <span className="t3 small">Removing it deletes this browser’s copy for good.</span>;
  const exportIcon = <><Icon name="download" small />Export what’s on this browser</>;
  const removeButton = (className: string, idle = "Remove it now", focus = false) => (
    <BusyButton className={className} data-autofocus={focus || undefined} busy={working === "remove"} disabled={working !== null} idle={idle} working="Removing…" onClick={() => void removeCopy()} />
  );
  const exportButton = (className: string, idle: React.ReactNode, focus = false) => (
    <BusyButton className={className} data-autofocus={focus || undefined} busy={working === "export"} disabled={working !== null} idle={idle} working="Exporting…" onClick={() => void exportCopy()} />
  );
  let body;
  switch (account.phase) {
    case "choose":
      body = (
        <>
          <span className="t2">{who}. Its data on Orbyn’s servers is gone and can’t be restored.</span>
          <span className="t3 small">A copy is still on this browser, and it’s the only one left. Export it first if you want to keep anything. Nothing else opens until you choose.</span>
          <div className="pv-stack">
            {exportButton("btn lg", exportIcon, true)}
            {removeButton("ghost lg red")}
          </div>
          {note}
        </>
      );
      break;
    case "exported":
      body = (
        <>
          <span className="t2 line"><span className="pv-ok"><Icon name="check2" small /></span>Downloaded {account.file?.name} · {fileSize(account.file?.size ?? 0)}</span>
          <span className="t3 small">The copy on this browser is still here until you remove it.</span>
          <div className="pv-stack">
            {removeButton("btn lg", "Remove it now", true)}
            {exportButton("ghost lg", <><Icon name="download" small />Export again</>)}
          </div>
          {note}
        </>
      );
      break;
    case "export-failed":
      body = (
        <>
          <span className="t2 line" role="alert"><span className="pv-red"><Icon name="alert" small /></span>{EXPORT_FAILED}</span>
          <span className="t3 small">The copy on this browser is the only one left.</span>
          <div className="pv-stack">
            {exportButton("btn lg", "Try again", true)}
            {removeButton("ghost lg red", "Remove it anyway")}
          </div>
          {note}
        </>
      );
      break;
    case "removing":
      body = (
        <>
          <span className="t2">{who}. Its data can’t be restored.</span>
          <span className="t3 small line" role="status"><span className="spin" aria-hidden="true" />Removing its copy from this browser</span>
          <div className="prog blue" aria-hidden="true"><i style={{ width: "55%" }} /></div>
          <span className="t3 small">This takes a moment. Nothing else opens until it’s done.</span>
        </>
      );
      break;
    case "remove-failed":
      body = (
        <>
          <span className="t2 line" role="alert"><span className="pv-red"><Icon name="alert" small /></span>{REMOVE_FAILED}</span>
          <div className="pv-stack">
            {removeButton("btn lg", "Try again", true)}
          </div>
          {note}
        </>
      );
      break;
    case "final":
      body = (
        <>
          <span className="t2">
            {account.hadCopy ? `${who}, after its 7 days ended. Its data can’t be restored.` : `${who}. Its data on Orbyn’s servers is gone and can’t be restored.`}
          </span>
          <span className="t3 small">{account.hadCopy ? "Orbyn removed its copy from this browser." : "This browser had no copy to remove."}</span>
          <div className="pv-row">
            <button type="button" className="btn" data-autofocus onClick={() => leave("signup")}>Create a new account</button>
            <button type="button" className="ghost" onClick={() => leave("signin")}>Sign in with another account</button>
          </div>
        </>
      );
      break;
  }
  return (
    <main className="public-page" id="content" tabIndex={-1}>
      <div className="authcard deleted-card" role="group" aria-label="This account was deleted">
        <h1 className="keys-title">This account was deleted</h1>
        {body}
      </div>
    </main>
  );
}

/**
 * After a 401 the app asks whether the account was deleted, which takes a request. The landing is held blank for 400 ms so nothing
 * flashes; if the answer has not come by then, this neutral card (a still spinner, no buttons) replaces the blank.
 */
export function CheckingAccount() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), motionMs("wait"));
    return () => clearTimeout(timer);
  }, []);
  if (!late) return null;
  return (
    <main className="public-page" id="content" tabIndex={-1}>
      <div className="authcard checking-card" role="status">
        <span className="t2 line"><span className="spin still" aria-hidden="true" /><b className="checking-title">Checking your account…</b></span>
        <span className="t3 small">This takes a moment.</span>
      </div>
    </main>
  );
}
